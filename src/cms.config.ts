/**
 * The whole CMS is driven by this file — the svelte-payload equivalent of
 * payload.config.ts. Collections declared here get a database presence, a
 * REST API, and an admin UI automatically.
 */
import { defineCollection, defineConfig } from '$lib/core';
import type { AccessFn } from '$lib/core';
import { lastModifiedBy } from '$lib/plugins/last-modified-by';

const isAdmin: AccessFn = ({ req }) => req.user?.role === 'admin';
const isLoggedIn: AccessFn = ({ req }) => Boolean(req.user);
const isAdminOrSelf: AccessFn = ({ req, id }) =>
	req.user?.role === 'admin' || (Boolean(req.user) && req.user?.id === id);

/**
 * Anonymous visitors only see published docs; editors see everything.
 * `_status` is managed by the versions/drafts engine.
 */
const publishedOrLoggedIn: AccessFn = ({ req }) =>
	req.user ? true : { _status: { equals: 'published' } };

const users = defineCollection({
	slug: 'users',
	// apiKeys: each user gets a key; authenticate with
	// `Authorization: users API-Key <key>`
	auth: { apiKeys: true },
	labels: { singular: 'User', plural: 'Users' },
	admin: { useAsTitle: 'email', defaultColumns: ['email', 'name', 'role'] },
	access: {
		create: isAdmin,
		read: isLoggedIn,
		update: isAdminOrSelf,
		delete: isAdmin
	},
	fields: [
		{ name: 'name', type: 'text', required: true },
		{
			name: 'role',
			type: 'select',
			required: true,
			defaultValue: 'editor',
			options: [
				{ label: 'Admin', value: 'admin' },
				{ label: 'Editor', value: 'editor' }
			]
		}
	]
});

const media = defineCollection({
	slug: 'media',
	labels: { singular: 'Media', plural: 'Media' },
	// Upload collection: docs carry a stored file (fs in dev, R2 in prod) and
	// get managed filename/mimeType/filesize/url fields.
	upload: { mimeTypes: ['image/', 'application/pdf'], maxFileSize: 10 * 1024 * 1024 },
	admin: {
		useAsTitle: 'filename',
		defaultColumns: ['filename', 'alt', 'mimeType', 'filesize'],
		description: 'Images & documents. Reference them via upload fields.'
	},
	access: {
		read: () => true,
		create: isLoggedIn,
		update: isLoggedIn,
		delete: isLoggedIn
	},
	fields: [{ name: 'alt', type: 'text', admin: { description: 'Alt text for accessibility' } }]
});

const categories = defineCollection({
	slug: 'categories',
	labels: { singular: 'Category', plural: 'Categories' },
	admin: { useAsTitle: 'title', defaultColumns: ['title', 'slug'] },
	access: {
		read: () => true,
		create: isLoggedIn,
		update: isLoggedIn,
		delete: isAdmin
	},
	fields: [
		{ name: 'title', type: 'text', required: true },
		{ name: 'slug', type: 'text', required: true, unique: true }
	]
});

const posts = defineCollection({
	slug: 'posts',
	labels: { singular: 'Post', plural: 'Posts' },
	// Drafts + version history: save drafts without touching the published
	// doc, publish/unpublish, restore old versions.
	versions: { drafts: true, maxPerDoc: 20 },
	admin: {
		useAsTitle: 'title',
		defaultColumns: ['title', '_status', 'author', 'publishedAt'],
		description: 'Versioned posts with drafts, relationships, and hooks.'
	},
	access: {
		read: publishedOrLoggedIn,
		create: isLoggedIn,
		update: isLoggedIn,
		delete: isLoggedIn
	},
	hooks: {
		// Auto-generate slug from title; stamp publishedAt on publish.
		beforeValidate: [
			({ data }) => {
				if (!data) return;
				if (!data.slug && typeof data.title === 'string') {
					data.slug = data.title
						.toLowerCase()
						.replace(/[^a-z0-9]+/g, '-')
						.replace(/^-+|-+$/g, '');
				}
				if (data._status === 'published' && !data.publishedAt) {
					data.publishedAt = new Date().toISOString();
				}
				return data;
			}
		]
	},
	fields: [
		{ name: 'title', type: 'text', required: true, maxLength: 200 },
		{ name: 'slug', type: 'text', unique: true, admin: { description: 'Auto-generated from title if left blank' } },
		{ name: 'excerpt', type: 'textarea', maxLength: 400 },
		{ name: 'content', type: 'richText' },
		{ name: 'author', type: 'relationship', relationTo: 'users' },
		{ name: 'category', type: 'relationship', relationTo: 'categories' },
		{ name: 'coverImage', type: 'upload', relationTo: 'media' },
		{ name: 'featured', type: 'checkbox', defaultValue: false },
		{ name: 'publishedAt', type: 'date', admin: { readOnly: true } }
	]
});

const pages = defineCollection({
	slug: 'pages',
	labels: { singular: 'Page', plural: 'Pages' },
	admin: { useAsTitle: 'title', defaultColumns: ['title', 'slug', 'status'] },
	access: {
		read: ({ req }) => (req.user ? true : { status: { equals: 'published' } }),
		create: isLoggedIn,
		update: isLoggedIn,
		delete: isAdmin
	},
	fields: [
		{ name: 'title', type: 'text', required: true },
		{ name: 'slug', type: 'text', required: true, unique: true },
		{
			name: 'status',
			type: 'select',
			required: true,
			defaultValue: 'draft',
			options: [
				{ label: 'Draft', value: 'draft' },
				{ label: 'Published', value: 'published' }
			]
		},
		{
			// Payload-style blocks: a flexible layout builder. Editors add,
			// reorder, and remove blocks of different shapes in the admin.
			name: 'layout',
			type: 'blocks',
			admin: { description: 'Flexible page layout — add and reorder blocks' },
			blocks: [
				{
					slug: 'hero',
					labels: { singular: 'Hero', plural: 'Heroes' },
					fields: [
						{ name: 'heading', type: 'text', required: true },
						{ name: 'subheading', type: 'textarea' },
						{ name: 'ctaLabel', type: 'text' },
						{ name: 'ctaUrl', type: 'text' }
					]
				},
				{
					slug: 'content',
					labels: { singular: 'Content', plural: 'Content blocks' },
					fields: [{ name: 'body', type: 'richText', required: true }]
				},
				{
					slug: 'quote',
					labels: { singular: 'Quote', plural: 'Quotes' },
					fields: [
						{ name: 'text', type: 'textarea', required: true },
						{ name: 'attribution', type: 'text' }
					]
				},
				{
					slug: 'feature-grid',
					labels: { singular: 'Feature grid', plural: 'Feature grids' },
					fields: [
						{ name: 'heading', type: 'text' },
						{
							name: 'features',
							type: 'array',
							fields: [
								{ name: 'title', type: 'text', required: true },
								{ name: 'description', type: 'textarea' }
							]
						}
					]
				}
			]
		},
		{ name: 'meta', type: 'json', admin: { description: 'Arbitrary JSON metadata' } }
	]
});

export default defineConfig({
	admin: { title: 'svelte-payload' },
	plugins: [lastModifiedBy(['posts', 'pages'])],
	collections: [users, posts, media, categories, pages],
	globals: [
		{
			slug: 'site-settings',
			label: 'Site Settings',
			admin: { description: 'Singleton document — like Payload globals.' },
			access: { read: () => true, update: isLoggedIn },
			fields: [
				{ name: 'siteName', type: 'text', required: true, defaultValue: 'svelte-payload' },
				{ name: 'tagline', type: 'text' },
				{ name: 'logo', type: 'upload', relationTo: 'media' },
				{
					name: 'nav',
					type: 'array',
					fields: [
						{ name: 'label', type: 'text', required: true },
						{ name: 'url', type: 'text', required: true }
					]
				},
				{ name: 'footerText', type: 'textarea' }
			]
		}
	]
});
