import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import Papa from "papaparse";
import { readCsv } from "../helpers.js";

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

	mkdirSync("./src/youtube/result_empty", { recursive: true });

	if (existsSync("./src/youtube/delete.txt")) {
		const d = readFileSync("./src/youtube/delete.txt", "utf-8")
			.replace(/\r\n/g, "\n")
			.split("\n")
			.filter(Boolean);

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

	const tmp: { id: string; title: string; description: string }[] =
		readFileSync("./src/youtube/tmp_empty.jsonl", "utf-8")
			.replace(/\r\n/g, "\n")
			.split("\n")
			.filter(Boolean)
			.map((data) => JSON.parse(data));

	const sqls: string[] = [];

	for (const data of tmp) {
		const index = result.findIndex((a) => a.id === data.id);
		if (index === -1 || !result[index]) continue;
		const index2 = result2.findIndex((a) => a.id === result[index]?.content_id);
		if (index2 === -1 || !result2[index2]) continue;
		result[index].title = data.title;
		result[index].description = data.description;
		const metadata = {
			...JSON.parse(result2[index2].metadata),
			based_on_title: true,
		};
		result2[index2].metadata = JSON.stringify(metadata);

		sqls.push(
			`update content_bodies set title = '${data.title.replace(/'/g, "''")}', description = '${data.description.replace(/'/g, "''")}' where id = '${data.id}';`,
		);
	}

	const csv = Papa.unparse(result);
	writeFileSync("./result/video/content_bodies.csv", csv);

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
		writeFileSync(`./src/youtube/result3/update${i + 1}.sql`, sql.join("\n"));
	}
}

main();
