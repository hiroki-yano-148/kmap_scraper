import { readFileSync, writeFileSync } from "node:fs";
import { readCsv } from "../helpers.js";

function main() {
	const urls2 = readCsv<{ content_url: string }>("./src/youtube/empty.csv").map(
		(d) => d.content_url,
	);

	// const urls1 = readCsv<{ content_url: string }>(
	// 	"./src/youtube/invalid_ja3.csv",
	// ).map((d) => d.content_url);

	const a = readFileSync("./result/video/done.txt", "utf-8")
		.replace(/\r\n/g, "\n")
		.split("\n")
		.filter(Boolean)
		.filter((a) => ![...urls2].includes(a));

	writeFileSync("./result/video/done.txt", a.join("\r\n"));
}

main();
