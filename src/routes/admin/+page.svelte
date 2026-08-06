<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/** True on a pristine install: no non-user documents anywhere yet. */
	const pristine = $derived(
		data.collections.every((c) => c.auth || (data.counts[c.slug] ?? 0) === 0)
	);
	const firstContent = $derived(data.collections.find((c) => !c.auth && !c.upload));
	const firstMedia = $derived(data.collections.find((c) => c.upload));
</script>

<div class="mb-8">
	<h1 class="text-2xl font-semibold tracking-tight">Dashboard</h1>
	<p class="mt-1 text-sm text-(--color-muted)">
		Database adapter: <code class="rounded bg-(--color-elevate-2) px-1.5 py-0.5 text-xs">{data.dbName}</code>
		— collections are generated from <code class="rounded bg-(--color-elevate-2) px-1.5 py-0.5 text-xs">src/cms.config.ts</code>
	</p>
</div>

{#if pristine}
	<div class="mb-6 rounded-xl border border-(--color-primary)/40 bg-(--color-elevate) p-5">
		<h2 class="font-medium">First steps</h2>
		<ol class="mt-2 space-y-1.5 text-sm text-(--color-muted)">
			{#if firstContent}
				<li>
					1 · <a href="/admin/{firstContent.slug}/create" class="text-(--color-primary) hover:underline">Create your first {firstContent.labels.singular.toLowerCase()}</a>
					— try the rich text editor: paste something, select a line, hit H2.
				</li>
			{/if}
			{#if firstMedia}
				<li>
					2 · <a href="/admin/{firstMedia.slug}" class="text-(--color-primary) hover:underline">Drop an image into {firstMedia.labels.plural.toLowerCase()}</a>
					— or upload straight from any image field.
				</li>
			{/if}
			<li>
				3 · Shape it in <code class="rounded bg-(--color-elevate-2) px-1 text-xs">src/cms.config.ts</code>
				— every collection you add gets a database, APIs and this admin automatically.
			</li>
		</ol>
	</div>
{/if}

<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
	{#each data.collections as col (col.slug)}
		<a
			href="/admin/{col.slug}"
			class="group rounded-xl border border-(--color-border) bg-(--color-elevate) p-5 transition-colors hover:border-(--color-primary)"
		>
			<div class="flex items-baseline justify-between">
				<h2 class="font-medium">{col.labels.plural}</h2>
				<span class="text-2xl font-semibold text-(--color-primary)">
					{data.counts[col.slug] >= 0 ? data.counts[col.slug] : '·'}
				</span>
			</div>
			{#if col.description}
				<p class="mt-2 text-xs text-(--color-muted)">{col.description}</p>
			{/if}
			<p class="mt-3 text-xs text-(--color-muted)">
				{col.fields.length} fields{col.auth ? ' · auth-enabled' : ''}
			</p>
		</a>
	{/each}
</div>
