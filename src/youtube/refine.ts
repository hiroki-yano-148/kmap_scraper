import { readFileSync, writeFileSync } from "node:fs";
import Papa from "papaparse";
import type { Content } from "../types.js";

async function main() {
	const text = readFileSync("./result/video/contents.csv", "utf-8");
	const csv = Papa.parse<Content & { actual_language?: string }>(text, {
		header: true,
	}).data;

	for (const row of csv) {
		if (
			row.metadata &&
			row.actual_language !== "JA" &&
			row.actual_language !== "EN"
		) {
			const metadata = {
				...JSON.parse(row.metadata),
				actual_language: row.actual_language,
			};
			row.metadata = JSON.stringify(metadata);
		}
		delete row.actual_language;

		writeFileSync("./result/video/contents_refined.csv", Papa.unparse(csv));
	}
}

await main();
