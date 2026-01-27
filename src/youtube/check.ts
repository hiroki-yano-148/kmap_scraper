import { appendFileSync } from "node:fs";
import {
	createDetectPrompt,
	createTranslateAndSummarizePrompt,
	readCsv,
	readLines,
	requestOpenAI,
} from "../helpers.js";
import type { ContentBoby } from "../types.js";

async function detect(title: string, description: string) {
	const result = await requestOpenAI<{
		lang: "ja" | "en";
	}>(createDetectPrompt(title, description));
	return result;
}

// async function summarize(lang: "ja" | "en", description: string) {
// 	const result = await requestOpenAI<{
// 		description: string;
// 	}>(createSummarizePrompt(lang, description));

// 	return result;
// }

async function createDescription(lang: "ja" | "en", title: string) {
	const result = await requestOpenAI<{
		description: string;
	}>(`
次のテキストはある動画のタイトルです。タイトルから「${lang === "ja" ? "この動画は～について紹介しています。" : "This video introduces ~"}」という形式の説明文を生成してください。ただし、タイトル以上の情報は追加・推測しないでください。絶対にです。
\`\`\`text
${title ?? ""}
\`\`\`

出力は必ずJSON形式で行ってください。
例：
{
	"description": "desc"
}
`);
	return result;
}

// async function translate(title: string, description: string) {
// 	const result = await requestOpenAI<{
// 		en: {
// 			title: string;
// 			description: string;
// 		};
// 		ja: {
// 			title: string;
// 			description: string;
// 		};
// 	}>(createTranslatePrompt(title, description));

// 	return result;
// }

async function translateAndSummarize(title: string, description: string) {
	const result = await requestOpenAI<{
		en: {
			title: string;
			description: string;
		};
		ja: {
			title: string;
			description: string;
		};
	}>(createTranslateAndSummarizePrompt(title, description));

	return result;
}

async function main() {
	const csv = readCsv<{
		id: string;
		content_url: string;
		title: string;
		description: string;
	}>("./src/youtube/source2.csv");

	const result = readCsv<ContentBoby>("./result/video/content_bodies.csv");

	const source = readCsv<{ title: string; description: string; url: string }>(
		"./src/youtube/source1.csv",
	);

	// 10516件
	const done = new Set(readLines("./result/video/done.txt"));

	// 英語が日本語 / 日本語が英語
	for (const [i, row] of csv.entries()) {
		// console.log(i, row.content_url);
		if (done.has(row.content_url)) {
			console.log(row.content_url);
			continue;
		}

		const target = result.filter((a) => a.content_id === row.id);
		const s = source.find((a) => a.url === row.content_url);
		const ja = target.find((a) => a.language === "JA");
		const en = target.find((a) => a.language === "EN");

		if (!s) {
			console.warn(row.content_url, "not found");
			continue;
		}

		if (!ja || !en) {
			console.warn("nai", ja, en, row.id);
			const a = readLines("./src/youtube/delete.txt");
			if (!a.includes(row.id)) {
				appendFileSync("./src/youtube/delete.txt", `${row.id}\n`);
			}
			continue;
		}

		// const { lang } = await detect(s.title, s.description);
		// console.log(lang, s.title, s.description);
		// const summarized = s.description
		// 	? await summarize(lang, removeUrls(s.description))
		// 	: await createDescription(lang, s.title);

		if (!s.description) {
			const b = readLines("./src/youtube/based_on_title.txt");
			if (!b.includes(row.id)) {
				appendFileSync(
					"./src/youtube/based_on_title.txt",
					`${target[0]?.content_id}\n`,
				);
			}
			const { lang } = await detect(s.title, s.description);
			s.description = await createDescription(lang, s.title).then(
				({ description }) => description,
			);
		}

		try {
			const translated = await translateAndSummarize(s.title, s.description);

			console.log({ translated });

			const jaResult = {
				id: ja.id,
				title: translated.ja.title,
				description: translated.ja.description,
				url: s.url,
			};

			const enResult = {
				id: en.id,
				title: translated.en.title,
				description: translated.en.description,
				url: s.url,
			};

			appendFileSync("./result/video/done.txt", `${row.content_url}\n`);

			appendFileSync(
				"./src/youtube/tmp.jsonl",
				`${JSON.stringify(jaResult)}\n${JSON.stringify(enResult)}\n`,
			);
		} catch {
			continue;
		}

		console.info("\n", "completed:", i + 1, "/", csv.length);

		// sleep(1000);
	}
}

await main();
