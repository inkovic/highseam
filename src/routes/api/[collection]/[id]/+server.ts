import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { handleREST, readBody } from '$lib/server/rest';

/** GET /api/:collection/:id — `?draft=true` returns the latest draft (requires update access). */
export const GET: RequestHandler = ({ locals, params, url }) =>
	handleREST(async () => {
		const depth = parseInt(url.searchParams.get('depth') ?? '1', 10) || 0;
		const draft = url.searchParams.get('draft') === 'true';
		const doc = await locals.cms.findByID({ user: locals.user }, params.collection, params.id, {
			depth,
			draft
		});
		return json(doc);
	});

/** PATCH /api/:collection/:id — `?draft=true` saves a draft without touching the published doc. */
export const PATCH: RequestHandler = ({ locals, params, request, url }) =>
	handleREST(async () => {
		const draft = url.searchParams.get('draft') === 'true';
		const data = await readBody(request);
		const doc = await locals.cms.update({ user: locals.user }, params.collection, params.id, data, {
			draft
		});
		return json({ doc, message: draft ? 'Draft saved' : 'Updated' });
	});

/** DELETE /api/:collection/:id */
export const DELETE: RequestHandler = ({ locals, params }) =>
	handleREST(async () => {
		await locals.cms.delete({ user: locals.user }, params.collection, params.id);
		return json({ message: 'Deleted' });
	});
