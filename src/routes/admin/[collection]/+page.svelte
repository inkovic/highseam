<script lang="ts">
	import { displayValue } from '$lib/admin/client';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const columns = $derived(
		data.collection.defaultColumns.filter(
			(c) =>
				c === 'id' ||
				c === 'createdAt' ||
				c === 'updatedAt' ||
				c === 'email' ||
				data.collection.fields.some((f) => f.name === c)
		)
	);

	function sortLink(col: string): string {
		const next = data.sort === col ? `-${col}` : col;
		const params = new URLSearchParams();
		if (data.search) params.set('q', data.search);
		params.set('sort', next);
		return `?${params.toString()}`;
	}
	function pageLink(p: number): string {
		const params = new URLSearchParams();
		if (data.search) params.set('q', data.search);
		if (data.sort !== '-createdAt') params.set('sort', data.sort);
		params.set('page', String(p));
		return `?${params.toString()}`;
	}
</script>

<div class="mb-6 flex items-center justify-between gap-4">
	<div>
		<h1 class="text-2xl font-semibold tracking-tight">{data.collection.labels.plural}</h1>
		<p class="mt-1 text-sm text-(--color-muted)">{data.result.totalDocs} documents</p>
	</div>
	<a
		href="/admin/{data.collection.slug}/create"
		class="rounded-(--radius) bg-(--color-primary) px-4 py-2 text-sm font-semibold text-(--color-primary-fg) hover:opacity-90"
	>
		Create new
	</a>
</div>

<form method="GET" class="mb-4">
	<input
		type="search"
		name="q"
		value={data.search}
		placeholder="Search by {data.collection.useAsTitle}…"
		class="w-72 rounded-(--radius) border border-(--color-border) bg-(--color-elevate) px-3 py-2 text-sm placeholder-(--color-muted) focus:border-(--color-primary) focus:outline-none"
	/>
</form>

<div class="overflow-x-auto rounded-xl border border-(--color-border)">
	<table class="w-full text-left text-sm">
		<thead class="bg-(--color-elevate) text-xs tracking-wide text-(--color-muted) uppercase">
			<tr>
				{#each columns as colName (colName)}
					<th class="px-4 py-3 font-medium">
						<a href={sortLink(colName)} class="hover:text-(--color-fg)">
							{colName}{data.sort === colName ? ' ↑' : data.sort === `-${colName}` ? ' ↓' : ''}
						</a>
					</th>
				{/each}
				<th class="px-4 py-3"></th>
			</tr>
		</thead>
		<tbody class="divide-y divide-(--color-border)">
			{#each data.result.docs as doc (doc.id)}
				<tr class="bg-(--color-bg) hover:bg-(--color-elevate)">
					{#each columns as colName, i (colName)}
						<td class="px-4 py-3 {i === 0 ? 'font-medium' : 'text-(--color-muted)'}">
							{#if i === 0}
								<a href="/admin/{data.collection.slug}/{doc.id}" class="text-(--color-primary) hover:underline">
									{displayValue(doc[colName])}
								</a>
							{:else}
								{displayValue(doc[colName])}
							{/if}
						</td>
					{/each}
					<td class="px-4 py-3 text-right">
						<a href="/admin/{data.collection.slug}/{doc.id}" class="text-xs text-(--color-muted) hover:text-(--color-fg)">
							Edit →
						</a>
					</td>
				</tr>
			{:else}
				<tr>
					<td colspan={columns.length + 1} class="px-4 py-12 text-center text-(--color-muted)">
						No documents yet.
						<a href="/admin/{data.collection.slug}/create" class="text-(--color-primary) hover:underline">Create the first one</a>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

{#if data.result.totalPages > 1}
	<div class="mt-4 flex items-center gap-2 text-sm">
		{#if data.result.hasPrevPage}
			<a href={pageLink(data.result.page - 1)} class="rounded-(--radius) border border-(--color-border) px-3 py-1.5 hover:bg-(--color-elevate)">← Prev</a>
		{/if}
		<span class="text-(--color-muted)">Page {data.result.page} of {data.result.totalPages}</span>
		{#if data.result.hasNextPage}
			<a href={pageLink(data.result.page + 1)} class="rounded-(--radius) border border-(--color-border) px-3 py-1.5 hover:bg-(--color-elevate)">Next →</a>
		{/if}
	</div>
{/if}
