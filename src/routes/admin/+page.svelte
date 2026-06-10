<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<div class="mb-8">
	<h1 class="text-2xl font-semibold tracking-tight">Dashboard</h1>
	<p class="mt-1 text-sm text-(--color-muted)">
		Database adapter: <code class="rounded bg-(--color-elevate-2) px-1.5 py-0.5 text-xs">{data.dbName}</code>
		— collections are generated from <code class="rounded bg-(--color-elevate-2) px-1.5 py-0.5 text-xs">src/cms.config.ts</code>
	</p>
</div>

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
