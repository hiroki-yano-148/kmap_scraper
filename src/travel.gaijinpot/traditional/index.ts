import { scrape } from "../../core.js";
import { extractLatLng, getBackgroundImageFromStyle } from "../../helpers.js";

async function main() {
	await scrape({
		dir: "travel.gaijinpot",
		type: "ARTICLE",
		listUrls: Array.from(
			{ length: 57 },
			(_, i) =>
				`https://travel.gaijinpot.com/category/traditional/page/${i + 1}/`,
		),
		getDetailUrls: ($) => {
			return $(".content row a")
				.map((_, a) => $(a).attr("href"))
				.get()
				.filter(Boolean);
		},
		getLocation: ($) => {
			const src = $("embed-responsive iframe").attr("src");
			if (!src) return null;
			return extractLatLng(src as any);
		},
		getPhotos: ($) => {
			const style = $(".hero").attr("style") ?? "";
			const bgImageUrl = getBackgroundImageFromStyle(style);
			return bgImageUrl ? [bgImageUrl] : null;
		},
	});
}

main();
