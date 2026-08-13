<script lang="ts">
	/**
	 * Interactive editor for `blocks` and `array` fields — add, remove, and
	 * reorder rows; each row renders real inputs for its sub-fields. State is
	 * serialized to a single hidden input as JSON, so it submits like any
	 * other field through form actions.
	 */
	import RelationPicker from './RelationPicker.svelte';
	import type { ClientBlock, ClientField } from './client';
	import type { RelOption } from './server';

	type Row = Record<string, unknown>;

	let {
		field,
		value = undefined,
		relOptions = {},
		mediaAspects = []
	}: {
		field: ClientField;
		value?: unknown;
		relOptions?: Record<string, RelOption[]>;
		/** Aspect registry, forwarded to upload sub-fields' edit modal. */
		mediaAspects?: { name: string; ratio: string; contexts?: string[] }[];
	} = $props();

	// `array` fields behave like a blocks field with a single implicit block type.
	const isArray = $derived(field.type === 'array');
	const blockTypes: ClientBlock[] = $derived(
		field.type === 'array'
			? [{ slug: '_row', label: 'Row', fields: field.fields ?? [] }]
			: (field.blocks ?? [])
	);

	function initialRows(): Row[] {
		if (!Array.isArray(value)) return [];
		return (value as Row[]).map((r) => ({ ...r }));
	}

	let rows = $state<Row[]>(initialRows());

	const serialized = $derived(
		JSON.stringify(isArray ? rows.map(({ blockType: _b, ...rest }) => rest) : rows)
	);

	function blockFor(row: Row): ClientBlock | undefined {
		if (isArray) return blockTypes[0];
		return blockTypes.find((b) => b.slug === row.blockType);
	}

	function addRow(block: ClientBlock) {
		const row: Row = isArray ? {} : { blockType: block.slug };
		for (const f of block.fields) {
			if (f.defaultValue !== undefined) row[f.name] = f.defaultValue;
			else if (f.type === 'checkbox') row[f.name] = false;
		}
		rows.push(row);
	}
	function removeRow(i: number) {
		rows.splice(i, 1);
	}
	function move(i: number, dir: -1 | 1) {
		const j = i + dir;
		if (j < 0 || j >= rows.length) return;
		[rows[i], rows[j]] = [rows[j], rows[i]];
	}

	function relId(v: unknown): string {
		if (v && typeof v === 'object' && 'id' in (v as Row)) return String((v as Row).id);
		return String(v ?? '');
	}
	function asDateInput(v: unknown): string {
		const s = String(v ?? '');
		if (!s) return '';
		const d = new Date(s);
		return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
	}

	const inputClass =
		'w-full rounded-(--radius) border border-(--color-border) bg-(--color-bg) px-2.5 py-1.5 text-sm text-(--color-fg) placeholder-(--color-muted) focus:border-(--color-primary) focus:outline-none';
	const atMax = $derived(field.maxRows !== undefined && rows.length >= field.maxRows);
</script>

<div class="space-y-1.5">
	<span class="block text-xs font-medium tracking-wide text-(--color-muted) uppercase">
		{field.label}
		{#if field.required}<span class="text-(--color-primary)">*</span>{/if}
	</span>

	<input type="hidden" name={field.name} value={serialized} />

	<div class="space-y-2">
		{#each rows as row, i (i)}
			{@const block = blockFor(row)}
			<div class="rounded-(--radius) border border-(--color-border) bg-(--color-elevate)">
				<div class="flex items-center justify-between border-b border-(--color-border) px-3 py-1.5">
					<span class="text-xs font-semibold tracking-wide text-(--color-primary) uppercase">
						{block?.label ?? String(row.blockType ?? 'Row')}
						<span class="ml-1 font-normal text-(--color-muted)">#{i + 1}</span>
					</span>
					<span class="flex items-center gap-1">
						<button type="button" class="rounded px-1.5 py-0.5 text-xs text-(--color-muted) hover:bg-(--color-elevate-2) hover:text-(--color-fg) disabled:opacity-30" disabled={i === 0} onclick={() => move(i, -1)} title="Move up">↑</button>
						<button type="button" class="rounded px-1.5 py-0.5 text-xs text-(--color-muted) hover:bg-(--color-elevate-2) hover:text-(--color-fg) disabled:opacity-30" disabled={i === rows.length - 1} onclick={() => move(i, 1)} title="Move down">↓</button>
						<button type="button" class="rounded px-1.5 py-0.5 text-xs text-(--color-muted) hover:bg-(--color-elevate-2) hover:text-(--color-danger)" onclick={() => removeRow(i)} title="Remove">✕</button>
					</span>
				</div>
				<div class="space-y-3 p-3">
					{#if block}
						{#each block.fields as sub (sub.name)}
							<div class="space-y-1">
								<label class="block text-[11px] font-medium text-(--color-muted)" for="{field.name}-{i}-{sub.name}">
									{sub.label}{#if sub.required}<span class="text-(--color-primary)"> *</span>{/if}
								</label>
								{#if sub.type === 'textarea' || sub.type === 'richText'}
									<textarea id="{field.name}-{i}-{sub.name}" rows={sub.type === 'richText' ? 5 : 3} class={inputClass} bind:value={rows[i][sub.name] as string}></textarea>
								{:else if sub.type === 'number'}
									<input id="{field.name}-{i}-{sub.name}" type="number" step="any" class={inputClass} bind:value={rows[i][sub.name] as number} />
								{:else if sub.type === 'checkbox'}
									<input id="{field.name}-{i}-{sub.name}" type="checkbox" class="h-4 w-4 accent-(--color-primary)" bind:checked={rows[i][sub.name] as boolean} />
								{:else if sub.type === 'date'}
									<input
										id="{field.name}-{i}-{sub.name}"
										type="date"
										class={inputClass}
										value={asDateInput(rows[i][sub.name])}
										onchange={(e) => (rows[i][sub.name] = e.currentTarget.value || null)}
									/>
								{:else if sub.type === 'select'}
									<select id="{field.name}-{i}-{sub.name}" class={inputClass} bind:value={rows[i][sub.name] as string}>
										{#if !sub.required}<option value="">—</option>{/if}
										{#each sub.options ?? [] as opt (opt.value)}
											<option value={opt.value}>{opt.label}</option>
										{/each}
									</select>
								{:else if sub.type === 'relationship' || sub.type === 'upload'}
									<RelationPicker
										name="_blk_{sub.name}"
										options={relOptions[sub.relationTo ?? ''] ?? []}
										value={rows[i][sub.name]}
										hasMany={sub.hasMany}
										relationTo={sub.relationTo ?? ''}
										searchUrl={sub.relationTo ? `/api/${sub.relationTo}/options` : ''}
										uploadUrl={sub.type === 'upload' && sub.relationTo ? `/api/${sub.relationTo}` : ''}
										submitHidden={false}
										onChange={(ids) => (rows[i][sub.name] = sub.hasMany ? ids : (ids[0] ?? null))}
										editable={sub.type === 'upload'}
										{mediaAspects}
									/>
								{:else if sub.type === 'array' || sub.type === 'blocks' || sub.type === 'json'}
									<textarea
										id="{field.name}-{i}-{sub.name}"
										rows="4"
										class="{inputClass} font-mono text-xs"
										value={typeof rows[i][sub.name] === 'string'
											? (rows[i][sub.name] as string)
											: JSON.stringify(rows[i][sub.name] ?? (sub.type === 'json' ? {} : []), null, 1)}
										onchange={(e) => {
											try {
												rows[i][sub.name] = JSON.parse(e.currentTarget.value);
											} catch {
												rows[i][sub.name] = e.currentTarget.value;
											}
										}}
									></textarea>
								{:else}
									<input id="{field.name}-{i}-{sub.name}" type={sub.type === 'email' ? 'email' : 'text'} class={inputClass} bind:value={rows[i][sub.name] as string} />
								{/if}
							</div>
						{/each}
					{/if}
				</div>
			</div>
		{:else}
			<p class="rounded-(--radius) border border-dashed border-(--color-border) px-3 py-4 text-center text-xs text-(--color-muted)">
				No {isArray ? 'rows' : 'blocks'} yet
			</p>
		{/each}
	</div>

	<div class="flex flex-wrap gap-2 pt-1">
		{#each blockTypes as block (block.slug)}
			<button
				type="button"
				class="rounded-(--radius) border border-(--color-border) px-3 py-1.5 text-xs text-(--color-muted) hover:border-(--color-primary) hover:text-(--color-primary) disabled:opacity-40"
				disabled={atMax}
				onclick={() => addRow(block)}
			>
				+ {isArray ? 'Add row' : block.label}
			</button>
		{/each}
	</div>

	{#if field.admin.description}
		<p class="text-xs text-(--color-muted)">{field.admin.description}</p>
	{/if}
</div>
