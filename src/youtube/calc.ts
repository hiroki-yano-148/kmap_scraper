import { Tiktoken } from "js-tiktoken/lite";
import o200k_base from "js-tiktoken/ranks/o200k_base";
import {
	createTranslateAndSummarizePrompt,
	readCsv,
	removeUrls,
} from "../helpers.js";

const tiktoken = new Tiktoken(o200k_base);

function main() {
	const source = readCsv<{ title: string; description: string; url: string }>(
		"./src/youtube/source1.csv",
	);
	let count = 0;

	for (const [i, row] of source.entries()) {
		// 		count += tiktoken.encode(
		// 			createDetectPrompt(row.title, row.description),
		// 		).length;
		// 		count += tiktoken.encode(`
		// {
		// 	"lang": "ja" // or "en",
		// }
		//       `).length;
		// 		count += tiktoken.encode(
		// 			createSummarizePrompt("en", removeUrls(row.description)),
		// 		).length;
		// 		count += tiktoken.encode(`
		//  {
		//     description: '御在所岳の富士見岩展望台からは、素晴らしい景色が広がっています。この展望台は三重県に位置し、訪れる人々に美しい自然の景観を提供しています。特に晴れた日には、遠くの山々や広がる緑の風景を一望でき、心を癒すスポットとして人気です。観光三重によると、この場所は四季折々の風景が楽しめるため、訪れるたびに異なる魅力を感じることができます。登山やハイキングを楽しむ人々にとっても、絶好の休憩ポイントとなっており、自然の美しさを堪能することができます。'
		//   }
		//       `).length;
		// 		count += tiktoken.encode(
		// 			createTranslatePrompt(
		// 				row.title,
		// 				"御在所岳の富士見岩展望台からは、素晴らしい景色が広がっています。この展望台は三重県に位置し、訪れる人々に美しい自然の景観を提供しています。特に晴れた日には、遠くの山々や広がる緑の風景を一望でき、心を癒すスポットとして人気です。観光三重によると、この場所は四季折々の風景が楽しめるため、訪れるたびに異なる魅力を感じることができます。登山やハイキングを楽しむ人々にとっても、絶好の休憩ポイントとなっており、自然の美しさを堪能することができます。",
		// 			),
		// 		).length;
		// 		count += tiktoken.encode(`
		// {
		//     en: {
		//       title: 'View from the Fujimi Rock Observatory at Gozaisho Mountain',
		//       description: 'The Fujimi Rock Observatory at Gozaisho Mountain offers a stunning view. Located in Mie Prefecture, this observatory provides visitors with beautiful natural scenery. On clear days, you can enjoy a panoramic view of distant mountains and lush green landscapes, making it a popular spot for relaxation. According to Tourism Mie, this location allows you to experience the beauty of the changing seasons, providing different charms with each visit. It also serves as an excellent resting point for those who enjoy climbing and hiking, allowing them to fully appreciate the beauty of nature.'
		//     },
		//     ja: {
		//       title: '御在所岳・富士見岩展望台からの眺め',
		//       description: '御在所岳の富士見岩展望台からは、素晴らしい景色が広がっています。この展望台は三重県に位置し、訪れる人々に美しい自然の景観を提供しています。特に晴れた日には、遠くの山々や広がる緑の風景を一望でき、心を癒すスポットとして人気です。観光三重によると、この場所は四季折々の風景が楽しめるため、訪れるたびに異なる魅力を感じることができます。登山やハイキングを楽しむ人々にとっても、絶好の休憩ポイントとなっており、自然の美しさを堪能することができます。'
		//     }
		//   }
		//       `).length;

		count += tiktoken.encode(
			createTranslateAndSummarizePrompt(row.title, removeUrls(row.description)),
		).length;

		count += tiktoken.encode(`
{
  "lang": "en"
  "en": {
    title: 'View from the Fujimi Rock Observatory at Gozaisho Mountain',
    description: 'The Fujimi Rock Observatory at Gozaisho Mountain offers a stunning view. Located in Mie Prefecture, this observatory provides visitors with beautiful natural scenery. On clear days, you can enjoy a panoramic view of distant mountains and lush green landscapes, making it a popular spot for relaxation. According to Tourism Mie, this location allows you to experience the beauty of the changing seasons, providing different charms with each visit. It also serves as an excellent resting point for those who enjoy climbing and hiking, allowing them to fully appreciate the beauty of nature.'
  },
  "ja": {
    title: '御在所岳・富士見岩展望台からの眺め',
    description: '御在所岳の富士見岩展望台からは、素晴らしい景色が広がっています。この展望台は三重県に位置し、訪れる人々に美しい自然の景観を提供しています。特に晴れた日には、遠くの山々や広がる緑の風景を一望でき、心を癒すスポットとして人気です。観光三重によると、この場所は四季折々の風景が楽しめるため、訪れるたびに異なる魅力を感じることができます。登山やハイキングを楽しむ人々にとっても、絶好の休憩ポイントとなっており、自然の美しさを堪能することができます。'
  }
}        
`).length;

		console.info(i, "completed");
	}

	console.info({ count });
}

main();
