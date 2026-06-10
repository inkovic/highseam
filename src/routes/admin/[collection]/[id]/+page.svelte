<script lang="ts">
	import { enhance } from '$app/forms';
	import DocForm from '$lib/admin/DocForm.svelte';
	import { displayValue } from '$lib/admin/client';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const title = $derived(displayValue(data.doc[data.collection.useAsTitle] ?? data.doc.id));
</script>

<div class="mb-6 flex items-start justify-between gap-4">
	<div>
		<a href="/admin/{data.collection.slug}" class="text-sm text-(--color-muted) hover:text-(--color-fg)">
			← {data.collection.labels.plural}
		</a>
		<h1 class="mt-1 text-2xl font-semibold tracking-tight">{title}</h1>
		<p class="mt-1 text-xs text-(--color-muted)">
			id: {data.doc.id} · updated {displayValue(data.doc.updatedAt)}
		</p>
	</div>
	<form
		method="POST"
		action="?/delete"
		use:enhance
		onsubmit={(e) => {
			if (!confirm(`Delete this ${data.collection.labels.singular.toLowerCase()}? This cannot be undone.`))
				e.preventDefault();
		}}
	>
		<button class="rounded-(--radius) border border-(--color-danger) px-3 py-1.5 text-sm text-(--color-danger) hover:bg-(--color-danger) hover:text-white">
			Delete
		</button>
	</form>
</div>

{#if form?.saved}
	<div class="mb-4 max-w-2xl rounded-(--radius) border border-(--color-success) bg-(--color-elevate) px-4 py-2 text-sm text-(--color-success)">
		Saved.
	</div>
{/if}

<DocForm
	collection={data.collection}
	values={data.doc}
	relOptions={data.relOptions}
	errors={form?.errors ?? {}}
	message={form?.message}
	submitLabel="Save changes"
	action="?/save"
/>
