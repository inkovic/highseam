import type { PageServerLoad } from './$types';

/** Public post index — anonymous access only sees published posts. */
export const load: PageServerLoad = async ({ locals, url }) => {
	const locale = url.searchParams.get('locale') ?? undefined;
	const posts = await locals.cms.find(
		{ user: null },
		'posts',
		{ sort: '-publishedAt', limit: 20 },
		{ depth: 1, locale }
	);
	return { posts };
};
