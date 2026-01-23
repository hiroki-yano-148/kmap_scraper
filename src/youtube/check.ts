import { appendFileSync, readFileSync } from "node:fs";
import { readCsv, requestOpenAI } from "../helpers.js";
import type { ContentBoby } from "../types.js";

async function detect(title: string, description: string) {
	const result = await requestOpenAI<{
		lang: "ja" | "en";
	}>(`
          次のテキストが「英語」か「日本語」か判定してください。1文字でも日本語が含まれる場合は、日本語判定にしてください。
          \`\`\`text
          title: ${title ?? ""}
          description: ${description.slice(0, 20) ?? ""}
          \`\`\`
      
          出力は必ずJSON形式で行ってください。
          例：
          {
            "lang": "ja" // or "en",
          }
      `);

	return result;
}

async function translate(lang: string, title: string, description: string) {
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

async function main() {
	// const source = readFileSync("./src/youtube/source.csv", "utf-8");
	const csv1 = readCsv<{
		id: string;
		content_url: string;
		title: string;
		description: string;
	}>("./src/youtube/invalid_en.csv");
	const csv2 = readCsv<{
		id: string;
		content_url: string;
		title: string;
		description: string;
	}>("./src/youtube/invalid_ja.csv");

	const result = readCsv<ContentBoby>("./result/video/content_bodies.csv");

	const source = readCsv<{ title: string; description: string; url: string }>(
		"./src/youtube/source.csv",
	);

	// 5574件
	// const urls = [...urls1, ...urls2];

	// 10516件
	const done = new Set(
		readFileSync("./result/video/done.txt", "utf-8")
			.replace(/\r\n/g, "\n")
			.split("\n")
			.filter(Boolean),
	);

	// 4942件
	// writeFileSync(
	// 	"./result/video/done.txt",
	// 	done.filter((d) => !urls.includes(d)).join("\n"),
	// );

	// // 1711件
	// const a = csv.filter((row) =>
	// 	csv1.map((row) => row.content_url).includes(row.url),
	// );

	// // 3376件
	// const b = csv.filter((row) =>
	// 	csv2.map((row) => row.content_url).includes(row.url),
	// );

	const csvs = [...csv1, ...csv2];

	// 英語が日本語 / 日本語が英語
	for (const [i, row] of csvs.entries()) {
		if (done.has(row.content_url)) continue;

		const a = result.filter((a) => a.content_id === row.id);
		const s = source.find((a) => a.url === row.content_url);
		const ja = a.find((a) => a.language === "JA");
		const en = a.find((a) => a.language === "EN");

		if (!s) {
			console.warn(row.content_url, "not found");
			continue;
		}

		if (!ja || !en) {
			const a = readFileSync("./src/youtube/delete.txt", "utf-8")
				.replace(/\r\n/g, "\n")
				.split("\n")
				.filter(Boolean);
			if (!a.includes(row.id)) {
				appendFileSync("./src/youtube/delete.txt", `${row.id}\n`);
			}
			continue;
		}

		const { lang } = await detect(s.title, s.description);
		// console.log(lang, s.title, s.description);
		try {
			const { title, description } = await translate(
				lang === "en" ? "日本語" : "英語",
				s.title,
				s.description,
			);

			// console.log(lang, s.title, title, s.description, description);

			appendFileSync("./result/video/done.txt", `${row.content_url}\n`);

			const jaResult = {
				id: ja.id,
				title: lang === "ja" ? s.title : title,
				description: lang === "ja" ? s.description : description,
				url: s.url,
			};

			const enResult = {
				id: en.id,
				title: lang === "en" ? s.title : title,
				description: lang === "en" ? s.description : description,
				url: s.url,
			};

			appendFileSync(
				"./src/youtube/tmp.jsonl",
				`${JSON.stringify(jaResult)}\n`,
			);
			appendFileSync(
				"./src/youtube/tmp.jsonl",
				`${JSON.stringify(enResult)}\n`,
			);
		} catch {
			continue;
		}

		console.info("\n", "completed:", i + 1, "/", csvs.length);

		// sleep(1000);
	}
}

await main();
