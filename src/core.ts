import type { CheerioAPI } from "cheerio";
import * as cheerio from "cheerio";
import { nanoid } from "nanoid";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { OUTPUT_FILE_NAMES } from "./config.js";
import { CATEGORY_MAPPING } from "./data.js";
import {
	compact,
	detectLanguage,
	fetchImage,
	getCoodinates,
	getHtml,
	getTextInfo,
	guessInfo,
	readJsonlToCsv,
	sleep,
	toJsonl,
	toUpperCase,
} from "./helpers.js";
import { SupabaseStorage } from "./supabase.js";
import type {
	Article,
	Content,
	ContentBoby,
	ContentCategoryMapping,
	ContentPhoto,
	ContentType,
	FileNames,
	Location,
	SpotInformation,
} from "./types.js";

const addressMap = new Map<string, { lat: number; lng: number }>();

export async function scrape(config: {
	dir: string;
	lang?: "en" | "ja";
	type: "ARTICLE" | "SPOT";
	timeout?: number;
	listUrls: string[];
	getDetailUrls: ($: CheerioAPI) => string[];
	convertTitle?: (title: string) => string;
	getLocation: (
		$: CheerioAPI,
		search: (address: string) => Promise<Location | null>,
	) => Location | Promise<Location | null> | null;
	getPhotos: ($: CheerioAPI) => string[] | null;
}) {
	const { dir, type, timeout = 1000, convertTitle = (title) => title } = config;

	const __filename = fileURLToPath(import.meta.url);
	const __dirname = path.dirname(__filename);
	const middlePath = path.relative("dist", __dirname);
	console.log({ __filename, __dirname, middlePath });

	const root = path.join("./result", dir);
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

	const storage = await SupabaseStorage.init();

	const browser = await chromium.launch({ headless: false });
	const page = await browser.newPage();

	for (const [i, listUrl] of config.listUrls.entries()) {
		if (doneSet.has(listUrl)) continue;

		console.info("\n", i + 1, "/", config.listUrls.length, "\n");

		// NOTE: fetch でもよかったが、デバッグ用に
		await page.goto(listUrl, { waitUntil: "domcontentloaded" });
		// await page.waitForSelector(".article-list", {
		// 	state: "attached",
		// 	timeout: 30000,
		// });
		const html = await page.content();
		const $ = cheerio.load(html);
		const urls = config.getDetailUrls($);

		let doneCount = 0;

		for (const url of urls) {
			if (doneSet.has(url)) {
				doneCount++;
				await sleep(1000);
				continue;
			}

			console.info("start:", url);
			const start = performance.now();

			const html = await getHtml(url);
			const $$ = cheerio.load(html);

			const info = getTextInfo(html);

			if (!info) {
				appendReport("INVALID_URL", url);
				continue;
			}

			const title = convertTitle(info.title);

			const photoUrls = config.getPhotos($$);

			if (!photoUrls || !photoUrls.length) {
				appendReport("INVALID_PHOTO", url);
				continue;
			}

			const photos: File[] = await Promise.all(
				photoUrls
					.filter((photoUrl) => URL.canParse(photoUrl))
					.map((photoUrl) => fetchImage(photoUrl)),
			).then(compact);

			if (photoUrls.length !== photos.length) {
				appendReport("INVALID_FETCH_PHOTO", url);
				// NOTE: これは許容する
				// continue;
			}

			const lang =
				config.lang ??
				(await detectLanguage(title, info.description.slice(0, 200)));

			if (!lang) {
				appendReport("INVALID_LANG", url);
				continue;
			}

			const info2 = await guessInfo(
				title,
				info.description.slice(0, 2000),
				lang === "ja"
					? "日本語で400文字程度で要約してください。"
					: "英語で200語程度で要約してください。",
				lang === "ja"
					? "タイトルと要約したテキストを英語に翻訳してください。"
					: "タイトルと要約したテキストを日本語に翻訳してください。",
			);

			if (!info2) {
				appendReport("OPENAI_ERROR", url);
				continue;
			}

			const {
				title: translatedTitle,
				jaDescription,
				enDescription,
				category = [],
				address,
			} = info2;

			let location = config.getLocation($$, getCoodinates);

			if (location instanceof Promise) {
				location = await location;
			}

			let metadata: { guess_location: boolean } | undefined;
			if (!location || location.lat === 0 || location.lng === 0) {
				metadata = { ...metadata, guess_location: true };
				if (addressMap.has(address)) {
					// biome-ignore lint/style/noNonNullAssertion: non null
					location = addressMap.get(address)!;
				} else {
					const location2 = await getCoodinates(address);
					console.info({ address, location2 });

					if (!location2) {
						appendReport("INVALID_LOCATION", url);
						continue;
					}
					location = location2;
					addressMap.set(address, location2);
				}
			}

			const { lat, lng } = location;

			const actual_language = toUpperCase(lang);

			const base_language =
				actual_language !== "JA" && actual_language !== "EN"
					? "EN"
					: (actual_language as "JA" | "EN");

			const content_id = nanoid();

			const content: Content = {
				id: content_id,
				content_url: url,
				base_language,
				actual_language,
				status: "PRIVATED",
				lat: typeof lat === "string" ? Number.parseFloat(lat) : lat,
				lng: typeof lng === "string" ? Number.parseFloat(lng) : lng,
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
					description: base_language === "EN" ? enDescription : jaDescription,
					language: base_language,
					content_id,
				},
				{
					id: nanoid(),
					title: translatedTitle,
					description: base_language === "EN" ? jaDescription : enDescription,
					language: base_language === "EN" ? "JA" : "EN",
					content_id,
				},
			];
			// translatedContents.map(
			// 	(content) => ({
			// 		id: nanoid(),
			// 		...content,
			// 		content_id,
			// 	}),
			// );

			const contentCategoryMapping: ContentCategoryMapping[] = category
				.map((category) => ({
					content_id,
					content_category_id:
						CATEGORY_MAPPING[category as keyof typeof CATEGORY_MAPPING],
				}))
				.filter((mapping) => !!mapping.content_category_id);

			const content_type_id = nanoid();
			const contentType: ContentType = {
				id: content_type_id,
				type,
				content_id,
			};

			const contentTypeDetail: Article | SpotInformation = {
				id: nanoid(),
				content_type_id,
			};

			const { error, data } = await storage.uploadContentPhotos(
				photos,
				`mapzamurai/${dir}`,
				content_id,
			);

			if (error) {
				console.error(error);
				appendReport("UPLOAD_ERROR", url);
				continue;
			}

			const contentPhotos: ContentPhoto[] = data.map((d) => ({
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
			if (type === "ARTICLE") {
				appendFileSync(jsonls.articles, toJsonl(contentTypeDetail));
			} else {
				appendFileSync(jsonls.spot_informations, toJsonl(contentTypeDetail));
			}
			appendFileSync(doneTxtPath, `${url}\n`);

			doneCount++;

			const end = performance.now();
			const time = end - start;
			console.info("time:", time, "ms");

			await sleep(Math.max(timeout - time, 0));
		}

		console.info(doneCount);

		if (doneCount === urls.length) {
			appendFileSync(doneTxtPath, `${listUrl}\n`);
		}
	}

	await browser.close();

	for (const name of OUTPUT_FILE_NAMES) {
		const csv = readJsonlToCsv(jsonls[name]);
		if (csv) {
			writeFileSync(path.join(root, `${name}.csv`), csv);
		}
	}
}
