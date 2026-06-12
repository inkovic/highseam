import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { handleREST, readBody } from '$lib/server/rest';

/** GET /api/globals/:slug */
export const GET: RequestHandler = ({ locals, params, url }) =>
	handleREST(async () => {
		const depth = parseInt(url.searchParams.get('depth') ?? '1', 10) || 0;
		const doc = await locals.cms.findGlobal({ user: locals.user }, params.global, {
			depth,
			locale: url.searchParams.get('locale') ?? undefined
		});
		return json(doc);
	});

/** POST /api/globals/:slug — upsert the singleton. Supports ?locale=. */
export const POST: RequestHandler = ({ locals, params, request, url }) =>
	handleREST(async () => {
		const data = await readBody(request);
		const doc = await locals.cms.updateGlobal({ user: locals.user }, params.global, data, {
			locale: url.searchParams.get('locale') ?? undefined
		});
		return json({ doc, message: 'Updated' });
	});
