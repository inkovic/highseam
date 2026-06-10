<script lang="ts">
	import DocForm from '$lib/admin/DocForm.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<div class="mb-6">
	<a href="/admin/{data.collection.slug}" class="text-sm text-(--color-muted) hover:text-(--color-fg)">
		← {data.collection.labels.plural}
	</a>
	<h1 class="mt-1 text-2xl font-semibold tracking-tight">
		Create {data.collection.labels.singular}
	</h1>
</div>

<DocForm
	collection={data.collection}
	relOptions={data.relOptions}
	values={form?.values ?? {}}
	errors={form?.errors ?? {}}
	message={form?.message}
	submitLabel="Create"
/>
