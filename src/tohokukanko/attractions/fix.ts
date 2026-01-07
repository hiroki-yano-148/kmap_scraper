import * as cheerio from "cheerio";
import { appendFileSync, readFileSync } from "node:fs";

async function main() {
	const inputs = readFileSync(
		"./result/tohokukanko/attractions/contents.jsonl",
		"utf-8",
	)
		.split("\n")
		.filter(Boolean)
		.map((value) => JSON.parse(value));

	console.log({ inputs });

	// const result = [];

	for (const input of inputs) {
		const html = await fetch(input.content_url).then((res) => res.text());
		const $ = cheerio.load(html);
		const url = $(".linkBut")
			.filter((_, el) => {
				return $(el).text().includes("View on Google Maps");
			})
			.first()
			.attr("href");

		const location = url
			? new URL(url).searchParams.get("q")?.split(",")
			: undefined;
		if (!location?.[0] || !location[1]) {
			console.log(input.content_url);
			appendFileSync(
				"./result/tohokukanko/attractions/contents2.jsonl",
				`${JSON.stringify(input)}\n`,
			);
			continue;
		}

		const output = `${JSON.stringify({
			...input,
			lat: Number.parseFloat(location[0]),
			lng: Number.parseFloat(location[1]),
		})}\n`;

		appendFileSync("./result/tohokukanko/attractions/contents2.jsonl", output);

		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
}

await main();
