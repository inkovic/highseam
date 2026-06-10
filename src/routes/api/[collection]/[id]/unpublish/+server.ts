import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { handleREST } from '$lib/server/rest';

/** POST /api/:collection/:id/unpublish — revert to draft state. */
export const POST: RequestHandler = ({ locals, params }) =>
	handleREST(async () => {
		const doc = await locals.cms.unpublish({ user: locals.user }, params.collection, params.id);
		return json({ doc, message: 'Unpublished' });
	});
