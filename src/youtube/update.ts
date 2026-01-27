import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import Papa from "papaparse";
import { readCsv, readJsonl, readLines } from "../helpers.js";

function main() {
	const result = readCsv<{
		id: string;
		title: string;
		description: string;
		content_id: string;
	}>("./result/video/content_bodies.csv");

	const result2 = readCsv<{ id: string; metadata: string }>(
		"./result/video/contents.csv",
	);

	mkdirSync("./src/youtube/result", { recursive: true });

	if (existsSync("./src/youtube/delete.txt")) {
		const d = readLines("./src/youtube/delete.txt");

		for (const id of d) {
			const index = result.findIndex((a) => a.id === id);
			result.splice(index, 1);
		}

		writeFileSync(
			"./src/youtube/result/delete.sql",
			`
delete from contents where id in (${d.map((d) => `'${d}'`).join(",")})
    `,
		);
	}

	if (existsSync("./src/youtube/based_on_title.txt")) {
		const d = readLines("./src/youtube/based_on_title.txt");

		const sqls2: string[] = [];

		for (const id of d) {
			const index = result2.findIndex((a) => a.id === id);
			if (!result2[index]) continue;
			const metadata = {
				...JSON.parse(result2[index].metadata),
				based_on_title: true,
			};
			result2[index].metadata = JSON.stringify(metadata);
			sqls2.push(
				`update contents set metadata = '${JSON.stringify(metadata)}' where id = '${result[index]?.content_id}';`,
			);
		}

		writeFileSync("./src/youtube/result/based_on_title.sql", sqls2.join("\n"));
	}

	const tmp = readJsonl<{ id: string; title: string; description: string }>(
		"./src/youtube/tmp.jsonl",
	);

	const sqls: string[] = [];

	for (const data of tmp) {
		const index = result.findIndex((a) => a.id === data.id);
		if (index === -1 || !result[index]) continue;
		result[index].title = data.title;
		result[index].description = data.description;

		sqls.push(
			`update content_bodies set title = '${data.title.replace(/'/g, "''")}', description = '${data.description.replace(/'/g, "''")}' where id = '${data.id}';`,
		);
	}

	const csv = Papa.unparse(result);
	writeFileSync("./result/video/content_bodies.csv", csv);

	const csv2 = Papa.unparse(result2);
	writeFileSync("./result/video/contents.csv", csv2);

	let count = 0;
	let index = 0;
	const q: string[][] = [];

	for (const sql of sqls) {
		count += sql.replace(/\r\n/g, "\n").split("\n").length;
		if (!q[index]) q[index] = [];
		q[index]?.push(sql);
		if (count > 9999) {
			index += 1;
			count = 0;
		}
	}

	for (const [i, sql] of q.entries()) {
		writeFileSync(`./src/youtube/result/update${i + 1}.sql`, sql.join("\n"));
	}
}

main();
