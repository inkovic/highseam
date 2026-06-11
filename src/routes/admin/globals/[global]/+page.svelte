<script lang="ts">
	import DocForm from '$lib/admin/DocForm.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<div class="mb-6">
	<p class="text-xs font-semibold tracking-widest text-(--color-muted) uppercase">Global</p>
	<h1 class="mt-1 text-2xl font-semibold tracking-tight">{data.global.labels.singular}</h1>
	{#if data.global.description}
		<p class="mt-1 text-sm text-(--color-muted)">{data.global.description}</p>
	{/if}
</div>

{#if form?.saved}
	<div class="mb-4 max-w-2xl rounded-(--radius) border border-(--color-success) bg-(--color-elevate) px-4 py-2 text-sm text-(--color-success)">
		Saved.
	</div>
{/if}

<DocForm
	collection={data.global}
	values={data.doc}
	relOptions={data.relOptions}
	errors={form?.errors ?? {}}
	message={form?.message}
	submitLabel="Save"
/>
