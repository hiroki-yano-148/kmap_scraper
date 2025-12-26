import { SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import sharp from "sharp";

type StorageFileApi = ReturnType<SupabaseClient["storage"]["from"]>;
type StorageResult = Awaited<ReturnType<StorageFileApi["upload"]>>;

export class SupabaseStorage {
	private readonly storage: StorageFileApi;

	constructor(storage: StorageFileApi) {
		this.storage = storage;
	}

	static async init() {
		if (!process.env.SUPABASE_URL) {
			throw new Error("supabase url is missing");
		}

		if (!process.env.SUPABASE_ANON_KEY) {
			throw new Error("supabase anon key is missing");
		}

		if (!process.env.SUPABASE_EMAIL) {
			throw new Error("supabase url is missing");
		}

		if (!process.env.SUPABASE_PASSWORD) {
			throw new Error("supabase anon key is missing");
		}

		const supabase = new SupabaseClient(
			process.env.SUPABASE_URL,
			process.env.SUPABASE_ANON_KEY,
		);

		await supabase.auth.signInWithPassword({
			email: process.env.SUPABASE_EMAIL,
			password: process.env.SUPABASE_PASSWORD,
		});

		const storage = supabase.storage.from("kmap-bucket");
		return new SupabaseStorage(storage);
	}

	private async uploadImage(path: string, file: Buffer) {
		const { data } = this.storage.getPublicUrl(path);
		const { data: isExists } = await this.storage.exists(path);

		let result: StorageResult;

		if (isExists) {
			result = await this.storage.update(path, file, { upsert: true });
		} else {
			result = await this.storage.upload(path, file);
		}

		if (result.error) {
			return { error: result.error };
		}
		return { data: { id: result.data.id, photoUrl: data.publicUrl } };
	}

	// public async getPaths(): Promise<string[]> {
	// 	const path = `public/users/${this.userId}/contents/${this.contentId}`;
	// 	const supabase = await createClient();
	// 	const storage = supabase.storage.from("kmap-bucket");
	// 	const { data } = await storage.list(path);
	// 	return data?.map((file) => `${path}/${file.name}`) ?? [];
	// }

	// public async remove(paths: string[]): Promise<any> {
	// 	const { error, data: deleted } = await this.storage.remove(paths);
	// 	if (error) {
	// 		console.error(error);
	// 		throw error;
	// 	}

	// 	return deleted;
	// }

	public async uploadContentPhoto(
		photo: File,
		userId: string,
		contentId?: string,
	) {
		const extension = photo.name.split(".").pop()?.toLowerCase();

		if (!extension) {
			throw new Error("file extension not found");
		}

		const id = nanoid();
		const buffer = await photo.arrayBuffer();
		const optimizedPhoto = await sharp(buffer)
			.toFormat("webp", { quality: 75 })
			.toBuffer();
		const thumbnail = await sharp(buffer)
			.toFormat("webp", { quality: 25 })
			.resize(40, 40)
			.toBuffer();

		const photoPath = `public/users/${userId}/contents/${contentId}/${id}.webp`;
		const thumbnailPath = `public/users/${userId}/contents/${contentId}/${id}.min.webp`;

		const [photoUrlResult, thumbnailUrlResult] = await Promise.all([
			this.uploadImage(photoPath, optimizedPhoto),
			this.uploadImage(thumbnailPath, thumbnail),
		]);

		if (photoUrlResult.error || thumbnailUrlResult.error) {
			return {
				error: { ...photoUrlResult.error, ...thumbnailUrlResult.error },
			};
		}

		const photoUrl = { ...photoUrlResult.data, type: "PHOTO" } as const;

		const thumbnailUrl = {
			...thumbnailUrlResult.data,
			type: "THUMBNAIL",
		} as const;

		return { data: { photoUrl, thumbnailUrl } };
	}

	public async uploadContentPhotos(
		photos: File[],
		userId: string,
		contentId?: string,
	) {
		const photoUrls: {
			id: string;
			photoUrl: string;
			type: "PHOTO" | "THUMBNAIL";
			order: number;
		}[] = [];

		if (!contentId) {
			throw new Error("contentId not found");
		}

		const validPhotos = photos.filter((photo) => photo.size > 0);

		const results = await Promise.all(
			validPhotos.map((photo) =>
				this.uploadContentPhoto(photo, userId, contentId),
			),
		);

		for (const [order, result] of results.entries()) {
			if (result.error) {
				return { error: result.error };
			}

			photoUrls.push({ ...result.data.photoUrl, order });
			photoUrls.push({ ...result.data.thumbnailUrl, order });
		}

		return { data: photoUrls };
	}

	public async remove(prefix: string) {
		const { data, error } = await this.storage.list(prefix);

		if (error) throw error;

		const files = [];
		for (const item of data) {
			const fullPath = `${prefix}/${item.name}`;
			if (item.metadata) {
				// ファイル
				files.push(fullPath);
			} else {
				// ディレクトリ
				await this.remove(fullPath);
			}
		}

		console.log({ files });

		if (files.length > 0) {
			await this.storage.remove(files);
		}
	}
}
