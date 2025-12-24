import * as cheerio from "cheerio";
import { chromium } from "playwright";
import { scrape } from "../../core.js";

async function main() {
	const base = "https://en.japantravel.com/search?sort=relevance&type=article";

	const browser = await chromium.launch({ headless: false });
	const page = await browser.newPage();

	for (let i = 0; i < 1; i++) {
		console.info("\n", i + 1, "/", 1159, "\n");

		const url = `${base}&p=${i + 1}`;
		await page.goto(url, { waitUntil: "domcontentloaded" });
		await page.waitForSelector(".article-list", {
			state: "attached",
			timeout: 30000,
		});
		const html = await page.content();
		const $ = cheerio.load(html);
		const urls = $(".article-list > a")
			.map((_, a) => $(a).attr("href"))
			.get()
			.filter(Boolean)
			.map((url) => new URL(url, "https://en.japantravel.com/").href);

		await scrape(urls, {
			dir: "japantravel/article",
			type: "ARTICLE",
			timeout: 6000,
			convertTitle: (title) => title.split("-")[0]?.trim() || title,
			getLocation: (html) => {
				const $ = cheerio.load(html);

				const center = $("[data-center]").first().attr("data-center");

				if (!center) return null;

				const [lat, lng] = center.split(",");

				return lat && lng
					? { lat: Number.parseFloat(lat), lng: Number.parseFloat(lng) }
					: null;
			},
			getPhotos: (html) => {
				const $ = cheerio.load(html);
				return $(".article")
					.first()
					.children(":not(.article-user)")
					.find("img")
					.map((_, img) => $(img).attr("src") || $(img).attr("data-src"))
					.get()
					.filter(Boolean);
			},
		});
	}

	await browser.close();
}

main();
