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

	// Published post (versions engine stamps _status + snapshots v1).
	await cms.create(
		sys,
		'posts',
		{
			title: 'Hello from svelte-payload',
			excerpt: 'A Payload-inspired CMS, recreated natively in SvelteKit.',
			content:
				'## It works\n\nThis post was created through the Local API by the seed script. Edit it in the admin panel, or fetch it:\n\n```\nGET /api/posts?where[_status][equals]=published&depth=1\n```',
			author: admin.id,
			category: tech.id,
			featured: true
		},
		opts
	);

	// Draft post: exists in the admin, invisible to anonymous API readers.
	await cms.create(
		sys,
		'posts',
		{
			title: 'Drafts are hidden from anonymous readers',
			excerpt: 'Access control can return query constraints, not just booleans.',
			content:
				'This post is a **draft**. Save drafts without touching the published version, then Publish when ready — and restore any previous version from the sidebar.',
			author: admin.id,
			category: news.id
		},
		{ ...opts, draft: true }
	);

	// Page built from blocks (the flexible layout builder).
	await cms.create(
		sys,
		'pages',
		{
			title: 'About',
			slug: 'about',
			status: 'published',
			layout: [
				{
					blockType: 'hero',
					heading: 'Payload, recreated in SvelteKit',
					subheading: 'One config file in — database, REST API, and admin panel out.',
					ctaLabel: 'Open the admin',
					ctaUrl: '/admin'
				},
				{
					blockType: 'content',
					body: 'Blocks are Payload\'s flexible layout builder: an ordered list of typed sections. Add, reorder, and remove them in the admin — each block type renders its own fields.'
				},
				{
					blockType: 'quote',
					text: 'The architecture ports cleanly off React.',
					attribution: 'svelte-payload'
				},
				{
					blockType: 'feature-grid',
					heading: 'What you get',
					features: [
						{ title: 'Drafts & versions', description: 'Save drafts, publish, restore history.' },
						{ title: 'Blocks', description: 'Flexible layout builder with typed sections.' },
						{ title: 'Access control', description: 'Booleans or query constraints.' }
					]
				}
			],
			meta: { ogTitle: 'About svelte-payload' }
		},
		opts
	);

	return 'Seeded: 1 user, 2 categories, 2 posts (1 published, 1 draft), 1 page with blocks';
}
