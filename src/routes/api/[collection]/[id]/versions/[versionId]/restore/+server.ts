import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { handleREST } from '$lib/server/rest';

/** POST /api/:collection/:id/versions/:versionId/restore */
export const POST: RequestHandler = ({ locals, params }) =>
	handleREST(async () => {
		const doc = await locals.cms.restoreVersion(
			{ user: locals.user },
			params.collection,
			params.id,
			params.versionId
		);
		return json({ doc, message: 'Version restored' });
	});
