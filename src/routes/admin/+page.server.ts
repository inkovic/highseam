import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const counts: Record<string, number> = {};
	for (const col of locals.cms.collections) {
		if (col.admin?.hidden) continue;
		try {
			const { totalDocs } = await locals.cms.find({ user: locals.user }, col.slug, { limit: 1 });
			counts[col.slug] = totalDocs;
		} catch {
			counts[col.slug] = -1; // no read access
		}
	}
	return { counts, dbName: locals.cms.db.name };
};
