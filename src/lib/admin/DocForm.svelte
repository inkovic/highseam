<script lang="ts">
	import { enhance } from '$app/forms';
	import { beforeNavigate } from '$app/navigation';
	import BlocksInput from './BlocksInput.svelte';
	import FieldInput from './FieldInput.svelte';
	import FocalPicker from './FocalPicker.svelte';
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
		autosave = false,
		mediaAspects = []
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
		/** Registered aspect ratios (cms.config → media.aspects) for the hotspot previews. */
		mediaAspects?: { name: string; ratio: string }[];
	} = $props();

	const hasFocalField = $derived(collection.fields.some((f) => f.name === 'focalPoint'));

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
	// Sidebar fields (admin.position: 'sidebar') split off into a meta column.
	const sidebarFields = $derived(visibleFields.filter((f) => f.admin.position === 'sidebar'));
	const mainFields = $derived(visibleFields.filter((f) => f.admin.position !== 'sidebar'));
	// Grouping: ungrouped main fields first, then one group per admin.group.
	const ungroupedFields = $derived(mainFields.filter((f) => !f.admin.group));
	const groupNames = $derived([
		...new Set(mainFields.filter((f) => f.admin.group).map((f) => f.admin.group!))
	]);
	const fieldsInGroup = (g: string) => mainFields.filter((f) => f.admin.group === g);
	const useTabs = $derived(collection.groupsAs === 'tabs' && groupNames.length > 0);
	let activeTab = $state('');
	const currentTab = $derived(activeTab || groupNames[0] || '');

	/** How many errored fields sit in each group — so a tab can show a badge. */
	const errorsByGroup = $derived.by(() => {
		const counts: Record<string, number> = {};
		for (const f of visibleFields) {
			if (!errors[f.name] || !f.admin.group) continue;
			counts[f.admin.group] = (counts[f.admin.group] ?? 0) + 1;
		}
		return counts;
	});

	// A validation error inside a collapsed/inactive tab is invisible: the save
	// looks like it silently did nothing. Jump to the first tab that has one.
	let lastErrorKey = '';
	$effect(() => {
		const keys = Object.keys(errors);
		if (keys.length === 0) return;
		const sig = keys.join(',');
		if (sig === lastErrorKey) return;
		lastErrorKey = sig;
		const firstBad = visibleFields.find((f) => errors[f.name]);
		if (firstBad?.admin.group && useTabs) activeTab = firstBad.admin.group;
		// Scroll it into view whichever layout we're in.
		queueMicrotask(() => {
			if (!firstBad) return;
			formEl
				?.querySelector(`[name="${CSS.escape(firstBad.name)}"]`)
				?.scrollIntoView({ block: 'center', behavior: 'smooth' });
		});
	});
	const inputClass =
		'w-full rounded-(--radius) border border-(--color-border) bg-(--color-elevate) px-3 py-2 text-sm focus:border-(--color-primary) focus:outline-none';
	const isEdit = $derived(Boolean(values.id));

	// --- dirty tracking + guards ---
	let dirty = $state(false);
	let submitting = $state(false);
	/** Which button was pressed, so only that one shows the spinner. */
	let pendingLabel = $state('');
	function markDirty() {
		dirty = true;
	}
	// Warn on in-app navigation away with unsaved edits.
	beforeNavigate((nav) => {
		if (dirty && !submitting && nav.type !== 'leave') {
			if (!confirm('You have unsaved changes. Leave without saving?')) nav.cancel();
		}
	});
	// Warn on tab close / hard reload.
	$effect(() => {
		if (typeof window === 'undefined') return;
		const handler = (e: BeforeUnloadEvent) => {
			if (dirty && !submitting) {
				e.preventDefault();
				e.returnValue = '';
			}
		};
		window.addEventListener('beforeunload', handler);
		return () => window.removeEventListener('beforeunload', handler);
	});
	// Cmd/Ctrl-S submits the form.
	$effect(() => {
		if (typeof window === 'undefined') return;
		const onKey = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
				e.preventDefault();
				formEl?.requestSubmit();
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});
	function onFormInput() {
		markDirty();
		scheduleAutosave();
	}
	// Clear dirty once a submit is under way (guard won't block the save nav).
	function onSubmit() {
		submitting = true;
		dirty = false;
	}
	// Reset the submitting flag after an enhanced action that didn't navigate
	// (e.g. Save returning { saved: true }), so later edits re-arm the guard.
	const handleEnhance = () => {
		return async ({ update }: { update: (opts?: { reset?: boolean }) => Promise<void> }) => {
			await update({ reset: false });
			submitting = false;
		};
	};
</script>

<form
	method="POST"
	{action}
	enctype={collection.upload ? 'multipart/form-data' : undefined}
	use:enhance={handleEnhance}
	bind:this={formEl}
	oninput={onFormInput}
	onsubmit={onSubmit}
	class="flex flex-wrap gap-8 {sidebarFields.length === 0 ? 'max-w-2xl' : ''}"
>
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

	<div class="min-w-0 flex-1 space-y-5">
	{#if collection.upload}
		<div class="space-y-2">
			{#if typeof values.url === 'string'}
				{#if String(values.mimeType ?? '').startsWith('image/')}
					{#if hasFocalField}
						<!-- The hotspot IS the image preview: click the subject that
						     must survive every crop; registered aspects preview live. -->
						<FocalPicker
							url={values.url}
							alt={String(values.filename ?? 'upload')}
							value={values.focalPoint}
							aspects={mediaAspects}
						/>
					{:else}
						<img
							src={values.url}
							alt={String(values.filename ?? 'upload')}
							class="max-h-56 rounded-(--radius) border border-(--color-border)"
						/>
					{/if}
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

	{#each ungroupedFields as field (field.name)}
		{@render fieldRow(field)}
	{/each}

	{#if useTabs}
		<!-- Tabbed groups (admin.groupsAs: 'tabs') -->
		<div class="flex flex-wrap gap-1 border-b border-(--color-border)">
			{#each groupNames as group (group)}
				<button
					type="button"
					onclick={() => (activeTab = group)}
					class="-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors {currentTab === group
						? 'border-(--color-primary) font-medium text-(--color-primary)'
						: 'border-transparent text-(--color-muted) hover:text-(--color-fg)'}"
				>
					{group}
					{#if errorsByGroup[group]}
						<span class="rounded-full bg-(--color-danger) px-1.5 text-[10px] font-semibold text-white">
							{errorsByGroup[group]}
						</span>
					{/if}
				</button>
			{/each}
		</div>
		{#each groupNames as group (group)}
			<!-- keep all panels mounted (so inputs still submit) but hide inactive -->
			<div class="space-y-5" class:hidden={currentTab !== group}>
				{#each fieldsInGroup(group) as field (field.name)}
					{@render fieldRow(field)}
				{/each}
			</div>
		{/each}
	{:else}
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
	{/if}

	{#if message}
		<p class="text-sm text-(--color-danger)">{message}</p>
	{/if}

	<!-- Sticky: on a 60-field form the actions must never scroll out of reach,
	     and the click must acknowledge itself immediately rather than leaving
	     you waiting for a toast. -->
	<div
		class="sticky bottom-0 -mx-1 flex items-center gap-3 border-t border-(--color-border) bg-(--color-bg)/95 px-1 py-3 backdrop-blur"
	>
		<button
			disabled={submitting}
			onclick={() => (pendingLabel = submitLabel)}
			class="inline-flex items-center gap-2 rounded-(--radius) bg-(--color-primary) px-5 py-2 text-sm font-semibold text-(--color-primary-fg) hover:opacity-90 disabled:opacity-60"
		>
			{#if submitting && pendingLabel === submitLabel}
				<span class="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"></span>
				Saving…
			{:else}
				{submitLabel}
			{/if}
		</button>
		{#if draftAction}
			<button
				formaction={draftAction}
				disabled={submitting}
				onclick={() => (pendingLabel = draftLabel)}
				class="inline-flex items-center gap-2 rounded-(--radius) border border-(--color-border) px-5 py-2 text-sm text-(--color-fg) hover:border-(--color-primary) disabled:opacity-60"
			>
				{#if submitting && pendingLabel === draftLabel}
					<span class="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"></span>
					Saving…
				{:else}
					{draftLabel}
				{/if}
			</button>
		{/if}
		<a href="/admin/{collection.slug}" class="text-sm text-(--color-muted) hover:text-(--color-fg)">Cancel</a>
		{#if dirty && !submitting}
			<span class="text-xs text-(--color-muted)">Unsaved changes</span>
		{/if}
		{#if autosave && autosaveState !== 'idle'}
			<span class="ml-auto text-xs {autosaveState === 'error' ? 'text-(--color-danger)' : 'text-(--color-muted)'}">
				{autosaveState === 'saving' ? 'Autosaving…' : autosaveState === 'saved' ? 'Draft autosaved' : 'Autosave failed'}
			</span>
		{/if}
		</div>
	</div>

	{#if sidebarFields.length > 0}
		<aside class="w-full shrink-0 space-y-5 lg:w-72">
			<div class="rounded-(--radius) border border-(--color-border) bg-(--color-elevate) p-4 space-y-5">
				<p class="text-[10px] font-semibold tracking-widest text-(--color-muted) uppercase">Meta</p>
				{#each sidebarFields as field (field.name)}
					{@render fieldRow(field)}
				{/each}
			</div>
		</aside>
	{/if}
</form>
