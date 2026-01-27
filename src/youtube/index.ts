import { nanoid } from "nanoid";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import { OUTPUT_FILE_NAMES } from "../config.js";
import { CATEGORY_MAPPING, CATEGORY_MAPPING2 } from "../data.js";
import {
	fetchImage,
	getCoodinates,
	readJsonl,
	readJsonlToCsv,
	readLines,
	requestOpenAI,
	toJsonl,
	toUpperCase,
} from "../helpers.js";
import { SupabaseStorage } from "../supabase.js";
import type {
	Article,
	Content,
	ContentBoby,
	ContentCategoryMapping,
	ContentPhoto,
	ContentType,
	FileNames,
	SpotInformation,
} from "../types.js";

interface CSV {
	channel_id: string;
	title: string;
	description: string;
	url: string;
	thumbnail_url: string;
	status: string;
	latitude: string;
	longitude: string;
	categories: string;
}

const addressMap = new Map<string, { lat: number; lng: number }>();

async function main() {
	const root = path.join("./result", "video");
	const reportPath = path.join(root, "report");

	function appendReport(
		key:
			| "INVALID_URL"
			| "INVALID_LANG"
			| "INVALID_LOCATION"
			| "INVALID_PHOTO"
			| "INVALID_FETCH_PHOTO"
			| "UPLOAD_ERROR"
			| "OPENAI_ERROR",
		url: string,
	) {
		const inputPath = path.join(reportPath, `${key}.jsonl`);
		if (!existsSync(inputPath)) {
			writeFileSync(inputPath, "");
		}
		const invalidUrls = readJsonl<{ url: string }>(inputPath).map(
			(line) => line.url,
		);

		if (invalidUrls.includes(url)) return;

		const input = `${JSON.stringify({ url })}\n`;
		appendFileSync(inputPath, input);
	}

	// biome-ignore lint/suspicious/noExplicitAny: allow any
	const jsonls: FileNames = {} as any;

	for (const name of OUTPUT_FILE_NAMES) {
		jsonls[name] = path.join(root, `${name}.jsonl`);
	}

	const doneTxtPath = path.join(root, "done.txt");

	if (!existsSync(root)) {
		mkdirSync(root, { recursive: true });
		mkdirSync(reportPath, { recursive: true });
	}

	const doneSet = new Set(
		existsSync(doneTxtPath) ? readLines(doneTxtPath) : [],
	);

	const csv = readFileSync("./src/youtube/source.csv", "utf-8");
	const { errors, data: rows } = Papa.parse<CSV>(csv, {
		header: true,
		skipEmptyLines: true,
	});
	if (errors.length) {
		console.error(errors);
		return;
	}

	const storage = await SupabaseStorage.init();

	for (const [i, data] of rows.entries()) {
		if (doneSet.has(data.url)) continue;

		console.info("start:", i + 1, data.url);

		const content_id = nanoid();

		const photo = await fetchImage(data.thumbnail_url);

		if (!photo) {
			appendReport("INVALID_PHOTO", data.url);
			continue;
		}

		// biome-ignore lint/suspicious/noExplicitAny: allow
		let metadata: any = { channel_id: data.channel_id };

		const result = await requestOpenAI<{
			lang: "en" | "ja";
			translatedTitle: string;
			jaDescription: string;
			enDescription: string;
			category: string[];
			address: string;
		}>(`
          次のテキストを参照し、後述のタスクを実行してください。
          \`\`\`text
          title: ${data.title ?? ""}
          description: ${data.description ?? ""}
          \`\`\`
      
          - テキストの英語か日本語か判定してください。
          - タイトルと説明を英語ならば日本語に、日本語ならば英語に翻訳してください。
					${
						data.categories
							? ""
							: `
					- 当てはまるカテゴリを以下から複数選択してください。
            - attractions
            - castles
            - cultural_sites
            - historical_sites
            - scenic_spots
            - temples_and_shrines
            - nature_and_outdoors
            - experiences
            - events
            - lodging
            - hot_springs
            - food_and_drink
            - transportation
            - technology
            - sports
            - artisans
            - anime	
					`
					}
          - テキスト中に明確に住所情報があれば、それを返してください。でなければ、テキストからGoogle Mapの検索にヒットしそうな地名を推定してください。推定できない場合も、必ず日本のどこかの地名を返してください。
      
          出力は必ずJSON形式で行ってください。
          例：
          {
            "lang": "ja" // or "en",
            "translatedTitle": "translated title",
            "jaDescription": "要約",
            "enDescription": "Description",
            ${data.categories ? "" : '"category": ["attractions", "events"],'}
            "address": "名古屋城",
          }
      `);

		let location = {
			lat: Number.parseFloat(data.latitude),
			lng: Number.parseFloat(data.longitude),
		};

		console.log({ location });

		if (
			Number.isNaN(location.lat) ||
			Number.isNaN(location.lng) ||
			location.lat === 0 ||
			location.lng === 0
		) {
			metadata = { ...metadata, guess_location: true };
			console.log({ metadata });
			if (addressMap.has(result.address)) {
				// biome-ignore lint/style/noNonNullAssertion: non null
				location = addressMap.get(result.address)!;
			} else {
				const location2 = await getCoodinates(result.address);
				console.info({ address: result.address, location2 });

				if (!location2) {
					appendReport("INVALID_LOCATION", data.url);
					continue;
				}
				location = location2;
				addressMap.set(result.address, location2);
			}
		}

		const { lat, lng } = location;

		const actual_language = toUpperCase(result.lang);

		const base_language =
			actual_language !== "JA" && actual_language !== "EN"
				? actual_language === "ZH"
					? "JA"
					: "EN"
				: (actual_language as "JA" | "EN");

		const content: Content = {
			id: content_id,
			content_url: data.url,
			base_language,
			// actual_language,
			status: "PRIVATED",
			lat,
			lng,
			metadata: metadata ? JSON.stringify(metadata) : "",
		};

		const contentBodies: ContentBoby[] = [
			{
				id: nanoid(),
				title: data.title,
				description:
					result.lang === "en" ? result.enDescription : result.jaDescription,
				language: toUpperCase(result.lang),
				content_id,
			},
			{
				id: nanoid(),
				title: result.translatedTitle,
				description:
					result.lang === "en" ? result.jaDescription : result.enDescription,
				language: result.lang === "en" ? "JA" : "EN",
				content_id,
			},
		];

		const categories = data.categories
			? data.categories.split(",").map((value) => CATEGORY_MAPPING2[value])
			: result.category;

		const contentCategoryMapping: ContentCategoryMapping[] = categories
			.map((category) => ({
				content_id,
				content_category_id:
					CATEGORY_MAPPING[category as keyof typeof CATEGORY_MAPPING],
			}))
			.filter((mapping) => !!mapping.content_category_id);

		const content_type_id = nanoid();
		const contentType: ContentType = {
			id: content_type_id,
			type: "VIDEO",
			content_id,
		};

		const contentTypeDetail: Article | SpotInformation = {
			id: nanoid(),
			content_type_id,
		};

		const { error, data: a } = await storage.uploadContentPhotos(
			[photo],
			`mapzamurai/video`,
			content_id,
		);

		if (error) {
			appendReport("UPLOAD_ERROR", data.url);
			continue;
		}

		const contentPhotos: ContentPhoto[] = a.map((d) => ({
			id: d.id,
			photo_url: d.photoUrl,
			type: d.type,
			order: d.order,
			content_id,
		}));

		appendFileSync(jsonls.contents, toJsonl(content));
		appendFileSync(jsonls.content_bodies, toJsonl(contentBodies));
		appendFileSync(
			jsonls.content_category_mappings,
			toJsonl(contentCategoryMapping),
		);
		appendFileSync(jsonls.content_photos, toJsonl(contentPhotos));
		appendFileSync(jsonls.content_types, toJsonl(contentType));
		appendFileSync(jsonls.videos, toJsonl(contentTypeDetail));
		appendFileSync(doneTxtPath, `${data.url}\n`);
	}

	for (const name of OUTPUT_FILE_NAMES) {
		const csv = readJsonlToCsv(jsonls[name]);
		if (csv) {
			writeFileSync(path.join(root, `${name}.csv`), csv);
		}
	}
}

await main();
