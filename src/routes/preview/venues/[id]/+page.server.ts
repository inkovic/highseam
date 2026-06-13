import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { verifyPreviewToken } from '$lib/preview';
import { env } from '$env/dynamic/private';

/**
 * Reference implementation of the PUBLIC SIDE of Live Preview. In a real
 * deployment this route lives in the separate front-end app and verifies the
 * token with the shared CMS_SECRET. Here it shares the same process for the
 * demo.
 */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	const secret = env.CMS_SECRET ?? locals.cms.secret;
	const claims = await verifyPreviewToken(secret, url.searchParams.get('token'));
	if (!claims || claims.collection !== 'venues' || claims.id !== params.id) {
		error(403, 'Invalid or expired preview token');
	}
	// Token valid → serve the (possibly unpublished) row.
	const venue = await locals.cms.findByID({ user: null }, 'venues', params.id, {
		depth: 0,
		overrideAccess: true
	});
	return { venue };
};
