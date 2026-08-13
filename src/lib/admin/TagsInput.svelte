<script lang="ts">
	/**
	 * Chips editor for string lists — the `json` fields that are really
	 * `string[]` (tags, slugs, labels) and were being hand-typed as JSON in a
	 * textarea. Type, Enter/comma adds; ✕ or Backspace removes. Serializes as
	 * a JSON array through a hidden input (form mode) or onChange (callback
	 * mode, e.g. inside blocks rows).
	 *
	 * Opt in per field with `admin: { editor: 'tags' }` — a `json` field can
	 * hold anything, so the schema stays honest and the editor is a hint.
	 */
	let {
		name,
		value = undefined,
		submitHidden = true,
		onChange = undefined,
		placeholder = 'Add and press Enter…',
		readOnly = false
	}: {
		name: string;
		value?: unknown;
		submitHidden?: boolean;
		onChange?: (items: string[]) => void;
		placeholder?: string;
		readOnly?: boolean;
	} = $props();

	function initial(): string[] {
		if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean);
		// Upgrade path: a JSON string (the old textarea's output) still parses.
		if (typeof value === 'string' && value.trim().startsWith('[')) {
			try {
				const arr = JSON.parse(value);
				if (Array.isArray(arr)) return arr.map((v) => String(v)).filter(Boolean);
			} catch {
				/* fall through */
			}
		}
		return [];
	}

	// svelte-ignore state_referenced_locally — seed once from the prop
	let items = $state<string[]>(initial());
	let draft = $state('');
	let hiddenInput: HTMLInputElement | undefined = $state();

	const serialized = $derived(JSON.stringify(items));

	function notify() {
		onChange?.([...items]);
		// Chip add/remove via keyboard commit or ✕ click isn't a native input
		// event on a form field — tell the host form (dirty tracking, autosave).
		queueMicrotask(() => hiddenInput?.dispatchEvent(new Event('input', { bubbles: true })));
	}

	function commit() {
		const v = draft.trim().replace(/,+$/, '');
		if (!v) return;
		if (!items.includes(v)) {
			items.push(v);
			notify();
		}
		draft = '';
	}
	function remove(i: number) {
		if (readOnly) return;
		items.splice(i, 1);
		notify();
	}
	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ',') {
			e.preventDefault();
			commit();
		} else if (e.key === 'Backspace' && draft === '' && items.length > 0) {
			e.preventDefault();
			remove(items.length - 1);
		}
	}
</script>

<div
	class="flex min-h-9 flex-wrap items-center gap-1.5 rounded-(--radius) border border-(--color-border) bg-(--color-elevate) px-2 py-1.5 focus-within:border-(--color-primary)"
	data-hs-tags-input
>
	{#if submitHidden}
		<input type="hidden" {name} value={serialized} bind:this={hiddenInput} />
	{/if}
	{#each items as item, i (item)}
		<span class="inline-flex items-center gap-1 rounded-full border border-(--color-border) bg-(--color-elevate-2) py-0.5 pr-1 pl-2 text-xs text-(--color-fg)">
			{item}
			{#if !readOnly}
				<button
					type="button"
					class="rounded-full px-1 text-(--color-muted) hover:text-(--color-danger)"
					onclick={() => remove(i)}
					aria-label="Remove {item}"
				>
					✕
				</button>
			{/if}
		</span>
	{/each}
	{#if !readOnly}
		<input
			type="text"
			class="min-w-24 flex-1 bg-transparent text-sm text-(--color-fg) placeholder-(--color-muted) focus:outline-none"
			{placeholder}
			bind:value={draft}
			onkeydown={onKeydown}
			onblur={commit}
		/>
	{/if}
</div>
