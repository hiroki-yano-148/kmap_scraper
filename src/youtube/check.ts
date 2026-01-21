import { appendFileSync, readFileSync } from "node:fs";
import { readCsv, requestOpenAI, sleep } from "../helpers.js";
import type { ContentBoby } from "../types.js";

async function t(title: string, description: string) {
	const result = await requestOpenAI<{
		lang: "en" | "ja";
		title: string;
		description: string;
	}>(`
          次のテキストを参照し、後述のタスクを実行してください。
          \`\`\`text
          title: ${title ?? ""}
          description: ${description ?? ""}
          \`\`\`
      
          - テキストが「英語」か「日本語」か判定してください。
          - title と description を英語ならば日本語に、日本語ならば英語に翻訳してください。翻訳した内容を返してください。

          出力は必ずJSON形式で行ってください。
          例：
          {
            "lang": "ja" // or "en",
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
	for (const row of csv1.slice(0, 5)) {
		const index = result.findIndex((a) => a.content_id === row.id);
		const { lang, title, description } = await t(row.title, row.description);
		if (!result[index]) continue;
		result[index].title = title;
		result[index].description = description;
		console.log(lang, row.title, row.description, title, description);
		appendFileSync("./result/video/done.txt", row.content_url);
		sleep(1000);
	}

	// 日本語が英語
	for (const url of csv2.map((row) => row.content_url)) {
	}
}

await main();
