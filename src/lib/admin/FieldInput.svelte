<script lang="ts">
	import type { ClientField } from './client';

	interface RelOption {
		id: string;
		title: string;
	}

	let {
		field,
		value = undefined,
		relOptions = {},
		error = undefined
	}: {
		field: ClientField;
		value?: unknown;
		relOptions?: Record<string, RelOption[]>;
		error?: string;
	} = $props();

	const inputClass =
		'w-full rounded-(--radius) border border-(--color-border) bg-(--color-elevate) px-3 py-2 text-sm text-(--color-fg) placeholder-(--color-muted) focus:border-(--color-primary) focus:outline-none disabled:opacity-50';

	function asString(v: unknown): string {
		if (v === null || v === undefined) return '';
		return String(v);
	}
	function asJSON(v: unknown): string {
		if (v === null || v === undefined || v === '') return '';
		if (typeof v === 'string') return v;
		return JSON.stringify(v, null, 2);
	}
	function asDateInput(v: unknown): string {
		const s = asString(v);
		if (!s) return '';
		const d = new Date(s);
		if (Number.isNaN(d.getTime())) return '';
		return d.toISOString().slice(0, 10);
	}
	function isSelected(v: unknown, optionValue: string): boolean {
		if (Array.isArray(v)) return v.some((x) => relId(x) === optionValue || x === optionValue);
		return relId(v) === optionValue || v === optionValue;
	}
	/** A populated relationship arrives as a doc; an unpopulated one as an id. */
	function relId(v: unknown): string {
		if (v && typeof v === 'object' && 'id' in (v as Record<string, unknown>))
			return String((v as Record<string, unknown>).id);
		return String(v ?? '');
	}
</script>

<div class="space-y-1.5">
	<label class="block text-xs font-medium tracking-wide text-(--color-muted) uppercase" for={field.name}>
		{field.label}
		{#if field.required}<span class="text-(--color-primary)">*</span>{/if}
	</label>

	{#if field.type === 'text' || field.type === 'email'}
		<input
			id={field.name}
			name={field.name}
			type={field.type === 'email' ? 'email' : 'text'}
			class={inputClass}
			value={asString(value)}
			placeholder={field.admin.placeholder}
			readonly={field.admin.readOnly}
			disabled={field.admin.readOnly}
		/>
	{:else if field.type === 'textarea'}
		<textarea
			id={field.name}
			name={field.name}
			rows="4"
			class={inputClass}
			placeholder={field.admin.placeholder}
			readonly={field.admin.readOnly}>{asString(value)}</textarea>
	{:else if field.type === 'richText'}
		<textarea
			id={field.name}
			name={field.name}
			rows="10"
			class="{inputClass} font-mono"
			placeholder={field.admin.placeholder ?? 'Markdown supported…'}
			readonly={field.admin.readOnly}>{asString(value)}</textarea>
		<p class="text-xs text-(--color-muted)">Rich text (markdown-backed)</p>
	{:else if field.type === 'number'}
		<input
			id={field.name}
			name={field.name}
			type="number"
			class={inputClass}
			value={asString(value)}
			min={field.min}
			max={field.max}
			step="any"
			readonly={field.admin.readOnly}
		/>
	{:else if field.type === 'checkbox'}
		<div class="flex items-center gap-2 pt-1">
			<input type="hidden" name={field.name} value="false" />
			<input
				id={field.name}
				name={field.name}
				type="checkbox"
				value="true"
				checked={value === true || value === 'true'}
				disabled={field.admin.readOnly}
				class="h-4 w-4 accent-(--color-primary)"
			/>
			<span class="text-sm text-(--color-muted)">{field.admin.description ?? 'Enabled'}</span>
		</div>
	{:else if field.type === 'date'}
		<input
			id={field.name}
			name={field.name}
			type="date"
			class={inputClass}
			value={asDateInput(value)}
			readonly={field.admin.readOnly}
			disabled={field.admin.readOnly}
		/>
	{:else if field.type === 'select'}
		<select
			id={field.name}
			name={field.name}
			multiple={field.hasMany}
			class={inputClass}
			disabled={field.admin.readOnly}
		>
			{#if !field.required && !field.hasMany}
				<option value="">—</option>
			{/if}
			{#each field.options ?? [] as opt (opt.value)}
				<option value={opt.value} selected={isSelected(value, opt.value)}>{opt.label}</option>
			{/each}
		</select>
	{:else if field.type === 'relationship' || field.type === 'upload'}
		<select
			id={field.name}
			name={field.name}
			multiple={field.hasMany}
			class={inputClass}
			disabled={field.admin.readOnly}
		>
			{#if !field.required && !field.hasMany}
				<option value="">—</option>
			{/if}
			{#each relOptions[field.relationTo ?? field.name] ?? [] as opt (opt.id)}
				<option value={opt.id} selected={isSelected(value, opt.id)}>{opt.title}</option>
			{/each}
		</select>
		<p class="text-xs text-(--color-muted)">→ {field.relationTo}</p>
	{:else if field.type === 'array' || field.type === 'json'}
		<textarea
			id={field.name}
			name={field.name}
			rows="6"
			class="{inputClass} font-mono text-xs"
			placeholder={field.type === 'array' ? '[ { ... }, { ... } ]' : '{ ... }'}
			readonly={field.admin.readOnly}>{asJSON(value)}</textarea>
		<p class="text-xs text-(--color-muted)">
			{field.type === 'array' ? `Array of rows — JSON (fields: ${(field.fields ?? []).map((f) => f.name).join(', ')})` : 'JSON'}
		</p>
	{/if}

	{#if field.admin.description && field.type !== 'checkbox' && field.type !== 'array' && field.type !== 'json'}
		<p class="text-xs text-(--color-muted)">{field.admin.description}</p>
	{/if}
	{#if error}
		<p class="text-xs text-(--color-danger)">{error}</p>
	{/if}
</div>
