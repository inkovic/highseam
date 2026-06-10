<script lang="ts">
	import { enhance } from '$app/forms';
	import BlocksInput from './BlocksInput.svelte';
	import FieldInput from './FieldInput.svelte';
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
		draftLabel = 'Save draft'
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
	} = $props();

	const visibleFields = $derived(collection.fields.filter((f) => !f.admin.hidden));
	const inputClass =
		'w-full rounded-(--radius) border border-(--color-border) bg-(--color-elevate) px-3 py-2 text-sm focus:border-(--color-primary) focus:outline-none';
	const isEdit = $derived(Boolean(values.id));
</script>

<form method="POST" {action} use:enhance class="max-w-2xl space-y-5">
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

	{#each visibleFields as field (field.name)}
		{#if field.type === 'blocks' || field.type === 'array'}
			<BlocksInput {field} value={values[field.name]} {relOptions} />
			{#if errors[field.name]}<p class="text-xs text-(--color-danger)">{errors[field.name]}</p>{/if}
		{:else}
			<FieldInput {field} value={values[field.name]} {relOptions} error={errors[field.name]} />
		{/if}
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
	</div>
</form>
