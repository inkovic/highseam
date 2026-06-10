/** Public API of the framework-agnostic core. */
import type { CMSConfig, CollectionConfig } from './types';

export * from './types';
export { CMS } from './cms';
export { MemoryAdapter, matchesWhere, sortDocs } from './adapters/memory';
export { D1Adapter } from './adapters/d1';
export { hashPassword, verifyPassword, signJWT, verifyJWT } from './crypto';
export { validateData, sanitizeData, applyDefaults } from './validate';

/** Identity helpers that give you type-checking + autocomplete in configs. */
export function defineConfig(config: CMSConfig): CMSConfig {
	const slugs = new Set<string>();
	for (const col of config.collections) {
		if (slugs.has(col.slug)) throw new Error(`Duplicate collection slug: ${col.slug}`);
		slugs.add(col.slug);
	}
	return config;
}

export function defineCollection(config: CollectionConfig): CollectionConfig {
	return config;
}
