import { appendFileSync, readFileSync } from "node:fs";
import { readCsv, requestOpenAI } from "../helpers.js";
import type { ContentBoby } from "../types.js";

async function detect(title: string) {
	const result = await requestOpenAI<{
		lang: "ja" | "en";
	}>(`
          次のテキストが「英語」か「日本語」か判定してください。アルファベットで表記された日本語は英語と考えてよいです。1文字でも日本語が含まれる場合は、日本語判定にしてください。
          \`\`\`text
          ${title ?? ""}
          \`\`\`
      
          出力は必ずJSON形式で行ってください。
          例：
          {
            "lang": "ja" // or "en",
          }
      `);
	return result;
}

async function createDescription(title: string) {
	const result = await requestOpenAI<{
		description: string;
	}>(`
          次のテキストはある動画のタイトルです。タイトルから「～について説明しています」という形式の説明文を生成してください。ただし、タイトル以上の情報は追加・推測しないでください。絶対にです。
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

async function translate(lang: string, title: string, description: string) {
	const result = await requestOpenAI<{
		title: string;
		description: string;
	}>(`
          次の title と description を${lang}に翻訳してください。翻訳は改行ごとに行い、元の文章構成を保持してください。URLはそのまま残してください。
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

async function main() {
	// const source = readFileSync("./src/youtube/source.csv", "utf-8");
	const csv = readCsv<{
		id: string;
		content_url: string;
		title: string;
		description: string;
	}>("./src/youtube/empty.csv");

	const result = readCsv<ContentBoby>("./result/video/content_bodies.csv");

	const source = readCsv<{ title: string; description: string; url: string }>(
		"./src/youtube/source.csv",
	);

	const done = new Set(
		readFileSync("./result/video/done.txt", "utf-8")
			.replace(/\r\n/g, "\n")
			.split("\n")
			.filter(Boolean),
	);

	for (const [i, row] of csv.entries()) {
		console.log(i, row.content_url);
		if (done.has(row.content_url)) {
			console.log(row.content_url);
			continue;
		}

		const a = result.filter((a) => a.content_id === row.id);
		const s = source.find((a) => a.url === row.content_url);
		const ja = a.find((a) => a.language === "JA");
		const en = a.find((a) => a.language === "EN");

		if (!s) {
			console.warn(row.content_url, "not found");
			continue;
		}

		if (!ja || !en) {
			console.warn("nai", ja, en, row.id);
			// const a = readFileSync("./src/youtube/delete.txt", "utf-8")
			// 	.replace(/\r\n/g, "\n")
			// 	.split("\n")
			// 	.filter(Boolean);
			// if (!a.includes(row.id)) {
			// 	appendFileSync("./src/youtube/delete.txt", `${row.id}\n`);
			// }
			continue;
		}

		const { lang } = await detect(s.title);
		const { description: descriptionFromTitle } = await createDescription(
			s.title,
		);
		// console.log(lang, s.title, s.description);
		try {
			const { title, description } = await translate(
				lang === "en" ? "日本語" : "英語",
				s.title,
				descriptionFromTitle,
			);

			appendFileSync("./result/video/done.txt", `${row.content_url}\n`);

			const jaResult = {
				id: ja.id,
				title: lang === "ja" ? s.title : title,
				description: lang === "ja" ? descriptionFromTitle : description,
				url: s.url,
			};

			const enResult = {
				id: en.id,
				title: lang === "en" ? s.title : title,
				description: lang === "en" ? descriptionFromTitle : description,
				url: s.url,
			};

			appendFileSync(
				"./src/youtube/tmp_empty.jsonl",
				`${JSON.stringify(jaResult)}\n`,
			);
			appendFileSync(
				"./src/youtube/tmp_empty.jsonl",
				`${JSON.stringify(enResult)}\n`,
			);
		} catch {
			continue;
		}

		console.info("\n", "completed:", i + 1, "/", csv.length);

		// sleep(1000);
	}
}

await main();
