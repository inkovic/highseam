<script lang="ts">
	import { enhance } from '$app/forms';
	import DocForm from '$lib/admin/DocForm.svelte';
	import { displayValue } from '$lib/admin/client';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const title = $derived(displayValue(data.doc[data.collection.useAsTitle] ?? data.doc.id));
	const savedMessage = $derived(
		form?.published
			? 'Published.'
			: form?.draft
				? 'Draft saved — the published version is unchanged.'
				: form?.unpublished
					? 'Unpublished — now hidden from published-only readers.'
					: form?.restored
						? 'Version restored.'
						: form?.saved
							? 'Saved.'
							: ''
	);
</script>

<div class="mb-6 flex items-start justify-between gap-4">
	<div>
		<a href="/admin/{data.collection.slug}" class="text-sm text-(--color-muted) hover:text-(--color-fg)">
			← {data.collection.labels.plural}
		</a>
		<h1 class="mt-1 flex items-center gap-3 text-2xl font-semibold tracking-tight">
			{title}
			{#if data.collection.drafts}
				{#if data.liveStatus === 'published'}
					<span class="rounded-full border border-(--color-success) px-2.5 py-0.5 text-xs font-medium text-(--color-success)">Published</span>
				{:else}
					<span class="rounded-full border border-(--color-border) px-2.5 py-0.5 text-xs font-medium text-(--color-muted)">Draft</span>
				{/if}
				{#if data.hasDraftChanges}
					<span class="rounded-full border border-(--color-primary) px-2.5 py-0.5 text-xs font-medium text-(--color-primary)">Unpublished changes</span>
				{/if}
			{/if}
		</h1>
		<p class="mt-1 text-xs text-(--color-muted)">
			id: {data.doc.id} · updated {displayValue(data.doc.updatedAt)}
		</p>
	</div>
	<div class="flex shrink-0 items-center gap-2">
		{#if data.collection.drafts && data.liveStatus === 'published'}
			<form method="POST" action="?/unpublish" use:enhance>
				<button class="rounded-(--radius) border border-(--color-border) px-3 py-1.5 text-sm text-(--color-muted) hover:text-(--color-fg)">
					Unpublish
				</button>
			</form>
		{/if}
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
</div>

{#if savedMessage}
	<div class="mb-4 max-w-2xl rounded-(--radius) border border-(--color-success) bg-(--color-elevate) px-4 py-2 text-sm text-(--color-success)">
		{savedMessage}
	</div>
{/if}

<div class="flex flex-wrap gap-10">
	<div class="min-w-0 flex-1">
		<DocForm
			collection={data.collection}
			values={data.doc}
			relOptions={data.relOptions}
			errors={form?.errors ?? {}}
			message={form?.message}
			submitLabel={data.collection.drafts ? 'Publish' : 'Save changes'}
			action={data.collection.drafts ? '?/publish' : '?/save'}
			draftAction={data.collection.drafts ? '?/saveDraft' : undefined}
			autosave={data.collection.drafts}
		/>
	</div>

	{#if data.collection.versioned && data.versions.length > 0}
		<aside class="w-72 shrink-0">
			<h2 class="mb-3 text-xs font-semibold tracking-widest text-(--color-muted) uppercase">
				Versions
			</h2>
			<ol class="space-y-2">
				{#each data.versions as v, i (v.id)}
					<li class="rounded-(--radius) border border-(--color-border) bg-(--color-elevate) px-3 py-2">
						<div class="flex items-center justify-between gap-2">
							<span class="truncate text-xs text-(--color-fg)">{v.title || '—'}</span>
							<span class="shrink-0 text-[10px] font-medium uppercase {v.status === 'published' ? 'text-(--color-success)' : 'text-(--color-muted)'}">{v.status}</span>
						</div>
						<div class="mt-1 flex items-center justify-between gap-2">
							<span class="text-[11px] text-(--color-muted)">{displayValue(v.createdAt)}</span>
							{#if i > 0}
								<form method="POST" action="?/restore" use:enhance>
									<input type="hidden" name="versionId" value={v.id} />
									<button class="text-[11px] text-(--color-primary) hover:underline">Restore</button>
								</form>
							{:else}
								<span class="text-[11px] text-(--color-muted)">latest</span>
							{/if}
						</div>
					</li>
				{/each}
			</ol>
		</aside>
	{/if}
</div>
