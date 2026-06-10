/**
 * The whole CMS is driven by this file — the svelte-payload equivalent of
 * payload.config.ts. Collections declared here get a database presence, a
 * REST API, and an admin UI automatically.
 */
import { defineCollection, defineConfig } from '$lib/core';
import type { AccessFn } from '$lib/core';

const isAdmin: AccessFn = ({ req }) => req.user?.role === 'admin';
const isLoggedIn: AccessFn = ({ req }) => Boolean(req.user);
const isAdminOrSelf: AccessFn = ({ req, id }) =>
	req.user?.role === 'admin' || (Boolean(req.user) && req.user?.id === id);

/** Anonymous visitors only see published docs; editors see everything. */
const publishedOrLoggedIn: AccessFn = ({ req }) =>
	req.user ? true : { status: { equals: 'published' } };

const users = defineCollection({
	slug: 'users',
	auth: true,
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
	admin: {
		useAsTitle: 'title',
		defaultColumns: ['title', 'status', 'author', 'publishedAt'],
		description: 'Blog posts with relationships, hooks, and status-based access.'
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
				if (data.status === 'published' && !data.publishedAt) {
					data.publishedAt = new Date().toISOString();
				}
				return data;
			}
		]
	},
	fields: [
		{ name: 'title', type: 'text', required: true, maxLength: 200 },
		{ name: 'slug', type: 'text', unique: true, admin: { description: 'Auto-generated from title if left blank' } },
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
		{ name: 'excerpt', type: 'textarea', maxLength: 400 },
		{ name: 'content', type: 'richText' },
		{ name: 'author', type: 'relationship', relationTo: 'users' },
		{ name: 'category', type: 'relationship', relationTo: 'categories' },
		{ name: 'featured', type: 'checkbox', defaultValue: false },
		{ name: 'publishedAt', type: 'date', admin: { readOnly: true } }
	]
});

const pages = defineCollection({
	slug: 'pages',
	labels: { singular: 'Page', plural: 'Pages' },
	admin: { useAsTitle: 'title', defaultColumns: ['title', 'slug', 'status'] },
	access: {
		read: publishedOrLoggedIn,
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
			name: 'sections',
			type: 'array',
			admin: { description: 'Flexible content blocks (heading + body rows)' },
			fields: [
				{ name: 'heading', type: 'text', required: true },
				{ name: 'body', type: 'textarea' }
			]
		},
		{ name: 'meta', type: 'json', admin: { description: 'Arbitrary JSON metadata' } }
	]
});

export default defineConfig({
	admin: { title: 'svelte-payload' },
	collections: [users, posts, categories, pages]
});
