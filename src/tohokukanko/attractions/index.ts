import * as cheerio from "cheerio";
import { chromium } from "playwright";
import { scrape } from "../../core.js";

async function main() {
	const base = "https://www.tohokukanko.jp/en/attractions/";

	const browser = await chromium.launch({ headless: false });
	const page = await browser.newPage();

	for (let i = 0; i < 76; i++) {
		console.info("\n", i + 1, "/", 76, "\n");

		const url = new URL(`index_${i + 1}_2______0___.html`, base).href;
		await page.goto(url, { waitUntil: "domcontentloaded" });
		await page.waitForSelector("#itemList", {
			state: "attached",
			timeout: 30000,
		});
		const html = await page.content();
		const $ = cheerio.load(html);
		const urls = $("#itemList  a")
			.map((_, a) => $(a).attr("href"))
			.get()
			.filter(Boolean)
			.map((url) => new URL(url, base).href);

		await scrape(urls, {
			dir: "tohokukanko/attractions",
			lang: "en",
			type: "SPOT",
			timeout: 0,
			convertTitle: (title) => title.split("｜")[0]?.trim() || title,
			getLocation: async (html, search) => {
				const $ = cheerio.load(html);

				const address = $('dt:contains("Address")').next("dd").text().trim();

				return await search(address);
			},
			getPhotos: (html) => {
				const $ = cheerio.load(html);
				return $("#detailImage")
					.first()
					.find("img")
					.map((_, img) => $(img).attr("src") || $(img).attr("data-src"))
					.get()
					.filter(Boolean)
					.map((url) => new URL(url, "https://www.tohokukanko.jp").href);
			},
		});
	}

	await browser.close();
}

main();

// function getPhotosHelper(selector: string) {
// 	return (html: string) => {
// 		const $ = cheerio.load(html);
// 		return $("#detailImage")
// 			.first()
// 			.find("img")
// 			.map((_, img) => $(img).attr("src") || $(img).attr("data-src"))
// 			.get()
// 			.filter(Boolean);
// 	};
// }
