<script lang="ts">
	import { enhance } from '$app/forms';
	import BlocksInput from './BlocksInput.svelte';
	import FieldInput from './FieldInput.svelte';
	import HtmlInput from './HtmlInput.svelte';
	import RichTextInput from './RichTextInput.svelte';
	import type { ClientCollection } from './client';
	import type { RelOption } from './server';

	let {
		collection,
		values = {},
		relOptions = {},
		errors = {},
		message = undefined,
		submitLabel = 'Save',
		action = '',
		draftAction = undefined,
		draftLabel = 'Save draft',
		autosave = false
	}: {
		collection: ClientCollection;
		values?: Record<string, unknown>;
		relOptions?: Record<string, RelOption[]>;
		errors?: Record<string, string>;
		message?: string;
		submitLabel?: string;
		action?: string;
		/** When set (drafts-enabled collections), renders a secondary submit posting here. */
		draftAction?: string;
		draftLabel?: string;
		/** Debounced background draft saves while editing (needs draftAction). */
		autosave?: boolean;
	} = $props();

	let formEl: HTMLFormElement | undefined = $state();
	let autosaveState = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
	let autosaveTimer: ReturnType<typeof setTimeout> | undefined;

	function scheduleAutosave() {
		if (!autosave || !draftAction) return;
		clearTimeout(autosaveTimer);
		autosaveTimer = setTimeout(runAutosave, 2000);
	}

	async function runAutosave() {
		if (!formEl || !draftAction) return;
		autosaveState = 'saving';
		try {
			const res = await fetch(draftAction, {
				method: 'POST',
				body: new FormData(formEl),
				headers: { 'x-sveltekit-action': 'true' }
			});
			autosaveState = res.ok ? 'saved' : 'error';
		} catch {
			autosaveState = 'error';
		}
	}

	const visibleFields = $derived(collection.fields.filter((f) => !f.admin.hidden));
	// Field grouping: ungrouped fields render first, then one collapsible
	// section per admin.group (in first-appearance order).
	const ungroupedFields = $derived(visibleFields.filter((f) => !f.admin.group));
	const groupNames = $derived([
		...new Set(visibleFields.filter((f) => f.admin.group).map((f) => f.admin.group!))
	]);
	const fieldsInGroup = (g: string) => visibleFields.filter((f) => f.admin.group === g);
	const inputClass =
		'w-full rounded-(--radius) border border-(--color-border) bg-(--color-elevate) px-3 py-2 text-sm focus:border-(--color-primary) focus:outline-none';
	const isEdit = $derived(Boolean(values.id));
</script>

<form
	method="POST"
	{action}
	enctype={collection.upload ? 'multipart/form-data' : undefined}
	use:enhance
	bind:this={formEl}
	oninput={scheduleAutosave}
	class="max-w-2xl space-y-5"
>
	{#if collection.upload}
		<div class="space-y-2">
			{#if typeof values.url === 'string'}
				{#if String(values.mimeType ?? '').startsWith('image/')}
					<img
						src={values.url}
						alt={String(values.filename ?? 'upload')}
						class="max-h-56 rounded-(--radius) border border-(--color-border)"
					/>
				{/if}
				<p class="text-xs text-(--color-muted)">
					{values.filename} · {values.mimeType} · {Math.round(Number(values.filesize ?? 0) / 1024)} KB
					— <a href={String(values.url)} target="_blank" rel="noopener" class="text-(--color-primary) hover:underline">open</a>
				</p>
			{/if}
			<div class="space-y-1.5">
				<label class="block text-xs font-medium tracking-wide text-(--color-muted) uppercase" for="file">
					File {#if !isEdit}<span class="text-(--color-primary)">*</span>{/if}
				</label>
				<input
					id="file"
					name="file"
					type="file"
					accept={collection.uploadAccept}
					class="block w-full text-sm text-(--color-muted) file:mr-3 file:rounded-(--radius) file:border-0 file:bg-(--color-primary) file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-(--color-primary-fg)"
				/>
				{#if isEdit}
					<p class="text-xs text-(--color-muted)">Leave empty to keep the current file</p>
				{/if}
			</div>
		</div>
	{/if}
	{#if collection.auth}
		<div class="space-y-1.5">
			<label class="block text-xs font-medium tracking-wide text-(--color-muted) uppercase" for="email">
				Email <span class="text-(--color-primary)">*</span>
			</label>
			<input id="email" name="email" type="email" value={String(values.email ?? '')} class={inputClass} />
			{#if errors.email}<p class="text-xs text-(--color-danger)">{errors.email}</p>{/if}
		</div>
		<div class="space-y-1.5">
			<label class="block text-xs font-medium tracking-wide text-(--color-muted) uppercase" for="password">
				Password {#if !isEdit}<span class="text-(--color-primary)">*</span>{/if}
			</label>
			<input
				id="password"
				name="password"
				type="password"
				placeholder={isEdit ? 'Leave blank to keep current password' : ''}
				class={inputClass}
			/>
			{#if errors.password}<p class="text-xs text-(--color-danger)">{errors.password}</p>{/if}
		</div>
	{/if}

	{#snippet fieldRow(field: (typeof collection.fields)[number])}
		{#if field.type === 'blocks' || field.type === 'array'}
			<BlocksInput {field} value={values[field.name]} {relOptions} />
			{#if errors[field.name]}<p class="text-xs text-(--color-danger)">{errors[field.name]}</p>{/if}
		{:else if field.type === 'richText'}
			<RichTextInput {field} value={values[field.name]} {relOptions} />
			{#if errors[field.name]}<p class="text-xs text-(--color-danger)">{errors[field.name]}</p>{/if}
		{:else if field.type === 'html'}
			<HtmlInput {field} value={values[field.name]} />
			{#if errors[field.name]}<p class="text-xs text-(--color-danger)">{errors[field.name]}</p>{/if}
		{:else}
			<FieldInput {field} value={values[field.name]} {relOptions} error={errors[field.name]} />
		{/if}
	{/snippet}

	{#each ungroupedFields as field (field.name)}
		{@render fieldRow(field)}
	{/each}

	{#each groupNames as group (group)}
		<details
			open
			class="rounded-(--radius) border border-(--color-border) bg-(--color-elevate)/40 [&[open]>summary]:border-b [&[open]>summary]:border-(--color-border)"
		>
			<summary class="cursor-pointer px-4 py-2.5 text-xs font-semibold tracking-widest text-(--color-muted) uppercase select-none hover:text-(--color-fg)">
				{group}
				<span class="ml-1 font-normal opacity-60">({fieldsInGroup(group).length})</span>
			</summary>
			<div class="space-y-5 p-4">
				{#each fieldsInGroup(group) as field (field.name)}
					{@render fieldRow(field)}
				{/each}
			</div>
		</details>
	{/each}

	{#if message}
		<p class="text-sm text-(--color-danger)">{message}</p>
	{/if}

	<div class="flex items-center gap-3 border-t border-(--color-border) pt-5">
		<button class="rounded-(--radius) bg-(--color-primary) px-5 py-2 text-sm font-semibold text-(--color-primary-fg) hover:opacity-90">
			{submitLabel}
		</button>
		{#if draftAction}
			<button
				formaction={draftAction}
				class="rounded-(--radius) border border-(--color-border) px-5 py-2 text-sm text-(--color-fg) hover:border-(--color-primary)"
			>
				{draftLabel}
			</button>
		{/if}
		<a href="/admin/{collection.slug}" class="text-sm text-(--color-muted) hover:text-(--color-fg)">Cancel</a>
		{#if autosave && autosaveState !== 'idle'}
			<span class="ml-auto text-xs {autosaveState === 'error' ? 'text-(--color-danger)' : 'text-(--color-muted)'}">
				{autosaveState === 'saving' ? 'Autosaving…' : autosaveState === 'saved' ? 'Draft autosaved' : 'Autosave failed'}
			</span>
		{/if}
	</div>
</form>
