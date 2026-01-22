import { readFileSync, writeFileSync } from "node:fs";
import { readCsv } from "../helpers.js";

function main() {
	const d = readFileSync("./src/youtube/delete.txt", "utf-8")
		.split("\n")
		.filter(Boolean)
		.join(",");

	writeFileSync(
		"./src/youtube/delete.sql",
		`
delete from contents where id in (${d})
    `,
	);

	const result = readCsv<{ id: string; title: string; description: string }>(
		"./result/video/content_bodies.csv",
	);
	const tmp: { id: string; title: string; description: string }[] =
		readFileSync("./src/youtube/tmp.jsonl", "utf-8")
			.split("\n")
			.filter(Boolean)
			.map((data) => JSON.parse(data));

	for (const data of tmp) {
		const index = result.findIndex((a) => a.id === data.id);
		if (index === -1 || !result[index]) continue;
		result[index].title = data.title;
		result[index].description = data.description;
	}

	writeFileSync("./result/video/content_bodies.csv", JSON.stringify(result));
}

main();
