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
import { CATEGORY_MAPPING } from "./data.js";
import {
	countGrapheme,
	detectLanguage,
	fetchImage,
	getCoodinates,
	getHtml,
	getTextInfo,
	guessInfo,
	readJsonlToCsv,
	sleep,
	toJsonl,
	toTranslatedContents,
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
	SpotInformation,
} from "./types.js";

const OUTPUT_FILE_NAMES = [
	"contents",
	"content_bodies",
	"content_category_mappings",
	"content_photos",
	"content_types",
	"articles",
	"spot_informations",
] as const;

type FileNames = Record<(typeof OUTPUT_FILE_NAMES)[number], string>;

type Location = { lat: number | string; lng: number | string };

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
			| "UPLOAD_ERROR",
		url: string,
	) {
		const input = `${JSON.stringify({ url })}\n`;
		appendFileSync(path.join(reportPath, `${key}.jsonl`), input);
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

		for (const url of urls) {
			if (doneSet.has(url)) continue;

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
			).then((photos) =>
				photos.filter((photo): photo is File => Boolean(photo)),
			);

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

			const {
				description,
				category = [],
				address,
			} = await guessInfo(
				title,
				info.description.slice(0, 2000),
				lang === "ja"
					? "日本語で400文字程度で要約してください。"
					: "英語で200語程度で要約してください。",
			);

			let location = config.getLocation($$, getCoodinates);

			if (location instanceof Promise) {
				location = await location;
			}

			if (!location) {
				const location2 = await getCoodinates(address);
				console.info({ address, location2 });
				if (!location2) {
					appendReport("INVALID_LOCATION", url);
					continue;
				}
				location = location2;
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
			};

			const translatedContents = await toTranslatedContents({
				title,
				description:
					countGrapheme(description, lang) > 1000
						? `${description.slice(0, 996)} ...`
						: description,
				language: base_language,
			});

			const contentBodies: ContentBoby[] = translatedContents.map(
				(content) => ({
					id: nanoid(),
					...content,
					content_id,
				}),
			);

			const contentCategoryMapping: ContentCategoryMapping[] = category.map(
				(category) => ({
					content_id,
					content_category_id:
						CATEGORY_MAPPING[category as keyof typeof CATEGORY_MAPPING],
				}),
			);

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

			const storage = await SupabaseStorage.init();

			const { error, data } = await storage.uploadContentPhotos(
				photos,
				"mapzamurai",
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

			const end = performance.now();
			const time = end - start;
			console.info("time:", time, "ms");

			await sleep(Math.max(timeout - time, 0));
		}

		appendFileSync(doneTxtPath, `${listUrl}\n`);
	}

	await browser.close();

	for (const name of OUTPUT_FILE_NAMES) {
		const csv = readJsonlToCsv(jsonls[name]);
		if (csv) {
			writeFileSync(path.join(root, `${name}.csv`), csv);
		}
	}
}
