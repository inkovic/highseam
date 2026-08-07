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

// ---------------------------------------------------------------------------
// Wiring: init must leave a RUNNING app, or say exactly why not. The admin
// theme needs Tailwind v4; a missing plugin 500s the whole site on first
// `dev`, which is the worst possible first impression.
// ---------------------------------------------------------------------------

const updated = [];
const manual = [];

// 1. vite.config: add the Tailwind plugin when the file is recognizable.
const viteConfigPath = ['vite.config.ts', 'vite.config.js']
	.map((f) => join(cwd, f))
	.find((f) => existsSync(f));
if (viteConfigPath) {
	const vite = readFileSync(viteConfigPath, 'utf-8');
	if (!vite.includes('@tailwindcss/vite')) {
		if (vite.includes('sveltekit') && vite.includes('plugins: [')) {
			const patched = vite
				.replace(/(import\s.+from\s+['"]@sveltejs\/kit\/vite['"];?)/, "$1\nimport tailwindcss from '@tailwindcss/vite';")
				.replace('plugins: [', 'plugins: [tailwindcss(), ');
			writeFileSync(viteConfigPath, patched);
			updated.push(viteConfigPath.replace(cwd + '/', '') + ' (added @tailwindcss/vite plugin)');
		} else {
			manual.push(`add the Tailwind plugin to ${viteConfigPath.replace(cwd + '/', '')}:\n       import tailwindcss from '@tailwindcss/vite';\n       plugins: [tailwindcss(), sveltekit()]`);
		}
	}
}

// 2. Root layout: import the theme once.
const layoutPath = join(cwd, 'src/routes/+layout.svelte');
if (existsSync(layoutPath)) {
	const layout = readFileSync(layoutPath, 'utf-8');
	if (!layout.includes('highseam.css')) {
		if (layout.includes('<script')) {
			writeFileSync(layoutPath, layout.replace(/(<script[^>]*>)/, "$1\n\timport '../highseam.css';"));
			updated.push('src/routes/+layout.svelte (imported highseam.css)');
		} else {
			writeFileSync(layoutPath, `<script>\n\timport '../highseam.css';\n</script>\n\n` + layout);
			updated.push('src/routes/+layout.svelte (imported highseam.css)');
		}
	}
} else {
	writeFileSync(
		layoutPath,
		`<script lang="ts">\n\timport '../highseam.css';\n\tlet { children } = $props();\n</script>\n\n{@render children()}\n`
	);
	created.push('src/routes/+layout.svelte');
}

// 3. .gitignore: the skeleton ignores .env* but knows nothing about wrangler
// or highseam conventions. Without these lines a consumer commits
// .dev.vars (CMS_SECRET) and .data/ (the dev store — which contains user
// PASSWORD HASHES and all content after the first dev session).
const gitignorePath = join(cwd, '.gitignore');
const ignoreEntries = ['.data', '.dev.vars*', '!.dev.vars.example'];
const existingIgnore = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf-8') : '';
const missingIgnore = ignoreEntries.filter(
	(e) => !existingIgnore.split('\n').some((l) => l.trim() === e || l.trim() === e.replace('*', ''))
);
if (missingIgnore.length > 0) {
	writeFileSync(
		gitignorePath,
		existingIgnore.replace(/\n*$/, '\n') +
			`\n# highseam — secrets + local dev store (contains password hashes)\n` +
			missingIgnore.join('\n') +
			'\n'
	);
	updated.push(`.gitignore (added ${missingIgnore.join(', ')})`);
}

// 4. Secrets example (real .dev.vars stays gitignored).
copyFile(join(templates, '.dev.vars.example'), join(cwd, '.dev.vars.example'));

// 5. Dependencies: detect what's missing and the package manager in use.
const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'));
const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
const missingDeps = ['tailwindcss', '@tailwindcss/vite'].filter((d) => !allDeps[d]);
const pm = existsSync(join(cwd, 'pnpm-lock.yaml'))
	? 'pnpm add -D'
	: existsSync(join(cwd, 'yarn.lock'))
		? 'yarn add -D'
		: existsSync(join(cwd, 'bun.lockb')) || existsSync(join(cwd, 'bun.lock'))
			? 'bun add -d'
			: 'npm i -D';

console.log('\nhighseam scaffolded.\n');
if (created.length) console.log('  created:\n' + created.map((f) => `    + ${f}`).join('\n'));
if (updated.length) console.log('  wired:\n' + updated.map((f) => `    ~ ${f}`).join('\n'));
if (skipped.length) console.log('  skipped (already exist):\n' + skipped.map((f) => `    = ${f}`).join('\n'));

const steps = [];
if (missingDeps.length) steps.push(`REQUIRED — install Tailwind v4 (the admin needs it):\n       ${pm} ${missingDeps.join(' ')}`);
for (const m of manual) steps.push(`REQUIRED — ${m}`);
steps.push('npm run dev → open /admin and create the first user (they become admin).');
steps.push('Shape your content in src/cms.config.ts — collections there get a database,\n     REST + GraphQL APIs, and admin UI automatically. Your own routes are untouched;\n     the CMS lives under /admin and /api.');

console.log('\nNext steps:');
steps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
console.log(`
Production (Cloudflare): bind D1 as DB, R2 as BUCKET, set CMS_SECRET.
Docs: https://github.com/inkovic/highseam#readme
`);
