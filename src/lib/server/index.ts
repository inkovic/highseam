/**
 * SvelteKit-side wiring. This is the ONLY layer that knows about the runtime:
 * - Cloudflare Workers (D1 binding present)  -> D1Adapter
 * - Node dev server                          -> MemoryAdapter persisted to .data/db.json
 */
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import cmsConfig from '../../cms.config';
import { CMS } from '$lib/core/cms';
import { D1Adapter } from '$lib/core/adapters/d1';
import { MemoryAdapter } from '$lib/core/adapters/memory';
import type { DatabaseAdapter, Doc } from '$lib/core/types';

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

export function getCMS(platform?: App.Platform): CMS {
	const secret = platform?.env?.CMS_SECRET ?? env.CMS_SECRET ?? cmsConfig.secret;

	// Production on Cloudflare: a fresh, stateless CMS over the D1 binding.
	if (platform?.env?.DB) {
		return new CMS({ ...cmsConfig, secret }, new D1Adapter(platform.env.DB));
	}

	// Dev / Node: a singleton over the JSON-file store.
	if (!nodeCms) {
		if (!dev) {
			console.warn(
				'[svelte-payload] No D1 binding found in production — falling back to ephemeral in-memory storage.'
			);
		}
		nodeCms = new CMS({ ...cmsConfig, secret }, nodeFileAdapter());
	}
	return nodeCms;
}

export const TOKEN_COOKIE = 'sp_token';

export async function getUserFromCookies(
	cms: CMS,
	cookies: { get(name: string): string | undefined }
): Promise<Doc | null> {
	return cms.authenticate(cookies.get(TOKEN_COOKIE));
}
