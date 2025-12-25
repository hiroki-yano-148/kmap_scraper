import { scrape } from "../../core.js";

async function main() {
	await scrape({
		dir: "japan.travel",
		type: "SPOT",
		listUrls: ["https://www.japan.travel/en/japans-local-treasures/all/"],
		getDetailUrls: ($) => {
			return $("related-articles a")
				.map((_, a) => $(a).attr("href"))
				.get()
				.filter(Boolean)
				.map((url) => new URL(url, "https://www.japan.travel").href);
		},
		getLocation: () => null,
		getPhotos: ($) => {
			const style = $(".mod-slider-video__poster").attr("style") ?? "";

			const match = style.match(/background-image\s*:\s*url\((['"]?)(.*?)\1\)/);

			const bgImageUrl = match ? match[2] : null;

			return bgImageUrl ? [bgImageUrl] : null;
		},
	});
}

main();
