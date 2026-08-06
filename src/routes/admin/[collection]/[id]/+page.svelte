<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto, invalidateAll } from '$app/navigation';
	import DocForm from '$lib/admin/DocForm.svelte';
	import { displayValue } from '$lib/admin/client';
	import { pushToast } from '$lib/admin/toast-store.svelte.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const title = $derived(displayValue(data.doc[data.collection.useAsTitle] ?? data.doc.id));
	/** Action URLs carry the locale so writes target the locale being edited. */
	const localeSuffix = $derived(
		data.hasLocalizedFields && data.locale ? `&locale=${data.locale}` : ''
	);

	// --- Live preview ---
	let showPreview = $state(false);
	let iframeEl: HTMLIFrameElement | undefined = $state();
	let formWrap: HTMLDivElement | undefined = $state();
	let previewReady = $state(false);

	/** Serialize the edit form into a plain doc for Mode B (live) preview. */
	function formDoc(): Record<string, unknown> {
		const f = formWrap?.querySelector('form');
		if (!f) return {};
		const out: Record<string, unknown> = { ...data.doc };
		for (const [k, v] of new FormData(f).entries()) {
			if (typeof v !== 'string') continue;
			try {
				out[k] = v.trim().startsWith('[') || v.trim().startsWith('{') ? JSON.parse(v) : v;
			} catch {
				out[k] = v;
			}
		}
		return out;
	}
	let pushTimer: ReturnType<typeof setTimeout> | undefined;
	function pushPreview() {
		if (!showPreview || !previewReady) return;
		clearTimeout(pushTimer);
		pushTimer = setTimeout(() => {
			iframeEl?.contentWindow?.postMessage(
				{ type: 'highseam:preview', doc: formDoc() },
				'*'
			);
		}, 300);
	}
	$effect(() => {
		if (typeof window === 'undefined') return;
		const onMsg = (e: MessageEvent) => {
			if ((e.data as { type?: string })?.type === 'highseam:preview-ready') {
				previewReady = true;
				pushPreview();
			}
		};
		window.addEventListener('message', onMsg);
		return () => window.removeEventListener('message', onMsg);
	});
	// Reload the iframe after a save (Mode A).
	$effect(() => {
		if (form?.saved && iframeEl) iframeEl.src = iframeEl.src;
	});

	// Custom document actions (collection.admin.actions): POST {collection,id}
	// to a consumer endpoint — the hook bus surfaced in the UI.
	let runningAction = $state<string | null>(null);
	async function runAction(action: { label: string; url: string; confirm?: string }) {
		if (action.confirm && !confirm(action.confirm)) return;
		if (runningAction) return;
		runningAction = action.label;
		try {
			const res = await fetch(action.url, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ collection: data.collection.slug, id: data.doc.id })
			});
			const body = (await res.json().catch(() => ({}))) as { message?: string };
			if (res.ok) {
				pushToast(body.message ?? `${action.label} done`, 'success');
				await invalidateAll();
				if (iframeEl) iframeEl.src = iframeEl.src;
			} else {
				pushToast(body.message ?? `${action.label} failed (${res.status})`, 'error');
			}
		} catch {
			pushToast(`${action.label} failed`, 'error');
		} finally {
			runningAction = null;
		}
	}
	// Surface save results as a toast (fires once per form-action response).
	let lastToastForm: unknown = null;
	$effect(() => {
		if (!form || form === lastToastForm) return;
		lastToastForm = form;
		const msg = form.published
			? 'Published'
			: form.draft
				? 'Draft saved — published version unchanged'
				: form.unpublished
					? 'Unpublished'
					: form.restored
						? 'Version restored'
						: form.saved
							? 'Saved'
							: '';
		if (msg) pushToast(msg, 'success');
		else if (form.message) pushToast(form.message, 'error');
	});
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
		{#if data.previewUrl}
			<button
				type="button"
				onclick={() => (showPreview = !showPreview)}
				class="rounded-(--radius) border px-3 py-1.5 text-sm {showPreview
					? 'border-(--color-primary) text-(--color-primary)'
					: 'border-(--color-border) text-(--color-muted) hover:text-(--color-fg)'}"
			>
				{showPreview ? 'Hide preview' : 'Preview'}
			</button>
			<a href={data.previewUrl} target="_blank" rel="noopener" class="rounded-(--radius) border border-(--color-border) px-3 py-1.5 text-sm text-(--color-muted) hover:text-(--color-fg)" title="Open on site">↗</a>
		{/if}
		{#if data.hasLocalizedFields && data.locales.length > 0}
			<select
				class="rounded-(--radius) border border-(--color-border) bg-(--color-elevate) px-2 py-1.5 text-sm text-(--color-fg) focus:border-(--color-primary) focus:outline-none"
				value={data.locale}
				onchange={(e) => goto(`?locale=${e.currentTarget.value}`, { invalidateAll: true })}
				title="Editing locale"
			>
				{#each data.locales as l (l)}
					<option value={l}>{l.toUpperCase()}</option>
				{/each}
			</select>
		{/if}
		{#each data.collection.actions as action (action.label)}
			<button
				type="button"
				disabled={runningAction !== null}
				class="inline-flex items-center gap-1.5 rounded-(--radius) border border-(--color-primary) px-3 py-1.5 text-sm text-(--color-primary) hover:bg-(--color-primary) hover:text-(--color-primary-fg) disabled:opacity-50"
				onclick={() => runAction(action)}
			>
				{#if runningAction === action.label}
					<span class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"></span>
					Working…
				{:else}
					{action.label}
				{/if}
			</button>
		{/each}
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

{#if data.lockedBy}
	<div class="mb-4 max-w-2xl rounded-(--radius) border border-(--color-danger) bg-(--color-elevate) px-4 py-2 text-sm text-(--color-danger)">
		⚠ Currently being edited by <strong>{data.lockedBy.email}</strong> (since
		{displayValue(data.lockedBy.at)}). Your changes may overwrite theirs.
	</div>
{/if}


<div class="flex flex-wrap gap-10">
	<div bind:this={formWrap} oninput={pushPreview} class="min-w-0 flex-1">
		<DocForm
			collection={data.collection}
			values={data.doc}
			relOptions={data.relOptions}
			errors={form?.errors ?? {}}
			message={form?.message}
			submitLabel={data.collection.drafts ? 'Publish' : 'Save changes'}
			action={(data.collection.drafts ? '?/publish' : '?/save') + localeSuffix}
			draftAction={data.collection.drafts ? `?/saveDraft${localeSuffix}` : undefined}
			autosave={data.collection.drafts}
		/>
	</div>

	{#if showPreview && data.previewUrl}
		<div class="min-w-80 flex-1 basis-[480px]">
			<div class="sticky top-4">
				<p class="mb-2 text-xs font-semibold tracking-widest text-(--color-muted) uppercase">Live preview</p>
				<iframe
					bind:this={iframeEl}
					src={data.previewUrl}
					title="Live preview"
					class="h-[70vh] w-full resize-y rounded-(--radius) border border-(--color-border) bg-white"
				></iframe>
			</div>
		</div>
	{/if}

	{#if data.collection.upload}
		{@const src = data.doc.source as Record<string, unknown> | undefined}
		{@const first = data.doc.firstUsedIn as Record<string, unknown> | undefined}
		<aside class="w-72 shrink-0 space-y-4">
			<div>
				<h2 class="mb-2 text-xs font-semibold tracking-widest text-(--color-muted) uppercase">
					Used in {data.usage.length} place{data.usage.length === 1 ? '' : 's'}
				</h2>
				{#if data.usage.length === 0}
					<p class="text-xs text-(--color-muted)">Not referenced anywhere — safe to delete.</p>
				{:else}
					<ul class="space-y-1.5">
						{#each data.usage as use (use.collection + use.id + use.field)}
							<li>
								<a
									href="/admin/{use.collection}/{use.id}"
									class="block rounded-(--radius) border border-(--color-border) bg-(--color-elevate) px-3 py-1.5 text-xs hover:border-(--color-primary)"
								>
									<span class="font-medium">{use.title}</span>
									<span class="text-(--color-muted)"> · {use.collection}.{use.field}</span>
								</a>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
			{#if src || first}
				<div class="space-y-1.5 rounded-(--radius) border border-(--color-border) bg-(--color-elevate) p-3 text-xs">
					<p class="font-semibold tracking-widest text-(--color-muted) uppercase">Provenance</p>
					{#if src?.kind}<p><span class="text-(--color-muted)">source:</span> {String(src.kind)}{src.via ? ` · ${String(src.via)}` : ''}</p>{/if}
					{#if src?.externalKey}<p><span class="text-(--color-muted)">key:</span> <code class="rounded bg-(--color-elevate-2) px-1">{String(src.externalKey)}</code></p>{/if}
					{#if src?.originUrl}<p class="truncate"><span class="text-(--color-muted)">origin:</span> <a href={String(src.originUrl)} target="_blank" rel="noopener" class="text-(--color-primary) hover:underline">{String(src.originUrl)}</a></p>{/if}
					{#if first}
						<p>
							<span class="text-(--color-muted)">first used:</span>
							<a href="/admin/{String(first.collection)}/{String(first.id)}" class="text-(--color-primary) hover:underline">
								{String(first.title ?? first.slug ?? first.id)}
							</a>
						</p>
					{/if}
					{#if data.doc._adopted}<p class="text-(--color-muted)">file is importer-owned (never auto-deleted)</p>{/if}
				</div>
			{/if}
		</aside>
	{/if}

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
