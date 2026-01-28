import { Readability } from "@mozilla/readability";
import * as cheerio from "cheerio";
import "dotenv/config";
import { Tiktoken } from "js-tiktoken/lite";
import o200k_base from "js-tiktoken/ranks/o200k_base";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import OpenAI from "openai";
import Papa from "papaparse";

const tiktoken = new Tiktoken(o200k_base);
const client = new OpenAI({
	apiKey: process.env.OPENAI_API_KEY,
	timeout: 30000,
});
// const translator = new v2.Translate({
// 	// biome-ignore lint/style/noNonNullAssertion: not null
// 	key: process.env.GOOGLE_TRANSLATION_API_KEY!,
// });

export async function requestOpenAI<T>(prompt: string): Promise<T> {
	const start = performance.now();
	const tokens = tiktoken.encode(prompt);
	console.info("input:", prompt.length, "char ->", tokens.length, "token");
	const response = await client.chat.completions.create({
		model: "gpt-4o-mini",
		messages: [{ role: "user", content: prompt }],
		temperature: 0,
		response_format: { type: "json_object" },
	});
	const result = JSON.parse(response.choices[0]?.message?.content || "{}");
	const tokens2 = tiktoken.encode(JSON.stringify(result));
	console.info(
		"output:",
		JSON.stringify(result).length,
		"char ->",
		tokens2.length,
		"token",
	);
	console.info("total:", tokens.length + tokens2.length, "token");
	const end = performance.now();
	console.info("time:", end - start, "ms");
	return result;
}

// NOTE: 表示言語
// export async function detectLanguage(title: string, description: string) {
// 	const [[titleResult, descResult]] = await translator.detect([
// 		title,
// 		description,
// 	]);

// 	if (!titleResult || !descResult) {
// 		return null;
// 	}

// 	return titleResult.confidence > descResult.confidence
// 		? titleResult.language
// 		: descResult.language;
// }

async function fetchWithTimeout(
	url: string,
	method: "GET" | "HEAD",
	timeout: number,
) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeout);
	try {
		const res = await fetch(url, { method, signal: controller.signal });
		if (!res.ok) {
			throw new Error();
		}
		return res.ok;
	} finally {
		clearTimeout(timer);
	}
}

// NOTE: URLチェック
export async function checkUrl(url: string): Promise<boolean> {
	let timeout = 5000;
	try {
		return await fetchWithTimeout(url, "HEAD", 2500);
	} catch (e) {
		if (e instanceof DOMException && e.name === "AbortError") {
			timeout = 2500;
		}
	}

	try {
		return await fetchWithTimeout(url, "GET", timeout);
	} catch {}

	return false;
}

export function isVideo(url: string) {
	try {
		const u = new URL(url);
		if (u.hostname.includes("youtube.com")) {
			return u.searchParams.get("v");
		}
		if (u.hostname === "youtu.be") {
			return u.pathname.slice(1);
		}
		return null;
	} catch {
		return null;
	}
}

export function normalize(string: string) {
	return string
		.replace(/[\n\t]+/g, " ")
		.replace(/\s{2,}/g, " ")
		.trim();
}

export function countGrapheme(string: string, locales: string) {
	const segmenter = new Intl.Segmenter(locales, { granularity: "grapheme" });
	return [...segmenter.segment(string)].length;
}

export function getTextInfo(html: string) {
	try {
		const $ = cheerio.load(html);
		const document = new JSDOM(html).window.document;
		const title = $("title").text();
		const article = new Readability(document).parse();
		const description = article?.textContent
			? normalize(article.textContent)
			: "";

		return { title, description };
	} catch {
		console.error("failed to  fetch");
		return null;
	}
}

export function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function guessInfo(
	title: string,
	description: string,
	langPrompt: string,
	langPrompt2: string,
) {
	try {
		return await requestOpenAI<{
			title: string;
			jaDescription: string;
			enDescription: string;
			category: string[];
			address: string;
		}>(`
			次のテキストを参照し、後述のタスクを実行してください。
			\`\`\`text
			title: ${title ?? ""}
			description: ${description ?? ""}
			\`\`\`
	
			- ${langPrompt}コンテンツの内容が少ない場合は、無理に増やさなくて大丈夫です。読んだ人が訪れたくなるような文章にしてください。推論は書かないでください。
			- ${langPrompt2}
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
				"title": "translated title",
				"jaDescription": "要約",
				"enDescription": "Description",
				"category": ["attractions", "events"],
				"address": "名古屋城",
			}
	`);
	} catch {
		return null;
	}
}

export async function getCoodinates(
	address: string,
): Promise<{ lat: number; lng: number }> {
	const res = await fetch(
		`https://maps.googleapis.com/maps/api/geocode/json?address=${address}&region=jp&key=${process.env.GOOGLE_MAP_API_KEY}`,
	);
	const json = await res.json();
	if (!json.results || json.results.length === 0) {
		return { lat: 0, lng: 0 };
	}
	return json.results[0].geometry.location;
}

export function chunk<T>(array: Array<T>, size: number) {
	const result = [];
	for (let i = 0; i < array.length; i += size) {
		result.push(array.slice(i, i + size));
	}
	return result;
}

export async function getHtml(url: string): Promise<string> {
	return fetch(url).then((res) => res.text());
}

export function extractLatLng(
	url: `https://www.google.com/maps/embed${string}`,
) {
	// 1) pb=…!3d<lat>!4d<lng>
	const pbLat = url.match(/!3d([0-9.\-]+)/);
	const pbLng = url.match(/!4d([0-9.\-]+)/);
	if (pbLat?.[1] && pbLng?.[1]) {
		return {
			lat: Number.parseFloat(pbLat[1]),
			lng: Number.parseFloat(pbLng[1]),
		};
	}

	// 2) /@<lat>,<lng>,<zoom>z
	const atMatch = url.match(/@([0-9.\-]+),([0-9.\-]+)(?:,[0-9.\-]+z)?/);
	if (atMatch?.[1] && atMatch[2]) {
		return {
			lat: Number.parseFloat(atMatch[1]),
			lng: Number.parseFloat(atMatch[2]),
		};
	}

	// 3) ?q=<lat>,<lng>
	const qMatch = url.match(/[?&]q=([0-9.\-]+),([0-9.\-]+)/);
	if (qMatch?.[1] && qMatch[2]) {
		return {
			lat: Number.parseFloat(qMatch[1]),
			lng: Number.parseFloat(qMatch[2]),
		};
	}

	// 4) ?ll=<lat>,<lng>
	const llMatch = url.match(/[?&]ll=([0-9.\-]+),([0-9.\-]+)/);
	if (llMatch?.[1] && llMatch[2]) {
		return {
			lat: Number.parseFloat(llMatch[1]),
			lng: Number.parseFloat(llMatch[2]),
		};
	}

	// 5) place 形式: /place/.../@lat,lng,z/
	const placeMatch = url.match(/place\/.*\/@([0-9.\-]+),([0-9.\-]+)/);
	if (placeMatch?.[1] && placeMatch[2]) {
		return {
			lat: Number.parseFloat(placeMatch[1]),
			lng: Number.parseFloat(placeMatch[2]),
		};
	}

	// 取得不可
	return null;
}

// async function translate(input: string[], from: "en" | "ja", to: "en" | "ja") {
// 	try {
// 		const [result] = await translator.translate(input, { from, to });
// 		return result;
// 	} catch (e) {
// 		console.error(e);
// 		return input;
// 	}
// }

export const Language = {
	EN: "EN",
	JA: "JA",
} as const;

// /**
//  * @deprecated
//  */
// export async function toTranslatedContents(content: {
// 	title: string;
// 	description: string;
// 	language: "EN" | "JA";
// }) {
// 	// ベース言語をセット
// 	const contents = [
// 		{
// 			title: content.title,
// 			description: content.description,
// 			language: content.language,
// 		},
// 	];

// 	const languages = Object.values(Language).filter(
// 		(lang) => lang !== content.language,
// 	);

// 	// ベース言語以外を翻訳してセット
// 	for (const language of languages) {
// 		const [title, description] = await translate(
// 			[content.title, content.description],
// 			toLowerCase(content.language),
// 			toLowerCase(language),
// 		);
// 		if (!title || !description) continue;
// 		contents.push({ title, description, language });
// 	}

// 	return contents;
// }

export function toLowerCase<T extends string>(string: T): Lowercase<T> {
	return string.toLowerCase() as Lowercase<T>;
}

export function toUpperCase<T extends string>(string: T): Uppercase<T> {
	return string.toUpperCase() as Uppercase<T>;
}

export async function fetchImage(url: string): Promise<File | undefined> {
	try {
		const res = await fetch(url);

		if (!res.ok) return undefined;

		const blob = await res.blob();

		if (blob.type === "text/html") {
			console.warn("HTML was returned instead of image", url);
			return undefined;
		}

		if (
			!blob.type.startsWith("image") &&
			blob.type !== "application/octet-stream"
		) {
			return undefined;
		}

		const rawName = url.split("/").pop();
		const name = decodeURIComponent(
			rawName?.split("?")[0]?.split("#")[0] ?? "file",
		);

		const ext = name.split(".").pop()?.toLowerCase();
		if (!["png", "jpg", "jpeg", "webp", "svg"].includes(ext ?? "")) {
			return undefined;
		}

		const photo = new File([blob], name, { type: blob.type });
		return photo;
	} catch (e) {
		console.info(url);
		console.error(e);
		return undefined;
	}
}

export function readJsonlToCsv(path: string) {
	try {
		const input = readJsonl(path);
		return Papa.unparse(input);
		// biome-ignore lint/suspicious/noExplicitAny: allow any
	} catch (e: any) {
		if (e.code === "ENOENT") {
			console.warn(`${path} not found`);
		}
		return undefined;
	}
}

export function toJsonl(obj: object | Array<object>) {
	if (Array.isArray(obj)) {
		return `${obj.map((data) => JSON.stringify(data)).join("\n")}\n`;
	}
	return `${JSON.stringify(obj)}\n`;
}

export function getBackgroundImageFromStyle(style: string) {
	const match = style.match(/background-image\s*:\s*url\((['"]?)(.*?)\1\)/);

	const bgImageUrl = match ? match[2] : null;

	return bgImageUrl ? bgImageUrl : null;
}

export function compact<T>(arr: Array<T | null | undefined>): Array<T> {
	return arr.filter((value): value is T => Boolean(value));
}

export function readCsv<T>(path: string) {
	const { errors, data } = Papa.parse<T>(readFileSync(path, "utf-8"), {
		header: true,
		skipEmptyLines: true,
	});
	if (errors.length) {
		console.error(errors);
	}
	return data;
}

export async function detectLanguage(title: string, description: string) {
	const result = await requestOpenAI<{
		lang: "ja" | "en";
	}>(createDetectPrompt(title, description));

	return result;
}

export async function translate(
	lang: string,
	title: string,
	description: string,
) {
	const result = await requestOpenAI<{
		title: string;
		description: string;
	}>(`
          次の title と description を${lang}に翻訳してください。翻訳は改行ごとに行い、元の文章構成を保持してください。URLが含まれる場合、そのまま残してください。
          \`\`\`text
          title: ${title ?? ""}
          description: ${description ?? ""}
          \`\`\`
      
          出力は必ずJSON形式で行ってください。
          例：
          {
						"title": "title",
						"description": "desc"
          }
      `);

	return result;
}

export function readLines(path: string) {
	return readFileSync(path, "utf-8")
		.replace(/\r\n/g, "\n")
		.split("\n")
		.filter(Boolean);
}

export function readJsonl<T>(path: string) {
	return readLines(path).map((line) => JSON.parse(line)) as Array<T>;
}

export function removeUrls(text: string) {
	const urlRegex = /\b((https?:\/\/|www\.)[^\s<>"']+)/gi;

	return text
		.replace(urlRegex, "")
		.replace(/\s{2,}/g, " ")
		.trim();
}

export function createDetectPrompt(title: string, description: string) {
	return `
次のテキストが「英語」か「日本語」か判定してください。1文字でも日本語が含まれる場合は、日本語判定にしてください。
\`\`\`text
title: ${title ?? ""}
description: ${description.slice(0, Math.max(title.length, 20)) ?? ""}
\`\`\`

出力は必ずJSON形式で行ってください。
例：
{
	"lang": "ja" // or "en",
}
`;
}

export function createSummarizePrompt(lang: "ja" | "en", description: string) {
	return `
次の description を ${
		lang === "ja"
			? "日本語で400文字程度で要約してください。"
			: "英語で200語程度で要約してください。"
	}
\`\`\`text
description: ${description ?? ""}
\`\`\`

出力は必ずJSON形式で行ってください。
例：
{
	"description": "desc"
}
`;
}

export function createTranslatePrompt(title: string, description: string) {
	return `
次の title と description を英語と日本語に翻訳してください。
\`\`\`text
title: ${title ?? ""}
description: ${description ?? ""}
\`\`\`

出力は必ずJSON形式で行ってください。
例：
{
	"en": {
		"title": "title",
		"description": "desc"
	}
	"ja": {
		"title": "タイトル",
		"description": "説明"							
	}
}
`;
}

export function createTranslateAndSummarizePrompt(
	title: string,
	description: string,
) {
	return `
次の title と description を参照し、それぞれ日本語と英語の要約を作ってください。日本語の場合、400文字程度、英語の場合、200語程度で要約してください。ただし、元の文章が短ければ、無理に増やす必要はありません。憶測で情報を追加しないでください。絶対にです。
\`\`\`text
title: ${title ?? ""}
description: ${description ?? ""}
\`\`\`

出力は必ずJSON形式で行ってください。
例：
{
	"en": {
		"title": "title",
		"description": "desc"
	}
	"ja": {
		"title": "タイトル",
		"description": "説明"
	}
}
`;
}
