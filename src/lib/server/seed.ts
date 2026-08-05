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

	// Published post with STRUCTURED rich text: typed components live inside
	// the document flow (the Lexical-equivalent experience).
	const hello = await cms.create(
		sys,
		'posts',
		{
			title: 'Hello from highseam',
			excerpt: 'A config-driven CMS that runs at the edge, on the database you already have.',
			content: [
				{ type: 'h2', html: 'It works' },
				{
					type: 'p',
					html: 'This post was created through the <strong>Local API</strong> by the seed script. Its content is structured rich text — an array of typed nodes, not a blob of HTML.'
				},
				{
					type: 'block',
					blockType: 'callout',
					fields: { tone: 'info', text: 'Components like this callout are embedded INSIDE the document flow, not pasted in as markup.' }
				},
				{
					type: 'ul',
					items: [
						'Text blocks with <strong>inline</strong> <em>formatting</em>',
						'Embedded images from the media collection',
						'Embeds of other documents',
						'Typed components defined in config'
					]
				},
				{ type: 'code', code: 'GET /api/posts?where[_status][equals]=published&depth=1' },
				{ type: 'block', blockType: 'cta', fields: { label: 'Open the admin', url: '/admin' } }
			],
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
			content: [
				{
					type: 'p',
					html: 'This post is a <strong>draft</strong>. Save drafts without touching the published version, then Publish when ready.'
				},
				{ type: 'relationship', relationTo: 'posts', value: hello.id }
			],
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
					heading: 'A CMS that runs where your site does',
					subheading: 'One config file in — database, REST API, and admin panel out.',
					ctaLabel: 'Open the admin',
					ctaUrl: '/admin'
				},
				{
					blockType: 'content',
					body: 'Blocks are a flexible layout builder: an ordered list of typed sections. Add, reorder, and remove them in the admin — each block type renders its own fields.'
				},
				{
					blockType: 'quote',
					text: 'Config in. Database, APIs and an admin out.',
					attribution: 'highseam'
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
			meta: { ogTitle: 'About highseam' }
		},
		opts
	);

	return 'Seeded: 1 user, 2 categories, 2 posts (1 published, 1 draft), 1 page with blocks';
}
