import { scrape } from "../../core.js";

async function main() {
	const base = "https://en.japantravel.com/search?sort=relevance&type=article";

	await scrape({
		dir: "japantravel/article",
		lang: "en",
		type: "ARTICLE",
		timeout: 10000,
		listUrls: Array.from({ length: 1159 }, (_, i) => `${base}&p=${i + 1}`),
		getDetailUrls: ($) => {
			return $(".article-list > a")
				.map((_, a) => $(a).attr("href"))
				.get()
				.filter(Boolean)
				.map((url) => new URL(url, "https://en.japantravel.com/").href);
		},
		convertTitle: (title) => title.split("-")[0]?.trim() || title,
		getLocation: ($) => {
			const center = $("[data-center]").first().attr("data-center");

			if (!center) return null;

			const [lat, lng] = center.split(",");

			return lat && lng ? { lat, lng } : null;
		},
		getPhotos: ($) => {
			return $(".coverphoto")
				.first()
				.find("img")
				.map((_, img) => $(img).attr("src"))
				.get()
				.filter(Boolean);
		},
	});
}

main();
