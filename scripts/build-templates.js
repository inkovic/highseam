/**
 * Builds templates/ for the `highseam-init` scaffolder.
 * Copies the app's route files and rewrites `$lib/...` imports to package
 * subpath imports, so consumers get thin, customizable route stubs.
 */
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'templates');

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'routes'), { recursive: true });

/** Rewrite $lib imports to package imports. */
function rewrite(source) {
	return source
		.replace(/from '\$lib\/core'/g, "from 'highseam'")
		.replace(/from '\$lib\/server'/g, "from 'highseam/server/index.js'")
		// Bare .svelte component imports keep their extension.
		.replace(/from '\$lib\/(.+?\.svelte)'/g, "from 'highseam/$1'")
		// Everything else resolves to the compiled .js — but don't double-append
		// when the specifier already carries a .js (e.g. runes modules imported
		// as `foo.svelte.js`).
		.replace(/from '\$lib\/(.+?)'/g, (_m, p) =>
			`from 'highseam/${p}${p.endsWith('.js') ? '' : '.js'}'`
		);
}

function copyTree(srcDir, destDir) {
	mkdirSync(destDir, { recursive: true });
	for (const entry of readdirSync(srcDir)) {
		const src = join(srcDir, entry);
		const dest = join(destDir, entry);
		if (statSync(src).isDirectory()) {
			copyTree(src, dest);
		} else {
			writeFileSync(dest, rewrite(readFileSync(src, 'utf-8')));
		}
	}
}

// Route stubs (everything except demo-only routes).
copyTree(join(root, 'src/routes/api/[collection]'), join(out, 'routes/api/[collection]'));
copyTree(join(root, 'src/routes/api/globals'), join(out, 'routes/api/globals'));
copyTree(join(root, 'src/routes/api/graphql'), join(out, 'routes/api/graphql'));
copyTree(join(root, 'src/routes/api/generate-types'), join(out, 'routes/api/generate-types'));
copyTree(join(root, 'src/routes/admin'), join(out, 'routes/admin'));
copyTree(join(root, 'src/routes/media'), join(out, 'routes/media'));

// Hooks template.
writeFileSync(
	join(out, 'hooks.server.ts'),
	`import type { Handle } from '@sveltejs/kit';
import { createCMSHandle } from 'highseam/server/index.js';
import cmsConfig from './cms.config';

export const handle: Handle = createCMSHandle(cmsConfig) as Handle;
`
);

// Starter config. Every flagship feature must be REACHABLE out of the box —
// an upload collection, drafts, blocks, and rich-text embeds — or new users
// never discover them. Still just three collections.
writeFileSync(
	join(out, 'cms.config.ts'),
	`import { defineCollection, defineConfig } from 'highseam';
import type { AccessFn } from 'highseam';

const isLoggedIn: AccessFn = ({ req }) => Boolean(req.user);

const users = defineCollection({
	slug: 'users',
	auth: true,
	admin: { useAsTitle: 'email' },
	access: { read: isLoggedIn, create: isLoggedIn, update: isLoggedIn, delete: isLoggedIn },
	fields: [{ name: 'name', type: 'text', required: true }]
});

// Upload collection: files live on disk in dev (.data/uploads) and R2 in
// production. The metadata fields below are optional conventions — declare
// them and they become inherited defaults (resolveMedia) and search fields
// in the media picker.
const media = defineCollection({
	slug: 'media',
	upload: { mimeTypes: ['image/', 'application/pdf'], maxFileSize: 10 * 1024 * 1024 },
	admin: { useAsTitle: 'filename', defaultColumns: ['filename', 'alt', 'mimeType'] },
	access: { read: () => true, create: isLoggedIn, update: isLoggedIn, delete: isLoggedIn },
	fields: [
		{ name: 'alt', type: 'text', admin: { description: 'Default alt text — inherited wherever this file is used' } },
		{ name: 'caption', type: 'text' },
		{ name: 'credit', type: 'text' },
		{ name: 'tags', type: 'json' },
		{ name: 'focalPoint', type: 'json', admin: { hidden: true } }
	]
});

const pages = defineCollection({
	slug: 'pages',
	versions: { drafts: true },
	admin: { useAsTitle: 'title', defaultColumns: ['title', 'slug', '_status'], groupsAs: 'tabs' },
	access: {
		read: ({ req }) => (req.user ? true : { _status: { equals: 'published' } }),
		create: isLoggedIn,
		update: isLoggedIn,
		delete: isLoggedIn
	},
	fields: [
		{ name: 'title', type: 'text', required: true },
		{ name: 'slug', type: 'text', required: true, unique: true },
		{ name: 'coverImage', type: 'upload', relationTo: 'media', admin: { position: 'sidebar' } },
		{
			// Rich text with embeds: images from the media library, links to
			// other pages, and a typed callout component — all inside the flow.
			name: 'content',
			type: 'richText',
			uploads: 'media',
			relationships: ['pages'],
			blocks: [
				{
					slug: 'callout',
					fields: [
						{
							name: 'tone',
							type: 'select',
							defaultValue: 'info',
							options: [
								{ label: 'Info', value: 'info' },
								{ label: 'Warning', value: 'warning' }
							]
						},
						{ name: 'text', type: 'textarea', required: true }
					]
				}
			]
		}
	]
});

export default defineConfig({
	admin: { title: 'My CMS' },
	// The aspect ratios your frontend renders — the media editor shows a live
	// crop preview per aspect, steered by each image's focal point. Edit or
	// remove to match your layouts. Serve crops with mediaSrc() from 'highseam'.
	media: {
		aspects: [
			{ name: 'card', ratio: '3:2' },
			{ name: 'og', ratio: '1200:630' }
		]
	},
	collections: [users, pages, media]
});
`
);

// Locals typing.
writeFileSync(
	join(out, 'app.d.ts'),
	`import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { CMS } from 'highseam/core/cms.js';
import type { Doc } from 'highseam/core/types.js';

declare global {
	namespace App {
		interface Locals {
			cms: CMS;
			user: Doc | null;
		}
		interface Platform {
			env?: {
				DB?: D1Database;
				BUCKET?: R2Bucket;
				CMS_SECRET?: string;
			};
		}
	}
}

export {};
`
);

// Admin theme tokens (Tailwind v4). Prepend an @source so the CONSUMER's
// Tailwind build scans the packaged admin components — otherwise utilities
// used only inside dist/ (tab strips, grids, the relation picker) never get
// generated and the admin layout collapses. Path is relative to where the
// stub lands (src/highseam.css → ../node_modules/...).
const themeCss = readFileSync(join(root, 'src/app.css'), 'utf-8');
const sourceDirective =
	`\n/* Scan highseam's shipped admin components for Tailwind classes\n` +
	`   (Tailwind v4 does not scan node_modules by default). */\n` +
	`@source "../node_modules/highseam/dist";\n`;
writeFileSync(
	join(out, 'highseam.css'),
	themeCss.replace(/(@import\s+["']tailwindcss["'];)/, `$1${sourceDirective}`)
);

// Secrets example — the real .dev.vars is gitignored by init.
writeFileSync(
	join(out, '.dev.vars.example'),
	`# Copy to .dev.vars (gitignored) for wrangler preview / local Workers runtime.
# Vite dev can use .env instead; both are read as CMS_SECRET.
# Use a long random value in production (Pages project env var).
CMS_SECRET=change-me-to-a-long-random-string
`
);

console.log('templates/ built');
