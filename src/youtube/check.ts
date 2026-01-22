import { appendFileSync, readFileSync } from "node:fs";
import { readCsv, requestOpenAI, sleep } from "../helpers.js";
import type { ContentBoby } from "../types.js";

async function detect(title: string, description: string) {
	const result = await requestOpenAI<{
		lang: "ja" | "en";
	}>(`
          次のテキストが「英語」か「日本語」か判定してください。
          \`\`\`text
          title: ${title.slice(0, 20) ?? ""}
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

	const urls1 = csv1.map((row) => row.content_url);
	const urls2 = csv2.map((row) => row.content_url);
	// 5574件
	const urls = [...urls1, ...urls2];

	// 10516件
	const done = readFileSync("./result/video/done.txt", "utf-8")
		.split("\n")
		.filter(Boolean);

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

	// let count1 = 0;
	// let count2 = 0;
	// for (const x of a) {
	// 	const titles = csv1.map((row) => row.title);
	// 	const descs = csv1.map((row) => row.description);

	// 	if (!titles.includes(x.title)) {
	// 		console.log(x.url);
	// 		count1++;
	// 	}
	// 	if (!descs.includes(x.description)) {
	// 		count2++;
	// 	}
	// }

	// let count3 = 0;
	// let count4 = 0;
	// for (const x of b) {
	// 	const titles = csv2.map((row) => row.title);
	// 	const descs = csv2.map((row) => row.description);
	// 	if (titles.includes(x.title)) {
	// 		count3++;
	// 	}
	// 	if (descs.includes(x.description)) {
	// 		count4++;
	// 	}
	// }

	// console.log(a.length, b.length, count1, count2, count3, count4);

	// 英語が日本語
	for (const row of csv1.slice(0, 10)) {
		const a = result.filter((a) => a.content_id === row.id);
		const s = source.find((a) => a.url === row.content_url);
		const ja = a.find((a) => a.language === "JA");
		const en = a.find((a) => a.language === "EN");

		if (!s) {
			console.warn(row.content_url, "not found");
			continue;
		}

		if (!ja || !en) {
			appendFileSync("./src/youtube/delete.txt", `${row.id}\n`);
			continue;
		}

		const { lang } = await detect(s.title, s.description);
		const { title, description } = await translate(
			lang === "en" ? "日本語" : "英語",
			s.title,
			s.description,
		);

		// appendFileSync("./result/video/done.txt", `${row.content_url}\n`);

		// console.log({
		// 	lang: lang === "en" ? "日本語" : "英語",
		// 	title: `${s.title} -> ${title}`,
		// 	description: `${s.description} -> ${description}`,
		// });

		const jaResult = {
			id: ja.id,
			title: lang === "ja" ? s.title : title,
			description: lang === "ja" ? s.description : description,
		};

		const enResult = {
			id: en.id,
			title: lang === "en" ? s.title : title,
			description: lang === "en" ? s.description : description,
		};

		appendFileSync("./src/youtube/tmp.jsonl", `${JSON.stringify(jaResult)}\n`);
		appendFileSync("./src/youtube/tmp.jsonl", `${JSON.stringify(enResult)}\n`);

		sleep(1000);
	}

	// 日本語が英語
	for (const url of csv2.map((row) => row.content_url)) {
	}
}

await main();
