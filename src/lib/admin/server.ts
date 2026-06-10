/** Server-side helpers for the admin UI. */
import type { CMS } from '$lib/core/cms';
import type { CollectionConfig, Doc, Field, ReqContext } from '$lib/core/types';

export interface RelOption {
	id: string;
	title: string;
}

/** Collect every collection slug referenced by relationship fields, recursively. */
function collectRelationTargets(fields: Field[], out: Set<string>): void {
	for (const field of fields) {
		if (field.type === 'relationship') out.add(field.relationTo);
		if (field.type === 'array') collectRelationTargets(field.fields, out);
		if (field.type === 'blocks')
			for (const block of field.blocks) collectRelationTargets(block.fields, out);
	}
}

/**
 * Load id+title options for every collection referenced by relationship
 * fields (including inside arrays and blocks). Keyed by collection slug.
 */
export async function loadRelOptions(
	cms: CMS,
	req: ReqContext,
	col: CollectionConfig
): Promise<Record<string, RelOption[]>> {
	const targets = new Set<string>();
	collectRelationTargets(col.fields, targets);

	const out: Record<string, RelOption[]> = {};
	for (const slug of targets) {
		if (!cms.hasCollection(slug)) continue;
		const related = cms.collection(slug);
		const titleKey = related.admin?.useAsTitle ?? (related.auth ? 'email' : 'id');
		try {
			const { docs } = await cms.find(req, slug, { limit: 100, sort: titleKey }, { depth: 0 });
			out[slug] = docs.map((d: Doc) => ({ id: d.id, title: String(d[titleKey] ?? d.id) }));
		} catch {
			out[slug] = [];
		}
	}
	return out;
}
