import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { handleREST } from '$lib/server/rest';

/** GET /api/:collection/:id/versions — version history, newest first. */
export const GET: RequestHandler = ({ locals, params }) =>
	handleREST(async () => {
		const versions = await locals.cms.findVersions(
			{ user: locals.user },
			params.collection,
			params.id
		);
		return json({ versions, totalDocs: versions.length });
	});
