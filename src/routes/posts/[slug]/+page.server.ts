import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { extractRichTextRefs } from '$lib/core/richtext';
import type { Doc } from '$lib/core/types';

/** Public post page — resolves rich-text embedded refs server-side. */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	const locale = url.searchParams.get('locale') ?? undefined;
	const { docs } = await locals.cms.find(
		{ user: null },
		'posts',
		{ where: { slug: { equals: params.slug } }, limit: 1 },
		{ depth: 1, locale }
	);
	const post = docs[0];
	if (!post) error(404, 'Post not found');

	// Resolve documents embedded in the rich text (images, related posts…).
	const refs: Record<string, Doc> = {};
	for (const ref of extractRichTextRefs(post.content)) {
		try {
			refs[ref.id] = await locals.cms.findByID({ user: null }, ref.relationTo, ref.id, {
				depth: 0,
				locale
			});
		} catch {
			// forbidden or deleted — embed renders nothing
		}
	}

	return { post, refs };
};
