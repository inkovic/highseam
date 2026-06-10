import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { TOKEN_COOKIE } from '$lib/server';
import { APIError, ValidationError } from '$lib/core/types';

export const load: PageServerLoad = async ({ locals }) => {
	const firstUser = await locals.cms.needsFirstUser();
	if (!firstUser) redirect(303, '/admin');
	return { collection: firstUser.collection };
};

export const actions: Actions = {
	default: async ({ request, locals, cookies }) => {
		const firstUser = await locals.cms.needsFirstUser();
		if (!firstUser) redirect(303, '/admin');

		const form = await request.formData();
		const email = String(form.get('email') ?? '');
		const password = String(form.get('password') ?? '');
		const name = String(form.get('name') ?? '');

		try {
			// Trusted server-side op: the very first user becomes an admin.
			await locals.cms.create(
				{ user: null },
				firstUser.collection,
				{ email, password, name, role: 'admin' },
				{ overrideAccess: true }
			);
			const { token, exp } = await locals.cms.login(firstUser.collection, email, password);
			cookies.set(TOKEN_COOKIE, token, {
				path: '/',
				httpOnly: true,
				sameSite: 'lax',
				secure: !import.meta.env.DEV,
				expires: new Date(exp * 1000)
			});
		} catch (err) {
			if (err instanceof ValidationError)
				return fail(err.status, { errors: err.errors, email, name });
			if (err instanceof APIError) return fail(err.status, { message: err.message, email, name });
			throw err;
		}
		redirect(303, '/admin');
	}
};
