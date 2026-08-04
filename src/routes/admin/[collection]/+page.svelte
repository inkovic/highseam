<script lang="ts">
	import { enhance } from '$app/forms';
	import { page as pageState } from '$app/state';
	import { displayValue } from '$lib/admin/client';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const columns = $derived(
		data.collection.defaultColumns.filter(
			(c) =>
				c === 'id' ||
				c === 'createdAt' ||
				c === 'updatedAt' ||
				c === 'email' ||
				c === '_status' ||
				data.collection.fields.some((f) => f.name === c)
		)
	);

	/** Preserve all current query params (search + facets) when changing one. */
	function linkWith(overrides: Record<string, string | null>): string {
		const params = new URLSearchParams(pageState.url.searchParams);
		for (const [k, v] of Object.entries(overrides)) {
			if (v === null || v === '') params.delete(k);
			else params.set(k, v);
		}
		return `?${params.toString()}`;
	}
	function sortLink(col: string): string {
		return linkWith({ sort: data.sort === col ? `-${col}` : col, page: null });
	}

	// --- row selection / bulk ---
	let selected = $state<Set<string>>(new Set());
	const allOnPage = $derived(data.result.docs.map((d) => String(d.id)));
	const allSelected = $derived(allOnPage.length > 0 && allOnPage.every((id) => selected.has(id)));
	function toggle(id: string) {
		const next = new Set(selected);
		next.has(id) ? next.delete(id) : next.add(id);
		selected = next;
	}
	function toggleAll() {
		selected = allSelected ? new Set() : new Set(allOnPage);
	}
	const action = $derived(data.collection.actions[0]);
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

<!-- search + facets (GET form keeps state in the URL) -->
<form method="GET" class="mb-4 flex flex-wrap items-end gap-2">
	<input
		type="search"
		name="q"
		value={data.search}
		placeholder="Search by {data.collection.useAsTitle}…"
		class="w-60 rounded-(--radius) border border-(--color-border) bg-(--color-elevate) px-3 py-2 text-sm placeholder-(--color-muted) focus:border-(--color-primary) focus:outline-none"
	/>
	{#each data.facets as facet (facet.name)}
		<div class="flex flex-col gap-0.5">
			<label class="text-[10px] tracking-wide text-(--color-muted) uppercase" for="f_{facet.name}">{facet.label}</label>
			{#if facet.kind === 'select'}
				<select id="f_{facet.name}" name="f_{facet.name}" value={facet.value} class="rounded-(--radius) border border-(--color-border) bg-(--color-elevate) px-2 py-1.5 text-sm focus:border-(--color-primary) focus:outline-none">
					<option value="">Any</option>
					{#each facet.options ?? [] as opt (opt.value)}<option value={opt.value}>{opt.label}</option>{/each}
				</select>
			{:else if facet.kind === 'boolean'}
				<select id="f_{facet.name}" name="f_{facet.name}" value={facet.value} class="rounded-(--radius) border border-(--color-border) bg-(--color-elevate) px-2 py-1.5 text-sm focus:border-(--color-primary) focus:outline-none">
					<option value="">Any</option>
					<option value="true">Yes</option>
					<option value="false">No</option>
				</select>
			{:else if facet.kind === 'exists'}
				<select id="f_{facet.name}" name="f_{facet.name}" value={facet.value} class="rounded-(--radius) border border-(--color-border) bg-(--color-elevate) px-2 py-1.5 text-sm focus:border-(--color-primary) focus:outline-none">
					<option value="">Any</option>
					<option value="true">Has content</option>
					<option value="false">Empty</option>
				</select>
			{:else}
				<input id="f_{facet.name}" name="f_{facet.name}" value={facet.value} placeholder="contains…" class="w-32 rounded-(--radius) border border-(--color-border) bg-(--color-elevate) px-2 py-1.5 text-sm focus:border-(--color-primary) focus:outline-none" />
			{/if}
		</div>
	{/each}
	{#if data.sort !== '-createdAt'}<input type="hidden" name="sort" value={data.sort} />{/if}
	<button class="rounded-(--radius) border border-(--color-border) px-3 py-1.5 text-sm hover:bg-(--color-elevate)">Apply</button>
	{#if data.search || data.facets.some((f) => f.value)}
		<a href="?" class="px-2 py-1.5 text-sm text-(--color-muted) hover:text-(--color-fg)">Clear</a>
	{/if}
</form>

{#if form?.bulk}
	<div class="mb-3 rounded-(--radius) border border-(--color-success) bg-(--color-elevate) px-4 py-2 text-sm text-(--color-success)">
		Bulk {form.bulk.op}: {form.bulk.ok} succeeded{form.bulk.failed ? `, ${form.bulk.failed} failed` : ''}.
	</div>
{/if}

<!-- bulk toolbar -->
{#if selected.size > 0}
	<form method="POST" action="?/bulk" use:enhance={() => async ({ update }) => { selected = new Set(); await update(); }} class="mb-3 flex flex-wrap items-center gap-2 rounded-(--radius) border border-(--color-primary) bg-(--color-elevate) px-3 py-2">
		<span class="text-sm font-medium">{selected.size} selected</span>
		{#each [...selected] as id (id)}<input type="hidden" name="ids" value={id} />{/each}
		{#if data.collection.drafts}
			<button name="op" value="publish" class="rounded border border-(--color-border) px-2.5 py-1 text-xs hover:border-(--color-primary)">Publish</button>
			<button name="op" value="unpublish" class="rounded border border-(--color-border) px-2.5 py-1 text-xs hover:border-(--color-primary)">Unpublish</button>
		{/if}
		{#if action}
			<input type="hidden" name="actionUrl" value={action.url} />
			<button name="op" value="action" class="rounded border border-(--color-primary) px-2.5 py-1 text-xs text-(--color-primary) hover:bg-(--color-primary) hover:text-(--color-primary-fg)">{action.label} ({selected.size})</button>
		{/if}
		<button name="op" value="delete" onclick={(e) => { if (!confirm(`Delete ${selected.size} document(s)?`)) e.preventDefault(); }} class="rounded border border-(--color-danger) px-2.5 py-1 text-xs text-(--color-danger) hover:bg-(--color-danger) hover:text-white">Delete</button>
	</form>
{/if}

{#if data.collection.upload}
	<!-- Media library: a grid of what the files actually are, not a text table. -->
	<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
		{#each data.result.docs as doc (doc.id)}
			{@const isImage = String(doc.mimeType ?? '').startsWith('image/')}
			<div class="group/card relative overflow-hidden rounded-xl border border-(--color-border) bg-(--color-elevate)">
				<label class="absolute top-2 left-2 z-10 rounded bg-(--color-bg)/80 p-1 opacity-0 transition-opacity group-hover/card:opacity-100 {selected.has(String(doc.id)) ? 'opacity-100' : ''}">
					<input type="checkbox" checked={selected.has(String(doc.id))} onchange={() => toggle(String(doc.id))} class="h-4 w-4 accent-(--color-primary)" />
				</label>
				<a href="/admin/{data.collection.slug}/{doc.id}" class="block">
					<div class="flex aspect-square items-center justify-center bg-(--color-elevate-2)">
						{#if isImage && doc.url}
							<img src={String(doc.url)} alt={String(doc.alt ?? doc.filename ?? '')} class="h-full w-full object-cover" loading="lazy" />
						{:else}
							<span class="text-3xl text-(--color-muted)">📄</span>
						{/if}
					</div>
					<div class="p-2">
						<p class="truncate text-xs font-medium" title={String(doc.filename ?? '')}>{doc.filename ?? doc.id}</p>
						<p class="mt-0.5 truncate text-[11px] text-(--color-muted)">
							{String(doc.mimeType ?? '—')} · {Math.round(Number(doc.filesize ?? 0) / 1024)} KB
						</p>
					</div>
				</a>
			</div>
		{:else}
			<p class="col-span-full py-12 text-center text-(--color-muted)">
				No files yet.
				<a href="/admin/{data.collection.slug}/create" class="text-(--color-primary) hover:underline">Upload one</a>
			</p>
		{/each}
	</div>
{:else}
<div class="overflow-x-auto rounded-xl border border-(--color-border)">
	<table class="w-full text-left text-sm">
		<thead class="bg-(--color-elevate) text-xs tracking-wide text-(--color-muted) uppercase">
			<tr>
				<th class="w-10 px-4 py-3">
					<input type="checkbox" checked={allSelected} onchange={toggleAll} class="h-4 w-4 accent-(--color-primary)" />
				</th>
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
					<td class="px-4 py-3">
						<input type="checkbox" checked={selected.has(String(doc.id))} onchange={() => toggle(String(doc.id))} class="h-4 w-4 accent-(--color-primary)" />
					</td>
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
						<a href="/admin/{data.collection.slug}/{doc.id}" class="text-xs text-(--color-muted) hover:text-(--color-fg)">Edit →</a>
					</td>
				</tr>
			{:else}
				<tr>
					<td colspan={columns.length + 2} class="px-4 py-12 text-center text-(--color-muted)">
						No documents match.
						<a href="/admin/{data.collection.slug}/create" class="text-(--color-primary) hover:underline">Create one</a>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
{/if}

{#if data.result.totalPages > 1}
	<div class="mt-4 flex items-center gap-2 text-sm">
		{#if data.result.hasPrevPage}
			<a href={linkWith({ page: String(data.result.page - 1) })} class="rounded-(--radius) border border-(--color-border) px-3 py-1.5 hover:bg-(--color-elevate)">← Prev</a>
		{/if}
		<span class="text-(--color-muted)">Page {data.result.page} of {data.result.totalPages}</span>
		{#if data.result.hasNextPage}
			<a href={linkWith({ page: String(data.result.page + 1) })} class="rounded-(--radius) border border-(--color-border) px-3 py-1.5 hover:bg-(--color-elevate)">Next →</a>
		{/if}
	</div>
{/if}
