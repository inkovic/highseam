import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { handleREST } from '$lib/server/rest';

/** POST /api/:collection/:id/publish — promote the latest draft to published. */
export const POST: RequestHandler = ({ locals, params }) =>
	handleREST(async () => {
		const doc = await locals.cms.publish({ user: locals.user }, params.collection, params.id);
		return json({ doc, message: 'Published' });
	});
