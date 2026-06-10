/** Demo content. Runs through the Local API so hooks/validation apply. */
import type { CMS } from '$lib/core/cms';

export async function seed(cms: CMS, adminEmail: string, adminPassword: string): Promise<string> {
	await cms.init();

	const existing = await cms.find({ user: null }, 'posts', { limit: 1 }, { overrideAccess: true });
	if (existing.totalDocs > 0) return 'Already seeded';

	const sys = { user: null };
	const opts = { overrideAccess: true };

	const admin = await cms.create(
		sys,
		'users',
		{ email: adminEmail, password: adminPassword, name: 'Admin', role: 'admin' },
		opts
	);

	const tech = await cms.create(sys, 'categories', { title: 'Tech', slug: 'tech' }, opts);
	const news = await cms.create(sys, 'categories', { title: 'News', slug: 'news' }, opts);

	await cms.create(
		sys,
		'posts',
		{
			title: 'Hello from svelte-payload',
			status: 'published',
			excerpt: 'A Payload-inspired CMS, recreated natively in SvelteKit.',
			content:
				'## It works\n\nThis post was created through the Local API by the seed script. Edit it in the admin panel, or fetch it:\n\n```\nGET /api/posts?where[status][equals]=published&depth=1\n```',
			author: admin.id,
			category: tech.id,
			featured: true
		},
		opts
	);

	await cms.create(
		sys,
		'posts',
		{
			title: 'Drafts are hidden from anonymous readers',
			status: 'draft',
			excerpt: 'Access control can return query constraints, not just booleans.',
			content: 'Anonymous API consumers only ever see published posts.',
			author: admin.id,
			category: news.id
		},
		opts
	);

	await cms.create(
		sys,
		'pages',
		{
			title: 'About',
			slug: 'about',
			status: 'published',
			sections: [
				{ heading: 'What is this?', body: 'A config-driven CMS engine for SvelteKit.' },
				{ heading: 'Why?', body: 'To prove the Payload architecture ports cleanly off React.' }
			],
			meta: { ogTitle: 'About svelte-payload' }
		},
		opts
	);

	return 'Seeded: 1 user, 2 categories, 2 posts, 1 page';
}
