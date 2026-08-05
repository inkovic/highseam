/**
 * SvelteKit-side wiring. This is the ONLY layer that knows about the runtime:
 * - Cloudflare Workers (D1/R2 bindings)  -> D1Adapter + R2Storage
 * - Node dev server                      -> MemoryAdapter (.data/db.json) + fs storage (.data/uploads)
 */
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { CMS } from '$lib/core/cms';
import { D1Adapter } from '$lib/core/adapters/d1';
import { MemoryAdapter } from '$lib/core/adapters/memory';
import { R2Storage } from '$lib/core/adapters/r2';
import type { CMSConfig, DatabaseAdapter, Doc, FileStorage, StoredFile } from '$lib/core/types';

let nodeCms: CMS | null = null;

function nodeFileAdapter(): DatabaseAdapter {
	return new MemoryAdapter({
		async load() {
			try {
				const fs = await import('node:fs/promises');
				const raw = await fs.readFile('.data/db.json', 'utf-8');
				return JSON.parse(raw);
			} catch {
				return null;
			}
		},
		async save(store) {
			const fs = await import('node:fs/promises');
			await fs.mkdir('.data', { recursive: true });
			await fs.writeFile('.data/db.json', JSON.stringify(store, null, 2));
		}
	});
}

/** Filesystem storage for dev: files under .data/uploads/<key>. */
class FsStorage implements FileStorage {
	readonly name = 'fs';
	private base = '.data/uploads';

	async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
		const fs = await import('node:fs/promises');
		const path = `${this.base}/${key}`;
		await fs.mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true });
		await fs.writeFile(path, bytes);
		await fs.writeFile(`${path}.meta`, contentType);
	}

	async get(key: string): Promise<StoredFile | null> {
		if (key.includes('..')) return null;
		try {
			const fs = await import('node:fs/promises');
			const bytes = new Uint8Array(await fs.readFile(`${this.base}/${key}`));
			const contentType = await fs
				.readFile(`${this.base}/${key}.meta`, 'utf-8')
				.catch(() => 'application/octet-stream');
			return { bytes, contentType };
		} catch {
			return null;
		}
	}

	async delete(key: string): Promise<void> {
		if (key.includes('..')) return;
		const fs = await import('node:fs/promises');
		await fs.rm(`${this.base}/${key}`, { force: true });
		await fs.rm(`${this.base}/${key}.meta`, { force: true });
	}
}

export function getCMS(cmsConfig: CMSConfig, platform?: App.Platform): CMS {
	const secret = platform?.env?.CMS_SECRET ?? env.CMS_SECRET ?? cmsConfig.secret;

	// Production on Cloudflare: a fresh, stateless CMS over the D1 binding.
	if (platform?.env?.DB) {
		const storage = platform.env.BUCKET ? new R2Storage(platform.env.BUCKET) : undefined;
		return new CMS({ ...cmsConfig, secret }, new D1Adapter(platform.env.DB), storage);
	}

	// Dev / Node: a singleton over the JSON-file store.
	if (!nodeCms) {
		if (!dev) {
			console.warn(
				'[highseam] No D1 binding found in production — falling back to ephemeral in-memory storage.'
			);
		}
		nodeCms = new CMS({ ...cmsConfig, secret }, nodeFileAdapter(), new FsStorage());
	}
	return nodeCms;
}

export const TOKEN_COOKIE = 'hs_token';

export async function getUserFromCookies(
	cms: CMS,
	cookies: { get(name: string): string | undefined }
): Promise<Doc | null> {
	return cms.authenticate(cookies.get(TOKEN_COOKIE));
}

/**
 * Drop-in SvelteKit handle: attaches `locals.cms` and `locals.user`
 * (API-key header first, then session cookie).
 *
 *   // src/hooks.server.ts
 *   import { createCMSHandle } from 'highseam/server';
 *   import cmsConfig from './cms.config';
 *   export const handle = createCMSHandle(cmsConfig);
 */
export function createCMSHandle(cmsConfig: CMSConfig) {
	return async ({
		event,
		resolve
	}: {
		event: {
			locals: { cms: CMS; user: Doc | null };
			platform?: App.Platform;
			request: Request;
			cookies: { get(name: string): string | undefined };
		};
		resolve: (event: never) => Promise<Response> | Response;
	}) => {
		const cms = getCMS(cmsConfig, event.platform);
		event.locals.cms = cms;
		event.locals.user =
			(await cms.authenticateAPIKey(event.request.headers.get('authorization'))) ??
			(await getUserFromCookies(cms, event.cookies));
		return resolve(event as never);
	};
}
