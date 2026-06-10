import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { TOKEN_COOKIE } from '$lib/server';

/** POST /api/:collection/logout */
export const POST: RequestHandler = async ({ cookies }) => {
	cookies.delete(TOKEN_COOKIE, { path: '/' });
	return json({ message: 'Logged out' });
};
