<script lang="ts">
	/**
	 * One picker for the link primitive: internal document reference (stored
	 * by id — survives slug renames) or external URL. Internal mode renders
	 * only when the field declares `relationTo` collections.
	 */
	import RelationPicker from './RelationPicker.svelte';
	import type { RelOption } from './server';

	type LinkVal = {
		url?: string;
		doc?: { collection: string; id: string; resolved?: Record<string, unknown> };
		newTab?: boolean;
	};

	let {
		name,
		value = undefined,
		relationTo = [],
		relOptions = {},
		submitHidden = true,
		onChange = undefined,
		readOnly = false
	}: {
		name: string;
		value?: unknown;
		/** Collections internal links may target ([] = external-only field). */
		relationTo?: string[];
		relOptions?: Record<string, RelOption[]>;
		submitHidden?: boolean;
		onChange?: (v: LinkVal | null) => void;
		readOnly?: boolean;
	} = $props();

	function initial(): LinkVal | null {
		if (typeof value === 'string' && value.trim()) return { url: value.trim() };
		if (value && typeof value === 'object') {
			const v = value as LinkVal;
			if (v.url || v.doc) return { url: v.url, doc: v.doc, newTab: v.newTab };
		}
		return null;
	}

	// svelte-ignore state_referenced_locally — seed once from the prop
	let link = $state<LinkVal | null>(initial());
	// svelte-ignore state_referenced_locally
	let mode = $state<'internal' | 'external'>(initial()?.doc && relationTo.length ? 'internal' : 'external');
	// svelte-ignore state_referenced_locally
	let targetCollection = $state(initial()?.doc?.collection ?? relationTo[0] ?? '');
	let hiddenInput: HTMLInputElement | undefined = $state();

	const serialized = $derived(link && (link.url || link.doc) ? JSON.stringify({ ...link, doc: link.doc ? { collection: link.doc.collection, id: link.doc.id } : undefined }) : '');

	function notify() {
		onChange?.(link);
		queueMicrotask(() => hiddenInput?.dispatchEvent(new Event('input', { bubbles: true })));
	}
	function setUrl(u: string) {
		link = u.trim() ? { url: u.trim(), newTab: link?.newTab } : link?.newTab ? { newTab: link.newTab } : null;
		notify();
	}
	function setDoc(ids: string[]) {
		const id = ids[0];
		link = id
			? { doc: { collection: targetCollection, id }, newTab: link?.newTab }
			: link?.newTab
				? { newTab: link.newTab }
				: null;
		notify();
	}
	function setNewTab(on: boolean) {
		if (!link) link = {};
		if (on) link.newTab = true;
		else delete link.newTab;
		notify();
	}
	function switchMode(m: 'internal' | 'external') {
		if (mode === m) return;
		mode = m;
		// Destination semantics differ; don't carry one across.
		link = link?.newTab ? { newTab: true } : null;
		notify();
	}

	const seg = (active: boolean) =>
		`rounded px-2 py-0.5 text-[11px] ${active ? 'bg-(--color-primary) text-(--color-primary-fg)' : 'text-(--color-muted) hover:text-(--color-fg)'}`;
	const inputCls =
		'w-full rounded-(--radius) border border-(--color-border) bg-(--color-elevate) px-3 py-2 text-sm text-(--color-fg) placeholder-(--color-muted) focus:border-(--color-primary) focus:outline-none disabled:opacity-50';
</script>

<div class="space-y-1.5" data-hs-link-input>
	{#if submitHidden}
		<input type="hidden" {name} value={serialized} bind:this={hiddenInput} />
	{/if}

	<div class="flex items-center gap-2">
		{#if relationTo.length > 0}
			<span class="inline-flex gap-0.5 rounded-(--radius) border border-(--color-border) bg-(--color-elevate-2) p-0.5">
				<button type="button" class={seg(mode === 'internal')} onclick={() => switchMode('internal')} disabled={readOnly}>internal</button>
				<button type="button" class={seg(mode === 'external')} onclick={() => switchMode('external')} disabled={readOnly}>external</button>
			</span>
		{/if}
		<label class="ml-auto flex items-center gap-1.5 text-[11px] text-(--color-muted)">
			<input type="checkbox" class="h-3.5 w-3.5 accent-(--color-primary)" checked={link?.newTab ?? false} onchange={(e) => setNewTab(e.currentTarget.checked)} disabled={readOnly} />
			new tab
		</label>
	</div>

	{#if mode === 'internal' && relationTo.length > 0}
		<div class="flex gap-2">
			{#if relationTo.length > 1}
				<select
					class="{inputCls} w-auto"
					value={targetCollection}
					onchange={(e) => {
						targetCollection = e.currentTarget.value;
						if (link?.doc) setDoc([]);
					}}
					disabled={readOnly}
				>
					{#each relationTo as slug (slug)}<option value={slug}>{slug}</option>{/each}
				</select>
			{/if}
			<div class="min-w-0 flex-1">
				{#key targetCollection}
					<RelationPicker
						name="_link_{name}"
						options={relOptions[targetCollection] ?? []}
						value={link?.doc?.collection === targetCollection ? link.doc.id : undefined}
						relationTo={targetCollection}
						searchUrl="/api/{targetCollection}/options"
						submitHidden={false}
						onChange={setDoc}
						readOnly={readOnly}
					/>
				{/key}
			</div>
		</div>
		<p class="text-[11px] text-(--color-muted)">Stored by id — renaming the target's slug never breaks this link.</p>
	{:else}
		<input
			type="text"
			class={inputCls}
			placeholder="https://…, mailto:, tel:, or /site-relative"
			value={link?.url ?? ''}
			oninput={(e) => setUrl(e.currentTarget.value)}
			disabled={readOnly}
		/>
	{/if}
</div>
