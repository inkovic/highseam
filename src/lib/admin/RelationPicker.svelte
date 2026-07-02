<script lang="ts">
	/**
	 * Searchable reference picker for relationship / upload fields (single or
	 * hasMany). Replaces the raw <select multiple> — you filter by title and
	 * click to add; selected items show as removable chips. Submits via hidden
	 * inputs named after the field, so form actions see the same values as a
	 * native select. Works for any target collection, including table-backed
	 * (8k rows) since it filters the already-loaded option list client-side.
	 */
	import type { RelOption } from './server';

	let {
		name,
		options,
		value = undefined,
		hasMany = false,
		required = false,
		relationTo = '',
		readOnly = false
	}: {
		name: string;
		options: RelOption[];
		value?: unknown;
		hasMany?: boolean;
		required?: boolean;
		relationTo?: string;
		readOnly?: boolean;
	} = $props();

	function idOf(v: unknown): string {
		if (v && typeof v === 'object' && 'id' in (v as RelOption)) return String((v as RelOption).id);
		return String(v ?? '');
	}
	function initial(): string[] {
		if (value == null || value === '') return [];
		return (Array.isArray(value) ? value : [value]).map(idOf).filter(Boolean);
	}

	// svelte-ignore state_referenced_locally — seed once from the prop
	let selectedIds = $state<string[]>(initial());
	let query = $state('');
	let open = $state(false);

	const byId = $derived(new Map(options.map((o) => [o.id, o])));
	const selectedOptions = $derived(selectedIds.map((id) => byId.get(id) ?? { id, title: id }));
	const matches = $derived(
		options
			.filter((o) => !selectedIds.includes(o.id))
			.filter((o) => o.title.toLowerCase().includes(query.toLowerCase()))
			.slice(0, 50)
	);

	function add(id: string) {
		if (readOnly) return;
		if (hasMany) selectedIds = [...selectedIds, id];
		else selectedIds = [id];
		query = '';
		open = hasMany;
	}
	function remove(id: string) {
		if (readOnly) return;
		selectedIds = selectedIds.filter((x) => x !== id);
	}

	const inputClass =
		'w-full rounded-(--radius) border border-(--color-border) bg-(--color-elevate) px-3 py-2 text-sm text-(--color-fg) placeholder-(--color-muted) focus:border-(--color-primary) focus:outline-none disabled:opacity-50';
</script>

<div class="relative">
	<!-- hidden inputs carry the submitted value(s) -->
	{#if selectedIds.length === 0}
		<input type="hidden" {name} value="" />
	{:else}
		{#each selectedIds as id (id)}<input type="hidden" {name} value={id} />{/each}
	{/if}

	{#if selectedOptions.length > 0}
		<div class="mb-1.5 flex flex-wrap gap-1.5">
			{#each selectedOptions as opt (opt.id)}
				<span class="inline-flex items-center gap-1.5 rounded-full border border-(--color-border) bg-(--color-elevate-2) py-1 pr-1.5 pl-2.5 text-xs">
					{#if opt.url && opt.mimeType?.startsWith('image/')}
						<img src={opt.url} alt="" class="h-4 w-4 rounded object-cover" />
					{/if}
					{opt.title}
					{#if !readOnly}
						<button type="button" onclick={() => remove(opt.id)} class="text-(--color-muted) hover:text-(--color-danger)" aria-label="Remove">✕</button>
					{/if}
				</span>
			{/each}
		</div>
	{/if}

	{#if !readOnly && (hasMany || selectedIds.length === 0)}
		<input
			type="text"
			class={inputClass}
			placeholder="Search {relationTo || 'options'}…"
			bind:value={query}
			onfocus={() => (open = true)}
			onblur={() => setTimeout(() => (open = false), 150)}
			oninput={() => (open = true)}
		/>
		{#if open && matches.length > 0}
			<ul class="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-(--radius) border border-(--color-border) bg-(--color-elevate) py-1 shadow-lg">
				{#each matches as opt (opt.id)}
					<li>
						<button
							type="button"
							onclick={() => add(opt.id)}
							class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-(--color-elevate-2)"
						>
							{#if opt.url && opt.mimeType?.startsWith('image/')}
								<img src={opt.url} alt="" class="h-5 w-5 rounded object-cover" />
							{/if}
							{opt.title}
						</button>
					</li>
				{/each}
			</ul>
		{:else if open && query}
			<div class="absolute z-20 mt-1 w-full rounded-(--radius) border border-(--color-border) bg-(--color-elevate) px-3 py-2 text-xs text-(--color-muted)">
				No matches
			</div>
		{/if}
	{/if}

	{#if required && selectedIds.length === 0}
		<p class="mt-1 text-[11px] text-(--color-muted)">Required</p>
	{/if}
	<p class="mt-1 text-xs text-(--color-muted)">→ {relationTo}{hasMany ? ' (multiple)' : ''}</p>
</div>
