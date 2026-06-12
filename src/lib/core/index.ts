/** Public API of the framework-agnostic core. */
import type { CMSConfig, CollectionConfig } from './types';

export * from './types';
export { CMS, versionsSlug, globalsSlug } from './cms';
export { MemoryAdapter, matchesWhere, sortDocs } from './adapters/memory';
export { D1Adapter } from './adapters/d1';
export { R2Storage } from './adapters/r2';
export { hashPassword, verifyPassword, signJWT, verifyJWT } from './crypto';
export { validateData, sanitizeData, applyDefaults } from './validate';
export { generateTypes } from './typegen';
export { getSchema } from './graphql';

/**
 * Validate the config and apply plugins (each plugin is a config transform,
 * run in order — like Payload).
 */
export function defineConfig(config: CMSConfig): CMSConfig {
	let out = config;
	for (const plugin of config.plugins ?? []) out = plugin(out);

	const slugs = new Set<string>();
	for (const col of out.collections) {
		if (slugs.has(col.slug)) throw new Error(`Duplicate collection slug: ${col.slug}`);
		slugs.add(col.slug);
	}
	return out;
}

export function defineCollection(config: CollectionConfig): CollectionConfig {
	return config;
}

export function defineGlobal(config: import('./types').GlobalConfig): import('./types').GlobalConfig {
	return config;
}
