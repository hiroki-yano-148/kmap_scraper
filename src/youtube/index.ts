import { nanoid } from "nanoid";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { title } from "node:process";
import Papa from "papaparse";
import { OUTPUT_FILE_NAMES } from "../config.js";
import { CATEGORY_MAPPING } from "../data.js";
import { fetchImage, requestOpenAI, toJsonl, toUpperCase } from "../helpers.js";
import { SupabaseStorage } from "../supabase.js";
import type {
	Article,
	Content,
	ContentBoby,
	ContentCategoryMapping,
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
	// categories: string;
}

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
		const invalidUrls = readFileSync(inputPath, "utf-8")
			.split("\n")
			.filter(Boolean)
			.map((value) => JSON.parse(value).url);

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
		existsSync(doneTxtPath)
			? readFileSync(doneTxtPath, "utf-8").split("\n").filter(Boolean)
			: [],
	);

	const csv = readFileSync("./src/youtube/source.csv", "utf-8");
	const { errors, data: rows } = Papa.parse(csv, { header: true });
	if (errors) {
		console.error(errors);
		return;
	}

	const storage = await SupabaseStorage.init();

	for (const data of rows.slice(0, 5) as CSV[]) {
		if (doneSet.has(data.url)) continue;

		const content_id = nanoid();

		// const lang = await detectLanguage(data.title, data.description.slice(0, 100));

		const metadata = { channel_id: data.channel_id };

		const result = await requestOpenAI<{
			lang: "en" | "ja";
			title: string;
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
          - テキストが英語ならば日本語に、日本語ならば英語に翻訳してください。
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
          - テキストからGoogle Mapの検索にヒットしそうな地名を推定してください。ない場合も、必ず日本のどこかの地名を返してください。
      
          出力は必ずJSON形式で行ってください。
          例：
          {
            "lang": "ja" // or "en",
            "title": "translated title",
            "jaDescription": "要約",
            "enDescription": "Description",
            "category": ["attractions", "events"],
            "address": "名古屋城",
          }
      `);

		const content: Content = {
			id: content_id,
			content_url: data.url,
			base_language: result.lang,
			actual_language: result.lang,
			status: "PRIVATED",
			lat:
				typeof data.latitude === "string"
					? Number.parseFloat(data.latitude)
					: data.latitude,
			lng:
				typeof data.longitude === "string"
					? Number.parseFloat(data.longitude)
					: data.longitude,
			metadata: metadata ? JSON.stringify(metadata) : "",
		};

		// const translatedContents = await toTranslatedContents({
		// 	title,
		// 	description:
		// 		countGrapheme(description, lang) > 1000
		// 			? `${description.slice(0, 996)} ...`
		// 			: description,
		// 	language: base_language,
		// });

		const contentBodies: ContentBoby[] = [
			{
				id: nanoid(),
				title,
				description:
					result.lang === "en" ? result.enDescription : result.jaDescription,
				language: toUpperCase(result.lang),
				content_id,
			},
			{
				id: nanoid(),
				title: result.title,
				description:
					result.lang === "en" ? result.jaDescription : result.enDescription,
				language: result.lang === "en" ? "JA" : "EN",
				content_id,
			},
		];

		const contentCategoryMapping: ContentCategoryMapping[] = result.category
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

		const photo = await fetchImage(data.thumbnail_url);

		if (!photo) {
			appendReport("INVALID_PHOTO", data.url);
			continue;
		}

		// const { error, data: a } = await storage.uploadContentPhotos(
		// 	[photo],
		// 	`mapzamurai/video`,
		// 	content_id,
		// );

		// if (error) {
		// 	appendReport("UPLOAD_ERROR", data.url);
		// 	continue;
		// }

		// const contentPhotos: ContentPhoto[] = a.map((d) => ({
		// 	id: d.id,
		// 	photo_url: d.photoUrl,
		// 	type: d.type,
		// 	order: d.order,
		// 	content_id,
		// }));

		appendFileSync(jsonls.contents, toJsonl(content));
		appendFileSync(jsonls.content_bodies, toJsonl(contentBodies));
		appendFileSync(
			jsonls.content_category_mappings,
			toJsonl(contentCategoryMapping),
		);
		// appendFileSync(jsonls.content_photos, toJsonl(contentPhotos));
		appendFileSync(jsonls.content_types, toJsonl(contentType));
		appendFileSync(jsonls.videos, toJsonl(contentTypeDetail));
		appendFileSync(doneTxtPath, `${data.url}\n`);
	}
}

await main();
