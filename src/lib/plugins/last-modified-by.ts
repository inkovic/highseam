/**
 * Demo plugin — proves the plugin system works the way Payload's does:
 * a pure config transform. Adds a read-only `lastModifiedBy` field and a
 * beforeChange hook to the given collections, recording who saved the doc.
 */
import type { CollectionConfig, Plugin } from '$lib/core/types';

export function lastModifiedBy(collectionSlugs: string[]): Plugin {
	return (config) => ({
		...config,
		collections: config.collections.map((col): CollectionConfig => {
			if (!collectionSlugs.includes(col.slug)) return col;
			return {
				...col,
				fields: [
					...col.fields,
					{
						name: 'lastModifiedBy',
						type: 'text',
						admin: { readOnly: true, description: 'Set automatically on save' }
					}
				],
				hooks: {
					...col.hooks,
					beforeChange: [
						...(col.hooks?.beforeChange ?? []),
						({ req, data }) => {
							if (!data) return;
							data.lastModifiedBy = req.user
								? String(req.user.email ?? req.user.id)
								: 'system';
							return data;
						}
					]
				}
			};
		})
	});
}
