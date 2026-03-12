import { writeFileSync } from "node:fs";
import { chunk, readCsv } from "../helpers.js";

function main() {
	const csv1 = readCsv<{
		channel_id: string;
		channel_title: string;
		url: string;
	}>("./src/youtube/source1.csv");
	const csv2 = readCsv<{
		id: string;
		vid: string;
		content_url: string;
		metadata: string;
	}>("./src/youtube/source3.csv");

	const sqls: string[] = [];

	for (const [i, row] of csv2.entries()) {
		const data = csv1.find((row1) => row1.url === row.content_url);
		if (!data) continue;
		const metadata = row.metadata === "null" ? {} : JSON.parse(row.metadata);
		delete metadata.channel_id;
		delete metadata.channel_name;
		const vmetadata: Record<string, unknown> = {};
		vmetadata.channel_id = data.channel_id;
		vmetadata.channel_name = data.channel_title.replace(/'/g, "''");
		const metadatastr =
			JSON.stringify(metadata) === "{}"
				? "NULL"
				: `'${JSON.stringify(metadata)}'`;

		const sql = `update contents set metadata = ${metadatastr} where id = '${row.id}';`;
		const sql2 = `update videos set metadata = '${JSON.stringify(vmetadata)}' where id = '${row.vid}';`;
		sqls.push(sql);
		sqls.push(sql2);
		console.log(i);
	}

	for (const [i, sql] of chunk(sqls, 5500).entries()) {
		writeFileSync(
			`./src/youtube/result/update_channel_${i + 1}.sql`,
			sql.join("\n"),
		);
	}
}

main();
