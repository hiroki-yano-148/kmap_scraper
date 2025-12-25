import { scrape } from "../../core.js";

async function main() {
	const base = "https://japancheapo.com/place/page";

	await scrape({
		dir: "japancheapo/place",
		type: "SPOT",
		listUrls: Array.from({ length: 48 }, (_, i) => `${base}/${i + 1}`),
		getDetailUrls: ($) => {
			return $(".grid .article a")
				.map((_, a) => $(a).attr("href"))
				.get()
				.filter(Boolean);
		},
		getLocation: ($) => {
			const [href] = $(".section--info-box__map-link a")
				.map((_, a) => $(a).attr("href"))
				.get()
				.filter(Boolean);
			if (!href) return null;
			const center = new URL(href).searchParams.get("center");
			if (!center) return null;
			const [lat, lng] = center.split(",").map(Number);
			return lat && lng ? { lat, lng } : null;
		},
		getPhotos: ($) => {
			return $("#hero-img")
				.map((_, img) => $(img).attr("src"))
				.get();
		},
	});
}

main();
