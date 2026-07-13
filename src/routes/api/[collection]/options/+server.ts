import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { handleREST } from '$lib/server/rest';
import type { Doc, Where } from '$lib/core/types';

/**
 * Admin option source for the relationship/upload picker. Two modes:
 *   ?q=<text>   → search useAsTitle (contains), up to `limit` (default 20)
 *   ?ids=a,b,c  → resolve specific ids to {id,title} (for showing chips)
 *
 * Access-checked (uses the collection's read access), so large target
 * collections don't need every row preloaded into the edit page.
 */
export const GET: RequestHandler = ({ locals, params, url }) =>
	handleREST(async () => {
		const cms = locals.cms;
		const col = cms.collection(params.collection);
		const titleKey = col.admin?.useAsTitle ?? (col.auth ? 'email' : 'id');
		const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 100);

		const idsParam = url.searchParams.get('ids');
		let where: Where | undefined;
		if (idsParam) {
			where = { id: { in: idsParam.split(',').filter(Boolean) } };
		} else {
			const q = url.searchParams.get('q') ?? '';
			if (q && titleKey !== 'id') where = { [titleKey]: { contains: q } };
		}

		const { docs } = await cms.find(
			{ user: locals.user },
			params.collection,
			{ where, limit: idsParam ? 100 : limit, sort: titleKey },
			{ depth: 0 }
		);

		const options = docs.map((d: Doc) => ({
			id: d.id,
			title: String(d[titleKey] ?? d.id),
			...(typeof d.url === 'string' ? { url: d.url, mimeType: String(d.mimeType ?? '') } : {})
		}));
		return json({ options });
	});
