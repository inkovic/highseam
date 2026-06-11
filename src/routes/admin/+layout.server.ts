import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { toClientCollection, labelize } from '$lib/admin/client';

const PUBLIC_ADMIN_ROUTES = ['/admin/login', '/admin/create-first-user'];

export const load: LayoutServerLoad = async ({ locals, url }) => {
	const { cms, user } = locals;
	const isPublic = PUBLIC_ADMIN_ROUTES.some((p) => url.pathname.startsWith(p));

	const firstUser = await cms.needsFirstUser();
	if (firstUser && url.pathname !== '/admin/create-first-user') {
		redirect(303, '/admin/create-first-user');
	}
	if (!firstUser && !user && !isPublic) {
		redirect(303, `/admin/login?redirect=${encodeURIComponent(url.pathname)}`);
	}

	return {
		user,
		title: cms.config.admin?.title ?? 'svelte-payload',
		collections: cms.collections.filter((c) => !c.admin?.hidden).map(toClientCollection),
		globals: cms.globals
			.filter((g) => !g.admin?.hidden)
			.map((g) => ({ slug: g.slug, label: g.label ?? labelize(g.slug) }))
	};
};
