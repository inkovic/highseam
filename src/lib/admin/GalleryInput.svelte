<script lang="ts">
	/**
	 * Editor for gallery values — ordered upload refs with per-item overrides.
	 * Assembled from the parts that already exist: MediaPicker (multi-add),
	 * focal-aware thumbnails, the in-context MediaEditModal per item, and the
	 * repeater's reorder pattern. Per-item alt/caption inputs override the
	 * media doc's defaults via the resolveMedia() precedence (empty = inherit).
	 *
	 * Value: [{ id, alt?, caption? }]. Bare id strings in incoming values are
	 * lifted to the item shape (the migration contract — matches the server).
	 */
	import MediaPicker from './MediaPicker.svelte';
	import MediaEditModal from './MediaEditModal.svelte';
	import { focalObjectPosition } from '$lib/core/media';
	import type { RelOption } from './server';

	type Item = { id: string; alt?: string; caption?: string };

	let {
		name,
		relationTo,
		value = undefined,
		submitHidden = true,
		onChange = undefined,
		mediaAspects = [],
		maxItems = undefined,
		readOnly = false
	}: {
		name: string;
		relationTo: string;
		value?: unknown;
		submitHidden?: boolean;
		onChange?: (items: Item[]) => void;
		mediaAspects?: { name: string; ratio: string; contexts?: string[] }[];
		maxItems?: number;
		readOnly?: boolean;
	} = $props();

	function initial(): Item[] {
		if (!Array.isArray(value)) return [];
		return (value as unknown[])
			.map((v) => {
				if (typeof v === 'string') return { id: v };
				if (v && typeof v === 'object' && typeof (v as Item).id === 'string') {
					const it = v as Item & Record<string, unknown>;
					return { id: it.id, ...(it.alt !== undefined ? { alt: it.alt } : {}), ...(it.caption !== undefined ? { caption: it.caption } : {}) };
				}
				return null;
			})
			.filter((v): v is Item => v !== null);
	}

	// svelte-ignore state_referenced_locally — seed once from the prop
	let items = $state<Item[]>(initial());
	let pickerOpen = $state(false);
	let editingId = $state('');
	let meta = $state<Map<string, RelOption>>(new Map());
	let hiddenInput: HTMLInputElement | undefined = $state();

	const serialized = $derived(JSON.stringify(items));
	const atMax = $derived(maxItems !== undefined && items.length >= maxItems);

	function notify() {
		onChange?.(JSON.parse(serialized) as Item[]);
		// Reorder/remove are button clicks — no native input event. Tell the form.
		queueMicrotask(() => hiddenInput?.dispatchEvent(new Event('input', { bubbles: true })));
	}

	// Resolve thumbnails/titles for ids we don't know yet.
	$effect(() => {
		const missing = items.filter((it) => !meta.has(it.id)).map((it) => it.id);
		if (missing.length === 0) return;
		fetch(`/api/${relationTo}/options?ids=${encodeURIComponent(missing.join(','))}`)
			.then((r) => (r.ok ? r.json() : { options: [] }))
			.then((d: { options: RelOption[] }) => {
				const m = new Map(meta);
				for (const o of d.options) m.set(o.id, o);
				meta = m;
			})
			.catch(() => {});
	});

	/** MediaPicker returns the complete selection: reconcile, don't append —
	 *  retained items keep their order and overrides, new ids join at the end,
	 *  deselected ones drop. */
	function addPicked(ids: string[]) {
		const have = new Set(items.map((i) => i.id));
		const next: Item[] = items.filter((it) => ids.includes(it.id));
		for (const id of ids) if (!have.has(id)) next.push({ id });
		items = maxItems !== undefined ? next.slice(0, maxItems) : next;
		notify();
	}
	function remove(i: number) {
		items.splice(i, 1);
		notify();
	}
	function move(i: number, dir: -1 | 1) {
		const j = i + dir;
		if (j < 0 || j >= items.length) return;
		[items[i], items[j]] = [items[j], items[i]];
		notify();
	}
	function setOverride(i: number, key: 'alt' | 'caption', v: string) {
		if (v) items[i][key] = v;
		else delete items[i][key];
		notify();
	}
	function onMediaSaved(doc: Record<string, unknown>) {
		const opt: RelOption = {
			id: String(doc.id),
			title: String(doc.filename ?? doc.id),
			url: typeof doc.url === 'string' ? doc.url : undefined,
			mimeType: String(doc.mimeType ?? ''),
			alt: typeof doc.alt === 'string' ? doc.alt : undefined,
			focalPoint: doc.focalPoint as RelOption['focalPoint']
		};
		meta = new Map(meta).set(opt.id, opt);
	}

	const btn =
		'rounded px-1.5 py-0.5 text-xs text-(--color-muted) hover:bg-(--color-elevate-2) hover:text-(--color-fg) disabled:opacity-30';
	const overrideCls =
		'w-full rounded border border-(--color-border) bg-(--color-bg) px-2 py-1 text-xs text-(--color-fg) placeholder-(--color-muted) focus:border-(--color-primary) focus:outline-none';
</script>

<div class="space-y-2" data-hs-gallery-input>
	{#if submitHidden}
		<input type="hidden" {name} value={serialized} bind:this={hiddenInput} />
	{/if}

	{#if items.length > 0}
		<div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
			{#each items as item, i (item.id)}
				{@const m = meta.get(item.id)}
				<div class="overflow-hidden rounded-(--radius) border border-(--color-border) bg-(--color-elevate)">
					<div class="relative aspect-[3/2] bg-(--color-elevate-2)">
						{#if m?.url && (m.mimeType ?? '').startsWith('image/')}
							<img
								src={m.url}
								alt={item.alt ?? m.alt ?? m.title}
								class="h-full w-full object-cover"
								style="object-position: {focalObjectPosition(m.focalPoint)};"
								loading="lazy"
							/>
						{:else}
							<div class="flex h-full items-center justify-center text-xs text-(--color-muted)">
								{m?.title ?? item.id}
							</div>
						{/if}
						{#if !readOnly}
							<span class="absolute top-1 right-1 flex gap-0.5 rounded bg-black/55 px-1 py-0.5">
								<button type="button" class="text-[11px] text-white/90 hover:text-white disabled:opacity-40" disabled={i === 0} onclick={() => move(i, -1)} title="Move left">←</button>
								<button type="button" class="text-[11px] text-white/90 hover:text-white disabled:opacity-40" disabled={i === items.length - 1} onclick={() => move(i, 1)} title="Move right">→</button>
								<button type="button" class="text-[11px] text-white/90 hover:text-white" onclick={() => (editingId = item.id)} title="Edit media (focal point, defaults)">✎</button>
								<button type="button" class="text-[11px] text-white/90 hover:text-red-300" onclick={() => remove(i)} title="Remove from gallery">✕</button>
							</span>
						{/if}
					</div>
					{#if !readOnly}
						<div class="space-y-1 p-1.5">
							<input
								type="text"
								class={overrideCls}
								placeholder={m?.alt ? `alt: ${m.alt}` : 'alt override…'}
								value={item.alt ?? ''}
								oninput={(e) => setOverride(i, 'alt', e.currentTarget.value)}
							/>
							<input
								type="text"
								class={overrideCls}
								placeholder="caption override…"
								value={item.caption ?? ''}
								oninput={(e) => setOverride(i, 'caption', e.currentTarget.value)}
							/>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}

	{#if !readOnly}
		<button
			type="button"
			class="rounded-(--radius) border border-dashed border-(--color-border) px-3 py-1.5 text-xs text-(--color-muted) hover:border-(--color-primary) hover:text-(--color-primary) disabled:opacity-40"
			disabled={atMax}
			onclick={() => (pickerOpen = true)}
		>
			+ Add images{maxItems !== undefined ? ` (${items.length}/${maxItems})` : ''}
		</button>
	{/if}
</div>

{#if pickerOpen}
	<MediaPicker
		bind:open={pickerOpen}
		{relationTo}
		optionsUrl="/api/{relationTo}/options"
		uploadUrl="/api/{relationTo}"
		hasMany={true}
		selectedIds={items.map((i) => i.id)}
		onPick={addPicked}
	/>
{/if}

{#if editingId}
	<MediaEditModal
		open={true}
		id={editingId}
		{relationTo}
		aspects={mediaAspects}
		onSaved={onMediaSaved}
		onclose={() => (editingId = '')}
	/>
{/if}
