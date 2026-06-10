import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { TOKEN_COOKIE } from '$lib/server';
import { APIError } from '$lib/core/types';

export const actions: Actions = {
	default: async ({ request, locals, cookies, url }) => {
		const form = await request.formData();
		const email = String(form.get('email') ?? '');
		const password = String(form.get('password') ?? '');
		const collection = String(form.get('collection') ?? 'users');

		try {
			const { token, exp } = await locals.cms.login(collection, email, password);
			cookies.set(TOKEN_COOKIE, token, {
				path: '/',
				httpOnly: true,
				sameSite: 'lax',
				secure: !import.meta.env.DEV,
				expires: new Date(exp * 1000)
			});
		} catch (err) {
			if (err instanceof APIError) return fail(err.status, { message: err.message, email });
			throw err;
		}
		redirect(303, url.searchParams.get('redirect') ?? '/admin');
	}
};
