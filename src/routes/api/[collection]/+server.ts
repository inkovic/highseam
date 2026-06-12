import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { handleREST, parseFindArgs, readBody } from '$lib/server/rest';

/** GET /api/:collection — paginated list. Supports ?locale=. */
export const GET: RequestHandler = ({ locals, params, url }) =>
	handleREST(async () => {
		const { depth, locale, ...args } = parseFindArgs(url);
		const result = await locals.cms.find({ user: locals.user }, params.collection, args, {
			depth,
			locale
		});
		return json(result);
	});

/** POST /api/:collection — create. Supports ?locale= and ?draft=true. */
export const POST: RequestHandler = ({ locals, params, request, url }) =>
	handleREST(async () => {
		const data = await readBody(request);
		const doc = await locals.cms.create({ user: locals.user }, params.collection, data, {
			locale: url.searchParams.get('locale') ?? undefined,
			draft: url.searchParams.get('draft') === 'true'
		});
		return json({ doc, message: 'Created' }, { status: 201 });
	});
