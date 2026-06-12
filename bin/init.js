#!/usr/bin/env node
/**
 * svelte-payload-init — scaffold svelte-payload into an existing SvelteKit app.
 * Copies route stubs (REST + GraphQL + admin + media), hooks, a starter
 * cms.config.ts, Locals typing, and the admin theme. Never overwrites
 * existing files.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const templates = join(pkgRoot, 'templates');
const cwd = process.cwd();

if (!existsSync(join(cwd, 'svelte.config.js')) && !existsSync(join(cwd, 'vite.config.ts'))) {
	console.error('✗ Run this inside a SvelteKit project (no svelte.config.js / vite.config.ts found).');
	process.exit(1);
}

const created = [];
const skipped = [];

function copyFile(src, dest) {
	if (existsSync(dest)) {
		skipped.push(dest.replace(cwd + '/', ''));
		return;
	}
	mkdirSync(dirname(dest), { recursive: true });
	cpSync(src, dest);
	created.push(dest.replace(cwd + '/', ''));
}

function copyTree(srcDir, destDir) {
	for (const entry of readdirSync(srcDir)) {
		const src = join(srcDir, entry);
		const dest = join(destDir, entry);
		if (statSync(src).isDirectory()) copyTree(src, dest);
		else copyFile(src, dest);
	}
}

// Routes
copyTree(join(templates, 'routes'), join(cwd, 'src/routes'));

// Config + hooks
copyFile(join(templates, 'cms.config.ts'), join(cwd, 'src/cms.config.ts'));
copyFile(join(templates, 'hooks.server.ts'), join(cwd, 'src/hooks.server.ts'));

// Theme
copyFile(join(templates, 'svelte-payload.css'), join(cwd, 'src/svelte-payload.css'));

// app.d.ts: replace only if it's still the untouched skeleton default.
const appDts = join(cwd, 'src/app.d.ts');
if (!existsSync(appDts) || readFileSync(appDts, 'utf-8').includes('// interface Locals {}')) {
	mkdirSync(dirname(appDts), { recursive: true });
	writeFileSync(appDts, readFileSync(join(templates, 'app.d.ts')));
	created.push('src/app.d.ts');
} else {
	skipped.push('src/app.d.ts (add Locals.cms / Locals.user yourself — see templates/app.d.ts)');
}

console.log('\nsvelte-payload scaffolded.\n');
if (created.length) console.log('  created:\n' + created.map((f) => `    + ${f}`).join('\n'));
if (skipped.length) console.log('  skipped (already exist):\n' + skipped.map((f) => `    = ${f}`).join('\n'));
console.log(`
Next steps:
  1. Import the admin theme once in your root layout:
       import '../svelte-payload.css';   // requires Tailwind v4 (@tailwindcss/vite)
  2. npm run dev → open /admin and create the first user.
  3. Define your collections in src/cms.config.ts.

Production (Cloudflare): bind D1 as DB, R2 as BUCKET, set CMS_SECRET.
`);
