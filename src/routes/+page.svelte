<script lang="ts">
	const features = [
		{
			title: 'Config-driven',
			body: 'Declare collections, fields, access control, and hooks in src/cms.config.ts — the database, REST API, and admin UI are generated from it.'
		},
		{
			title: 'Framework-agnostic core',
			body: 'The engine in src/lib/core has zero SvelteKit imports and uses only Web Crypto, so it runs identically on Node and Cloudflare Workers.'
		},
		{
			title: 'Adapter pattern',
			body: 'JSON-file storage in dev, Cloudflare D1 in production — swap databases without touching collection code.'
		},
		{
			title: 'Payload-style REST',
			body: 'GET /api/posts?where[status][equals]=published&depth=1 — query operators, pagination, and relationship population included.'
		}
	];
</script>

<svelte:head>
	<title>svelte-payload — a Payload-inspired CMS for SvelteKit</title>
	<meta
		name="description"
		content="A config-driven headless CMS recreated in SvelteKit: auto-generated admin panel, REST API, auth, access control, and hooks."
	/>
</svelte:head>

<main class="mx-auto max-w-3xl px-6 py-24">
	<p class="mb-3 text-sm font-medium text-(--color-primary)">svelte-payload</p>
	<h1 class="text-4xl leading-tight font-semibold tracking-tight">
		Payload CMS, recreated in SvelteKit.
	</h1>
	<p class="mt-4 max-w-xl text-(--color-muted)">
		One config file in, three things out: a database schema, a REST API, and a full admin panel.
		Inspired by Payload's architecture, rebuilt natively for SvelteKit + Cloudflare.
	</p>
	<div class="mt-8 flex gap-3">
		<a
			href="/admin"
			class="rounded-(--radius) bg-(--color-primary) px-5 py-2.5 text-sm font-semibold text-(--color-primary-fg) hover:opacity-90"
		>
			Open admin panel →
		</a>
		<a
			href="/posts"
			class="rounded-(--radius) border border-(--color-border) px-5 py-2.5 text-sm text-(--color-muted) hover:text-(--color-fg)"
		>
			View the demo site →
		</a>
	</div>

	<div class="mt-16 grid grid-cols-1 gap-4 sm:grid-cols-2">
		{#each features as f (f.title)}
			<div class="rounded-xl border border-(--color-border) bg-(--color-elevate) p-5">
				<h2 class="font-medium">{f.title}</h2>
				<p class="mt-2 text-sm text-(--color-muted)">{f.body}</p>
			</div>
		{/each}
	</div>
</main>
