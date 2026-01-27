import * as cheerio from "cheerio";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import Papa from "papaparse";
import XLSX from "xlsx";
import {
	checkUrl,
	chunk,
	detectLanguage,
	getCoodinates,
	readLines,
	requestOpenAI,
} from "../helpers.js";

interface Result {
	// id: string;
	url: string;
	lat?: number;
	lon?: number;
	photo?: string;
	title?: string;
	description?: string;
	category?: string[];
	lang?: "en" | "ja";
	type?: string;
	metadata?: string;
	postalcode?: string;
	status?: "privated" | "suspended";
}

function isObjectLike(value: unknown): value is object {
	return typeof value === "object" && value != null;
}

function extractText(html: string) {
	const $ = cheerio.load(html);

	$("br").replaceWith("\n");

	return $.root().text().length > 1000
		? `${$.root().text().slice(0, 996)} ...`
		: $.root().text().slice(0, 1000);
}

async function main() {
	let total = 0;

	async function convertExcelToCsv(inputPath: string, outputDir: string) {
		const wb = XLSX.readFile(inputPath);

		// Excel読込
		const base = XLSX.utils.sheet_to_json<{
			ID: number;
			Title: string;
			Description: string;
			Guidances: string;
		}>(wb.Sheets["Products"]!); // 基準ファイル
		const info = XLSX.utils.sheet_to_json<{
			"Product ID": number;
			Latitude: number;
			Longitude: number;
			"Postal code": string;
			"Country code": string;
		}>(wb.Sheets["Meeting points"]!); // 1対1追加情報
		const images = XLSX.utils.sheet_to_json<{
			"Product ID": number;
			"Photo URL": string;
		}>(wb.Sheets["Photos"]!); // 親画像（1対多）

		// 画像情報をIDごとにグルーピング
		const imageMap: Record<number, string[]> = {};
		for (const row of images) {
			const id = Number(row["Product ID"]);
			if (!id) continue;

			if (!imageMap[id]) {
				imageMap[id] = [];
			}
			if (row["Photo URL"])
				imageMap[id].push(encodeURIComponent(row["Photo URL"]));
		}

		// info を ID → row に変換（O(1)で参照）
		const infoMap = Object.fromEntries(
			info.map((r) => [Number(r["Product ID"]), r]),
		);

		// マージ結果作成
		const merged = base
			.map((b) => {
				const id = Number(b.ID);

				return {
					...{
						ID: b.ID,
						Title: b.Title,
						Description: b.Description,
						Guidances: b.Guidances,
					},
					...(infoMap[id]
						? {
								Latitude: infoMap[id].Latitude,
								Longitude: infoMap[id].Longitude,
								"Postal code": infoMap[id]["Postal code"],
								"Country code": infoMap[id]["Country code"],
							}
						: {}),
					images: imageMap[id] ? imageMap[id][0] : "", // カンマ区切りに変換
				};
			})
			.filter(
				(data) =>
					!inputPath.includes("VoiceMap") || data["Country code"] === "JP",
			);

		total += merged.length;

		const ws = XLSX.utils.json_to_sheet(merged);

		const csv = XLSX.utils.sheet_to_csv(ws, { blankrows: false });
		if (!csv) return;
		writeFileSync(path.join(outputDir, `merged.csv`), csv);
	}

	if (!existsSync("./result")) {
		mkdirSync("./result");
	}

	if (!existsSync("./result/bokun/backup")) {
		mkdirSync("./result/bokun/backup");
	}

	const completed = readLines("./result/bokun/done.txt");

	const id1 = new Set<{ id: string; prod: string }>();
	const id2 = new Set<{ id: string; prod: string }>();
	const id3 = new Set<{ id: string; prod: string }>();
	const id4 = new Set<{ id: string; prod: string }>();
	const id5 = new Set<{ id: string; prod: string }>();

	const entries = await readdir("./source", { withFileTypes: true });

	const result: Result[][] = [];
	let total2 = 0;
	for (const [i, entry] of entries.entries()) {
		if (entry.isDirectory()) {
			continue;
		} else {
			// await mkdir("./result");
			const dir = path.join("./result/bokun", entry.name.replace(".xlsx", ""));
			await convertExcelToCsv(path.join("./source", entry.name), dir);
		}

		// const externalId = entry.name.replace(".xlsx", "");
		const externalId = entry.name.match(/^\d+/)?.[0];

		result[i] = [];

		const filePath = path.join(
			"./result/bokun",
			entry.name.replace(".xlsx", ""),
			"merged.csv",
		);

		if (!existsSync(filePath)) continue;

		const csv = readFileSync(filePath, "utf-8");
		const { errors, data } = Papa.parse(csv, {
			header: true,
			skipEmptyLines: true,
		});
		if (errors.length) {
			console.error(errors);
			throw new Error();
		}

		for (const [j, row] of data.entries()) {
			if (!isObjectLike(row)) {
				continue;
			}

			const metadata: {
				external_id?: string | undefined;
				experience_id?: string;
				guidance_languages?: string[];
			} = {};

			let tmp: Result = {} as any;

			if ("ID" in row && typeof row.ID === "string") {
				metadata.external_id = externalId;
				metadata.experience_id = row.ID;
				if (
					completed.includes(
						`${metadata.external_id}_${metadata.experience_id}`,
					)
				) {
					continue;
				}
				const isValidUrl = await checkUrl(
					`https://widgets.bokun.io/widgets/1288269e-9795-4a81-a368-681df893ae2f/activity/${row.ID}`,
				);
				if (!isValidUrl) {
					if (metadata.external_id && metadata.experience_id) {
						id4.add({
							id: metadata.external_id,
							prod: metadata.experience_id,
						});
					}
				}
				tmp = {
					url: `https://widgets.bokun.io/online-sales/1288269e-9795-4a81-a368-681df893ae2f/experience/${row.ID}`,
					status: isValidUrl ? "privated" : "suspended",
				};
			}
			total2 += 1;

			if ("Title" in row && typeof row.Title === "string") {
				tmp.title = row.Title;
			}
			if ("Latitude" in row && typeof row.Latitude === "string") {
				const lat = Number(row.Latitude);
				if (!lat && metadata.external_id && metadata.experience_id) {
					id1.add({
						id: metadata.external_id,
						prod: metadata.experience_id,
					});
					continue;
				}
				tmp.lat = Number(row.Latitude);
			}
			if ("Longitude" in row && typeof row.Longitude === "string") {
				const lng = Number(row.Longitude);
				if (!lng && metadata.external_id && metadata.experience_id) {
					id1.add({
						id: metadata.external_id,
						prod: metadata.experience_id,
					});
					continue;
				}
				tmp.lon = lng;
			}
			if ("Description" in row && typeof row.Description === "string") {
				if (
					!row.Description &&
					metadata.external_id &&
					metadata.experience_id
				) {
					id2.add({
						id: metadata.external_id,
						prod: metadata.experience_id,
					});
					continue;
				}
				tmp.description = extractText(row.Description);
			}
			if ("images" in row && typeof row.images === "string") {
				if (!row.images && metadata.external_id && metadata.experience_id) {
					id3.add({
						id: metadata.external_id,
						prod: metadata.experience_id,
					});
					continue;
				}
				tmp.photo = row.images;
			}
			if ("Postal code" in row && typeof row["Postal code"] === "string") {
				// console.log(row["Postal code"]);
				tmp.postalcode = row["Postal code"];
			}
			if (tmp.title && tmp.description) {
				const lang = await detectLanguage(tmp.title, tmp.description).then(
					({ lang }) => lang,
				);
				if (!lang || lang === ("und" as any)) {
					if (metadata.external_id && metadata.experience_id) {
						id5.add({
							id: metadata.external_id,
							prod: metadata.experience_id,
						});
					}
					continue;
				}
				console.log(tmp.title, { lang });
				tmp.lang = lang !== "ja" && lang !== "en" ? "en" : lang;
			}
			const a = await requestOpenAI<{ category: string[] }>(`
		次のテキストを参照し、後述のタスクを実行してください。
		\`\`\`text
		title: ${tmp.title ?? ""}
		description: ${tmp.description ?? ""}
		\`\`\`

		- テキストの内容に当てはまるカテゴリを以下から複数選択してください。
		  - attractions
		  - castles
		  - cultural_sites
		  - historical_sites
		  - scenic_spots
		  - temples_and_shrines
		  - nature_and_outdoors
		  - experiences
		  - events
		  - lodging
		  - hot_springs
		  - food_and_drink
		  - transportation
		  - technology
		  - sports
		  - artisans
		  - anime

		出力は必ずJSON形式で行ってください。
		例：
		{
			"category": ["attractions", "events"]
		}
					`);
			tmp.category = a.category;
			// tmp.lang = "en";
			// tmp.category = "";
			tmp.type = "activity";

			if ("Guidances" in row && typeof row.Guidances === "string") {
				try {
					const guidances = JSON.parse(row.Guidances);
					if (guidances?.guidanceTypes?.length) {
						metadata.guidance_languages = guidances.guidanceTypes[0].languages;
					}
				} catch {}
			}

			tmp.metadata = JSON.stringify(metadata);

			result[i][j] = tmp;

			console.log(`${metadata.external_id}_${metadata.experience_id}`);
			completed.push(`${metadata.external_id}_${metadata.experience_id}`);

			await new Promise((resolve) => setTimeout(resolve, 600));
		}
	}

	console.info(
		"処理った数:",
		result.flat().length,
		"総数:",
		total,
		total2,
		"完了:",
		completed.length,
		"座標不正:",
		id1.size,
		"要約不正:",
		id2.size,
		"画像不正:",
		id3.size,
		"URL不正:",
		id4.size,
		"言語不正:",
		id5.size,
	);

	const csv2 = Papa.unparse(result.flat());

	if (csv2) {
		writeFileSync(`./result/bokun/backup/${Date.now()}.csv`, csv2);
	}

	for (const d of result.flat()) {
		if (!d.lat && !d.lon && d.postalcode) {
			const { lat, lng } = await getCoodinates(d.postalcode);
			console.log(d.postalcode, lat, lng);
			d.lat = lat;
			d.lon = lng;
		}
	}

	const csv3 = Papa.unparse(Array.from(id1));
	if (csv3) {
		writeFileSync(`./result/bokun/invalid_location.csv`, csv3);
	}

	const csv4 = Papa.unparse(Array.from(id2));
	if (csv4) {
		writeFileSync(`./result/bokun/invalid_description.csv`, csv4);
	}

	const csv5 = Papa.unparse(Array.from(id3));
	if (csv5) {
		writeFileSync(`./result/bokun/invalid_images.csv`, csv5);
	}

	const csv6 = Papa.unparse(Array.from(id4));
	if (csv6) {
		writeFileSync(`./result/bokun/invalid_url.csv`, csv6);
	}

	const csv7 = Papa.unparse(Array.from(id5));
	if (csv7) {
		writeFileSync(`./result/bokun/invalid_lang.csv`, csv7);
	}

	const chunked = chunk(result.flat(), 100);
	console.log("chunks:", chunked.length);
	for (const [i, data] of chunked.entries()) {
		console.log({ data: data.length });
		const csv2 = Papa.unparse(data);
		if (csv2) {
			writeFileSync(`./result/bokun/result_${i + 1}.csv`, csv2);
		}
	}

	writeFileSync(`./result/bokun/done.txt`, completed.join("\r\n"));
}

await main();
