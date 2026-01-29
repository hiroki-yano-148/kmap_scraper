import { writeFileSync } from "node:fs";
import Papa from "papaparse";
import { readCsv } from "../helpers.js";

function main() {
	const result2 = readCsv<{
		id: string;
		metadata: string;
		is_invalid: boolean;
		invalid_reason: string;
	}>("./result/video/contents.csv");

	for (let i = 0; i < result2.length; i++) {
		if (!result2 || !result2[i]) continue;
		result2[i]!.is_invalid = false;
		result2[i]!.invalid_reason = "";
	}

	const sqls2: string[] = [];

	for (const { id } of readCsv<{ id: string }>(
		"./src/youtube/expected_en.csv",
	)) {
		const index = result2.findIndex((a) => a.id === id);
		if (!result2[index]) continue;
		result2[index].is_invalid = true;
		result2[index].invalid_reason = "英語を想定";
		sqls2.push(
			`update contents set is_invalid = true, invalid_reason = '英語を想定' where id = '${id}';`,
		);
	}

	for (const { id } of readCsv<{ id: string }>(
		"./src/youtube/expected_ja.csv",
	)) {
		const index = result2.findIndex((a) => a.id === id);
		if (!result2[index]) continue;
		result2[index].is_invalid = true;
		result2[index].invalid_reason = "日本語を想定";
		sqls2.push(
			`update contents set is_invalid = true, invalid_reason = '日本語を想定' where id = '${id}';`,
		);
	}

	for (const { id } of readCsv<{ id: string }>("./src/youtube/nagano.csv")) {
		const index = result2.findIndex((a) => a.id === id);
		if (!result2[index]) continue;
		result2[index].is_invalid = true;
		result2[index].invalid_reason = "長野県";
		sqls2.push(
			`update contents set is_invalid = true, invalid_reason = '長野県' where id = '${id}';`,
		);
	}

	writeFileSync("./src/youtube/result/invalid.sql", sqls2.join("\n"));

	const csv2 = Papa.unparse(result2);
	writeFileSync("./result/video/contents.csv", csv2);
}

main();
