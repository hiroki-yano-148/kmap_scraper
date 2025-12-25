import { scrape } from "../../core.js";

async function main() {
	const base = "https://www.tohokukanko.jp/en/attractions/";

	await scrape({
		dir: "tohokukanko/attractions",
		lang: "en",
		type: "SPOT",
		timeout: 0,
		listUrls: Array.from(
			{ length: 76 },
			(_, i) => new URL(`index_${i + 1}_2______0___.html`, base).href,
		),
		getDetailUrls: ($) => {
			return $("#itemList  a")
				.map((_, a) => $(a).attr("href"))
				.get()
				.filter(Boolean)
				.map((url) => new URL(url, base).href);
		},
		convertTitle: (title) => title.split("｜")[0]?.trim() || title,
		getLocation: async ($, search) => {
			const address = $('dt:contains("Address")').next("dd").text().trim();

			return await search(address);
		},
		getPhotos: ($) => {
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

main();

// function getPhotosHelper(selector: string) {
// 	return (html: string) => {
//
// 		return $("#detailImage")
// 			.first()
// 			.find("img")
// 			.map((_, img) => $(img).attr("src") || $(img).attr("data-src"))
// 			.get()
// 			.filter(Boolean);
// 	};
// }
