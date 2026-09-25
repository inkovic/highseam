<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto, invalidateAll } from '$app/navigation';
	import DocForm from '$lib/admin/DocForm.svelte';
	import { displayValue } from '$lib/admin/client';
	import { pushToast } from '$lib/admin/toast-store.svelte.js';
	import { editorUi } from '$lib/admin/editor-ui.svelte.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const title = $derived(displayValue(data.doc[data.collection.useAsTitle] ?? data.doc.id));
	/** Action URLs carry the locale so writes target the locale being edited. */
	const localeSuffix = $derived(
		data.hasLocalizedFields && data.locale ? `&locale=${data.locale}` : ''
	);

	// --- Live preview ---
	// Preview open / width live in editorUi (1.7.4) so a full-screen editor can
	// sit beside the preview and toggle it. Closed on arrival, as before.
	editorUi.previewOpen = false;
	editorUi.fullscreen = null;
	$effect(() => {
		editorUi.previewAvailable = Boolean(data.previewUrl);
	});
	// Another document (same page component): leave full screen.
	// svelte-ignore state_referenced_locally — seed once; the effect tracks changes
	let lastDocId = data.doc.id;
	$effect(() => {
		if (data.doc.id !== lastDocId) {
			lastDocId = data.doc.id;
			editorUi.fullscreen = null;
		}
	});
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
		if (!editorUi.previewOpen || !previewReady) return;
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
	// 1.7.4: …and after each draft autosave (DocForm fires highseam:autosaved
	// once the draft is stored), so a Mode A preview follows the typing.
	let reloadTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		const onAutosaved = () => {
			if (!editorUi.previewOpen) return;
			clearTimeout(reloadTimer);
			reloadTimer = setTimeout(() => {
				if (iframeEl) iframeEl.src = iframeEl.src;
			}, 250);
		};
		window.addEventListener('highseam:autosaved', onAutosaved);
		return () => {
			clearTimeout(reloadTimer);
			window.removeEventListener('highseam:autosaved', onAutosaved);
		};
	});

	// --- Preview pane (1.7.4) ---
	// With the preview open the page is two panes: the form, and the preview at
	// a width you drag (or arrow-key) on the divider, remembered per browser.
	// "Phone" narrows the frame to 390px to check the mobile layout.
	const paned = $derived(editorUi.previewOpen && !!data.previewUrl);
	/** A field is being edited full screen: the preview pins to the window's right. */
	const pinned = $derived(paned && editorUi.fullscreen !== null);
	const PCT_KEY = 'highseam:preview-width';
	const PCT_MIN = 25;
	const PCT_MAX = 70;
	const PCT_DEFAULT = 45;
	let phone = $state(false);
	let dragging = $state(false);
	let row: HTMLDivElement | undefined = $state();
	$effect(() => {
		try {
			const v = Number(localStorage.getItem(PCT_KEY));
			if (v >= PCT_MIN && v <= PCT_MAX) editorUi.previewPct = v;
		} catch {
			/* storage blocked: keep the default */
		}
	});
	function setPct(v: number, save = true) {
		editorUi.previewPct = Math.min(PCT_MAX, Math.max(PCT_MIN, v));
		if (!save) return;
		try {
			localStorage.setItem(PCT_KEY, String(Math.round(editorUi.previewPct)));
		} catch {
			/* storage blocked */
		}
	}
	function startDrag(e: PointerEvent) {
		dragging = true;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		e.preventDefault();
	}
	function onDrag(e: PointerEvent) {
		if (!dragging || !row) return;
		const r = row.getBoundingClientRect();
		setPct(((r.right - e.clientX) / r.width) * 100, false);
	}
	function endDrag() {
		if (!dragging) return;
		dragging = false;
		setPct(editorUi.previewPct);
	}
	function nudge(e: KeyboardEvent) {
		const step = e.shiftKey ? 10 : 5;
		if (e.key === 'ArrowLeft') setPct(editorUi.previewPct + step);
		else if (e.key === 'ArrowRight') setPct(editorUi.previewPct - step);
		else if (e.key === 'Home') setPct(PCT_MAX);
		else if (e.key === 'End') setPct(PCT_MIN);
		else return;
		e.preventDefault();
	}

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
				onclick={() => (editorUi.previewOpen = !editorUi.previewOpen)}
				class="rounded-(--radius) border px-3 py-1.5 text-sm {editorUi.previewOpen
					? 'border-(--color-primary) text-(--color-primary)'
					: 'border-(--color-border) text-(--color-muted) hover:text-(--color-fg)'}"
			>
				{editorUi.previewOpen ? 'Hide preview' : 'Preview'}
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


<!-- Versions and media usage: side columns normally; under the form when the
     preview pane is open. -->
{#snippet sideInfo()}
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
{/snippet}

<!-- 1.7.4: the form keeps the same position in the tree whether or not the
     preview is open, so toggling the preview never remounts it (unsaved edits
     survive); only the row's layout changes. -->
<div
	bind:this={row}
	class={paned ? 'flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-0' : 'flex flex-wrap gap-10'}
>
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
			mediaAspects={data.mediaAspects}
			galleryLayouts={data.galleryLayouts}
		/>
		{#if paned}
			<div class="mt-10 flex flex-wrap gap-8">
				{@render sideInfo()}
			</div>
		{/if}
	</div>

	{#if paned}
		<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
		<div
			role="separator"
			aria-orientation="vertical"
			aria-label="Resize the preview"
			aria-valuemin={PCT_MIN}
			aria-valuemax={PCT_MAX}
			aria-valuenow={Math.round(editorUi.previewPct)}
			tabindex="0"
			title="Drag to resize · double-click to reset"
			onpointerdown={startDrag}
			onpointermove={onDrag}
			onpointerup={endDrag}
			onpointercancel={endDrag}
			onkeydown={nudge}
			ondblclick={() => setPct(PCT_DEFAULT)}
			class="group hidden w-6 shrink-0 cursor-col-resize touch-none justify-center self-stretch focus:outline-none lg:flex"
		>
			<span
				class="sticky top-4 h-[calc(100vh-2rem)] w-px transition-colors group-hover:bg-(--color-primary) group-focus-visible:bg-(--color-primary) {dragging
					? 'bg-(--color-primary)'
					: 'bg-(--color-border)'}"
			></span>
		</div>
		<!-- Pinned (a field is full screen): fixed to the window's right edge at
		     the same share of the window; the full-screen editor fills the rest. -->
		<div
			class={pinned
				? 'fixed inset-y-0 right-0 z-50 flex flex-col bg-(--color-bg) px-3 pt-3 pb-3'
				: 'min-w-0 lg:sticky lg:top-4 lg:w-(--pw) lg:shrink-0'}
			style={pinned ? `width: ${editorUi.previewPct}vw;` : `--pw: ${editorUi.previewPct}%`}
		>
			<div class="mb-2 flex items-center justify-between gap-2">
				<p class="text-xs font-semibold tracking-widest text-(--color-muted) uppercase">Live preview</p>
				<div role="group" aria-label="Preview width" class="flex overflow-hidden rounded-(--radius) border border-(--color-border) text-xs">
					<button
						type="button"
						aria-pressed={!phone}
						onclick={() => (phone = false)}
						class="px-2.5 py-1 {phone ? 'text-(--color-muted) hover:text-(--color-fg)' : 'bg-(--color-elevate-2) text-(--color-fg)'}"
					>Full width</button>
					<button
						type="button"
						aria-pressed={phone}
						onclick={() => (phone = true)}
						class="border-l border-(--color-border) px-2.5 py-1 {phone ? 'bg-(--color-elevate-2) text-(--color-fg)' : 'text-(--color-muted) hover:text-(--color-fg)'}"
					>Phone</button>
				</div>
			</div>
			<div class="flex justify-center rounded-(--radius) {phone ? 'bg-(--color-elevate-2) py-3' : ''} {pinned ? 'min-h-0 flex-1' : ''}">
				<iframe
					bind:this={iframeEl}
					src={data.previewUrl}
					title="Live preview"
					class="w-full rounded-(--radius) border border-(--color-border) bg-white {pinned ? 'h-full' : 'h-[70vh] lg:h-[calc(100vh-4.5rem)]'} {phone
						? 'max-w-[390px]'
						: ''} {dragging ? 'pointer-events-none' : ''}"
				></iframe>
			</div>
		</div>
	{:else}
		{@render sideInfo()}
	{/if}
</div>
