/**
 * Builds templates/ for the `svelte-payload-init` scaffolder.
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
		.replace(/from '\$lib\/core'/g, "from 'svelte-payload'")
		.replace(/from '\$lib\/server'/g, "from 'svelte-payload/server/index.js'")
		// Bare .svelte component imports keep their extension.
		.replace(/from '\$lib\/(.+?\.svelte)'/g, "from 'svelte-payload/$1'")
		// Everything else resolves to the compiled .js — but don't double-append
		// when the specifier already carries a .js (e.g. runes modules imported
		// as `foo.svelte.js`).
		.replace(/from '\$lib\/(.+?)'/g, (_m, p) =>
			`from 'svelte-payload/${p}${p.endsWith('.js') ? '' : '.js'}'`
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
import { createCMSHandle } from 'svelte-payload/server/index.js';
import cmsConfig from './cms.config';

export const handle: Handle = createCMSHandle(cmsConfig) as Handle;
`
);

// Starter config.
writeFileSync(
	join(out, 'cms.config.ts'),
	`import { defineCollection, defineConfig } from 'svelte-payload';
import type { AccessFn } from 'svelte-payload';

const isLoggedIn: AccessFn = ({ req }) => Boolean(req.user);

const users = defineCollection({
	slug: 'users',
	auth: true,
	admin: { useAsTitle: 'email' },
	access: { read: isLoggedIn, create: isLoggedIn, update: isLoggedIn, delete: isLoggedIn },
	fields: [{ name: 'name', type: 'text', required: true }]
});

const pages = defineCollection({
	slug: 'pages',
	versions: { drafts: true },
	admin: { useAsTitle: 'title', defaultColumns: ['title', 'slug', '_status'] },
	access: {
		read: ({ req }) => (req.user ? true : { _status: { equals: 'published' } }),
		create: isLoggedIn,
		update: isLoggedIn,
		delete: isLoggedIn
	},
	fields: [
		{ name: 'title', type: 'text', required: true },
		{ name: 'slug', type: 'text', required: true, unique: true },
		{ name: 'content', type: 'richText' }
	]
});

export default defineConfig({
	admin: { title: 'My CMS' },
	collections: [users, pages]
});
`
);

// Locals typing.
writeFileSync(
	join(out, 'app.d.ts'),
	`import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { CMS } from 'svelte-payload/core/cms.js';
import type { Doc } from 'svelte-payload/core/types.js';

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

// Admin theme tokens (Tailwind v4).
cpSync(join(root, 'src/app.css'), join(out, 'svelte-payload.css'));

console.log('templates/ built');
