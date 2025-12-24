// export interface Result {
// 	// id: string;
// 	url: string;
// 	lat?: number;
// 	lng?: number;
// 	photo?: string;
// 	title?: string;
// 	description?: string;
// 	category?: string;
// 	lang?: "en" | "ja";
// 	actualLang?: string;
// 	type?: string;
// 	metadata?: string;
// 	status?: "privated" | "suspended";
// }

export interface Content {
	id: string;
	content_url: string;
	base_language: string;
	actual_language: string;
	status: "PRIVATED" | "SUSPENDED";
	lat: number;
	lng: number;
}

export interface ContentBoby {
	id: string;
	title: string;
	description: string;
	language: "EN" | "JA";
	content_id: string;
}

export interface ContentCategoryMapping {
	content_id: string;
	content_category_id: string;
}

export interface ContentPhoto {
	id: string;
	photo_url: string;
	type: "PHOTO" | "THUMBNAIL";
	order: number;
	content_id: string;
}

export interface ContentType {
	id: string;
	type: "ARTICLE" | "SPOT";
	content_id: string;
}

export interface Article {
	id: string;
	content_type_id: string;
}

export interface SpotInformation {
	id: string;
	content_type_id: string;
}
