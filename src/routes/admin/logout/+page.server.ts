import { redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { TOKEN_COOKIE } from '$lib/server';

export const actions: Actions = {
	default: async ({ cookies }) => {
		cookies.delete(TOKEN_COOKIE, { path: '/' });
		redirect(303, '/admin/login');
	}
};
