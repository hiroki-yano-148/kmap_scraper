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

	const r3 = readCsv<{ content_id: string }>(
		"./result/video/content_photos.csv",
	);

	const r4 = readCsv<{ content_id: string; id: string }>(
		"./result/video/content_types.csv",
	);

	const r5 = readCsv<{ content_id: string }>(
		"./result/video/content_category_mappings.csv",
	);

	const r6 = readCsv<{ content_type_id: string }>("./result/video/videos.csv");

	mkdirSync("./src/youtube/result", { recursive: true });

	let _r5: { content_id: string }[] = [];

	if (existsSync("./src/youtube/delete.txt")) {
		const d = readLines("./src/youtube/delete.txt");

		for (const id of d) {
			const index = result2.findIndex((a) => a.id === id);
			result2.splice(index, 1);
		}

		for (const id of d) {
			const index = result.findIndex((a) => a.content_id === id);
			result.splice(index, 1);
		}

		for (const id of d) {
			const index = r3.findIndex((a) => a.content_id === id);
			r3.splice(index, 1);
		}

		for (const id of d) {
			const index = r4.findIndex((a) => a.content_id === id);
			const index2 = r6.findIndex((a) => a.content_type_id === r4[index]?.id);
			r4.splice(index, 1);
			r6.splice(index2, 1);
		}

		_r5 = r5.filter((a) => !d.includes(a.content_id));

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

	const csv3 = Papa.unparse(r3);
	writeFileSync("./result/video/content_photos.csv", csv3);

	const csv4 = Papa.unparse(r4);
	writeFileSync("./result/video/content_types.csv", csv4);

	const csv5 = Papa.unparse(_r5);
	writeFileSync("./result/video/content_category_mappings.csv", csv5);

	const csv6 = Papa.unparse(r6);
	writeFileSync("./result/video/videos.csv", csv6);

	let count = 0;
	let index = 0;
	const q: string[][] = [];

	for (const sql of sqls) {
		count += sql.replace(/\r\n/g, "\n").split("\n").length;
		if (!q[index]) q[index] = [];
		q[index]?.push(sql);
		if (count > 999) {
			index += 1;
			count = 0;
		}
	}

	for (const [i, sql] of q.entries()) {
		writeFileSync(`./src/youtube/result/update${i + 1}.sql`, sql.join("\n"));
	}
}

main();
