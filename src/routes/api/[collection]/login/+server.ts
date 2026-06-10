import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { handleREST, readBody } from '$lib/server/rest';
import { TOKEN_COOKIE } from '$lib/server';
import { APIError } from '$lib/core/types';

/** POST /api/:collection/login — sets an httpOnly cookie AND returns the token. */
export const POST: RequestHandler = ({ locals, params, request, cookies }) =>
	handleREST(async () => {
		const body = await readBody(request);
		if (typeof body.email !== 'string' || typeof body.password !== 'string')
			throw new APIError('email and password are required', 400);

		const { token, user, exp } = await locals.cms.login(params.collection, body.email, body.password);
		cookies.set(TOKEN_COOKIE, token, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: !import.meta.env.DEV,
			expires: new Date(exp * 1000)
		});
		return json({ user, token, exp, message: 'Logged in' });
	});
