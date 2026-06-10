/** Server-side helpers for the admin UI. */
import type { CMS } from '$lib/core/cms';
import type { CollectionConfig, Doc, ReqContext } from '$lib/core/types';

export interface RelOption {
	id: string;
	title: string;
}

/** Load id+title options for every relationship field of a collection. */
export async function loadRelOptions(
	cms: CMS,
	req: ReqContext,
	col: CollectionConfig
): Promise<Record<string, RelOption[]>> {
	const out: Record<string, RelOption[]> = {};
	for (const field of col.fields) {
		if (field.type !== 'relationship' || !cms.hasCollection(field.relationTo)) continue;
		const related = cms.collection(field.relationTo);
		const titleKey = related.admin?.useAsTitle ?? (related.auth ? 'email' : 'id');
		try {
			const { docs } = await cms.find(req, field.relationTo, { limit: 100, sort: titleKey }, { depth: 0 });
			out[field.name] = docs.map((d: Doc) => ({
				id: d.id,
				title: String(d[titleKey] ?? d.id)
			}));
		} catch {
			out[field.name] = [];
		}
	}
	return out;
}
