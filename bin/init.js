#!/usr/bin/env node
/**
 * highseam-init — scaffold highseam into an existing SvelteKit app.
 * Copies route stubs (REST + GraphQL + admin + media), hooks, a starter
 * cms.config.ts, Locals typing, and the admin theme. Never overwrites
 * existing files.
 */
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const templates = join(pkgRoot, 'templates');
const cwd = process.cwd();

if (!existsSync(join(cwd, 'svelte.config.js')) && !existsSync(join(cwd, 'vite.config.ts'))) {
	console.error('✗ Run this inside a SvelteKit project (no svelte.config.js / vite.config.ts found).');
	process.exit(1);
}

// ---------------------------------------------------------------------------
// --migrate: rewrite an app that was using the old package name.
// Purely textual — nothing in your database or storage is affected by the
// rename, so this is the whole migration.
// ---------------------------------------------------------------------------
if (process.argv.includes('--migrate')) {
	const dry = process.argv.includes('--dry-run');
	const REPLACEMENTS = [
		[/(['"`])svelte-payload(\/|['"`])/g, '$1highseam$2'],
		[/svelte-payload\.css/g, 'highseam.css'],
		[/node_modules\/svelte-payload/g, 'node_modules/highseam'],
		[/--sp-canvas/g, '--hs-canvas'],
		[/data-sp-theme/g, 'data-hs-theme'],
		[/svelte-payload-init/g, 'highseam-init']
	];
	const EXT = /\.(svelte|ts|js|css|json|md)$/;
	const touched = [];

	const walk = (dir) => {
		for (const entry of readdirSync(dir)) {
			if (entry === 'node_modules' || entry === '.git' || entry === '.svelte-kit') continue;
			const full = join(dir, entry);
			if (statSync(full).isDirectory()) {
				walk(full);
				continue;
			}
			if (!EXT.test(entry)) continue;
			const before = readFileSync(full, 'utf-8');
			let after = before;
			for (const [re, to] of REPLACEMENTS) after = after.replace(re, to);
			if (after !== before) {
				if (!dry) writeFileSync(full, after);
				touched.push(full.replace(cwd + '/', ''));
			}
		}
	};
	walk(join(cwd, 'src'));

	// The stylesheet itself gets a new name.
	const oldCss = join(cwd, 'src/svelte-payload.css');
	const newCss = join(cwd, 'src/highseam.css');
	if (existsSync(oldCss) && !existsSync(newCss)) {
		if (!dry) {
			cpSync(oldCss, newCss);
			rmSync(oldCss);
		}
		touched.push('src/svelte-payload.css → src/highseam.css');
	}

	console.log(`\n${dry ? '[dry run] would update' : 'Updated'} ${touched.length} file(s):`);
	for (const f of touched) console.log(`    ${f}`);
	console.log(`
Remaining steps (not automatable):
  1. npm uninstall svelte-payload && npm i highseam
  2. Everyone gets logged out once — the session cookie changed name.
  3. Nothing in your database or R2 changes. Collections, documents,
     versions, globals and file keys are all keyed by YOUR slugs.
`);
	process.exit(0);
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
copyFile(join(templates, 'highseam.css'), join(cwd, 'src/highseam.css'));

// app.d.ts: replace only if it's still the untouched skeleton default.
const appDts = join(cwd, 'src/app.d.ts');
if (!existsSync(appDts) || readFileSync(appDts, 'utf-8').includes('// interface Locals {}')) {
	mkdirSync(dirname(appDts), { recursive: true });
	writeFileSync(appDts, readFileSync(join(templates, 'app.d.ts')));
	created.push('src/app.d.ts');
} else {
	skipped.push('src/app.d.ts (add Locals.cms / Locals.user yourself — see templates/app.d.ts)');
}

console.log('\nhighseam scaffolded.\n');
if (created.length) console.log('  created:\n' + created.map((f) => `    + ${f}`).join('\n'));
if (skipped.length) console.log('  skipped (already exist):\n' + skipped.map((f) => `    = ${f}`).join('\n'));
console.log(`
Next steps:
  1. Import the admin theme once in your root layout:
       import '../highseam.css';   // requires Tailwind v4 (@tailwindcss/vite)
  2. npm run dev → open /admin and create the first user.
  3. Define your collections in src/cms.config.ts.

Production (Cloudflare): bind D1 as DB, R2 as BUCKET, set CMS_SECRET.
`);
