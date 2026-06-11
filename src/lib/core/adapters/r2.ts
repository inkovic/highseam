/** Cloudflare R2 file storage. */
import type { R2Bucket } from '@cloudflare/workers-types';
import type { FileStorage, StoredFile } from '../types';

export class R2Storage implements FileStorage {
	readonly name = 'r2';

	constructor(private bucket: R2Bucket) {}

	async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
		await this.bucket.put(key, bytes as unknown as ArrayBuffer, {
			httpMetadata: { contentType }
		});
	}

	async get(key: string): Promise<StoredFile | null> {
		const obj = await this.bucket.get(key);
		if (!obj) return null;
		return {
			bytes: new Uint8Array(await obj.arrayBuffer()),
			contentType: obj.httpMetadata?.contentType ?? 'application/octet-stream'
		};
	}

	async delete(key: string): Promise<void> {
		await this.bucket.delete(key);
	}
}
