import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { handleREST, parseFindArgs, readBody } from '$lib/server/rest';

/** GET /api/:collection — paginated list. */
export const GET: RequestHandler = ({ locals, params, url }) =>
	handleREST(async () => {
		const { depth, ...args } = parseFindArgs(url);
		const result = await locals.cms.find({ user: locals.user }, params.collection, args, { depth });
		return json(result);
	});

/** POST /api/:collection — create. */
export const POST: RequestHandler = ({ locals, params, request }) =>
	handleREST(async () => {
		const data = await readBody(request);
		const doc = await locals.cms.create({ user: locals.user }, params.collection, data);
		return json({ doc, message: 'Created' }, { status: 201 });
	});
