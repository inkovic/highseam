import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { handleREST, readBody } from '$lib/server/rest';

/** GET /api/:collection/:id */
export const GET: RequestHandler = ({ locals, params, url }) =>
	handleREST(async () => {
		const depth = parseInt(url.searchParams.get('depth') ?? '1', 10) || 0;
		const doc = await locals.cms.findByID({ user: locals.user }, params.collection, params.id, {
			depth
		});
		return json(doc);
	});

/** PATCH /api/:collection/:id */
export const PATCH: RequestHandler = ({ locals, params, request }) =>
	handleREST(async () => {
		const data = await readBody(request);
		const doc = await locals.cms.update({ user: locals.user }, params.collection, params.id, data);
		return json({ doc, message: 'Updated' });
	});

/** DELETE /api/:collection/:id */
export const DELETE: RequestHandler = ({ locals, params }) =>
	handleREST(async () => {
		await locals.cms.delete({ user: locals.user }, params.collection, params.id);
		return json({ message: 'Deleted' });
	});
