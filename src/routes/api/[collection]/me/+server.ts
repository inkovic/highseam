import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** GET /api/:collection/me — the authenticated user, or null. */
export const GET: RequestHandler = async ({ locals, params }) => {
	const user =
		locals.user && locals.user._collection === params.collection ? locals.user : null;
	return json({ user });
};
