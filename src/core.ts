import { nanoid } from "nanoid";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
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

const invalidData = {
	INVALID_URL: [] as string[],
	INVALID_LANG: [] as string[],
	INVALID_LOCATION: [] as string[],
	INVALID_PHOTO: [] as string[],
	INVALID_FETCH_PHOTO: [] as string[],
	UPLOAD_ERROR: [] as string[],
};

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

export async function scrape(
	urls: string[],
	callbacks: {
		dir: string;
		type: "ARTICLE" | "SPOT";
		timeout?: number;
		convertTitle?: (title: string) => string;
		getLocation: (html: string) => { lat: number; lng: number } | null;
		getPhotos: (html: string) => string[] | null;
	},
) {
	const {
		dir,
		type,
		timeout = 1000,
		convertTitle = (title) => title,
	} = callbacks;

	const root = path.join("./result", dir);
	const reportPath = path.join(root, "report");

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

	for (const url of urls) {
		if (doneSet.has(url)) continue;

		console.info("start:", url);

		const html = await getHtml(url);

		const info = getTextInfo(html);

		if (!info) {
			invalidData.INVALID_URL.push(url);
			continue;
		}

		const title = convertTitle(info.title);

		const photoUrls = callbacks.getPhotos(html);

		if (!photoUrls || !photoUrls.length) {
			invalidData.INVALID_PHOTO.push(url);
			continue;
		}

		const photos: File[] = await Promise.all(
			photoUrls.map((photoUrl) => fetchImage(photoUrl)),
		).then((photos) => photos.filter((photo): photo is File => Boolean(photo)));

		if (photoUrls.length !== photos.length) {
			invalidData.INVALID_FETCH_PHOTO.push(url);
			// NOTE: これは許容する
			// continue;
		}

		const lang = await detectLanguage(title, info.description.slice(0, 200));

		if (!lang) {
			invalidData.INVALID_LANG.push(url);
			continue;
		}

		const { description, category, address } = await guessInfo(
			title,
			info.description.slice(0, 2000),
			lang === "ja"
				? "日本語で400文字程度で要約してください。"
				: "英語で200語程度で要約してください。",
		);

		let location = callbacks.getLocation(html);

		if (!location) {
			const location2 = await getCoodinates(address);
			if (!location2) {
				invalidData.INVALID_LOCATION.push(url);
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
			lat,
			lng,
		};

		const translatedContents = await toTranslatedContents({
			title,
			description:
				countGrapheme(description, lang) > 1000
					? `${description.slice(0, 996)} ...`
					: description,
			language: base_language,
		});

		const contentBodies: ContentBoby[] = translatedContents.map((content) => ({
			id: nanoid(),
			...content,
			content_id,
		}));

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
			"test",
			content_id,
		);

		if (error) {
			console.error(error);
			invalidData.UPLOAD_ERROR.push(url);
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

		await sleep(timeout);
	}

	for (const [name, data] of Object.entries(invalidData)) {
		const inputs = data.map((url) => JSON.stringify({ url }));
		appendFileSync(path.join(reportPath, `${name}.jsonl`), inputs.join("\n"));
	}

	for (const name of OUTPUT_FILE_NAMES) {
		const csv = readJsonlToCsv(jsonls[name]);
		if (csv) {
			writeFileSync(path.join(root, `${name}.csv`), csv);
		}
	}
}
