<script lang="ts">
	/**
	 * In-context media editing: the media doc's edit surface — focal point,
	 * aspect previews, metadata — in a modal over whatever doc you're editing.
	 * Openable from any image chip (upload fields, rich-text upload nodes), so
	 * setting a hotspot on a just-placed image no longer costs a full-page
	 * round trip away from a dirty form.
	 *
	 * One editing surface, not a second, lesser form: fields come from the
	 * collection's own schema (?schema=1 on the options endpoint), rendered
	 * with the same FieldInput used by the full page. Saves PATCH through the
	 * public API, so access control, hooks, and validation all apply. The host
	 * form is untouched — closing returns to it exactly as you left it.
	 *
	 * Not a <form>: this component renders inside the host page's form, and
	 * forms don't nest. Values are collected from the rendered inputs and
	 * coerced by declared field type instead. Two isolations keep the host
	 * honest: input names are namespaced (`__hs_media_*`) so a host save never
	 * picks them up (e.g. both venue and media declaring `tags`), and
	 * input/change events stop at the modal boundary so the host's dirty
	 * tracking never fires from modal typing.
	 */
	import FieldInput from './FieldInput.svelte';
	import FocalPicker from './FocalPicker.svelte';
	import type { ClientField } from './client';

	let {
		open = $bindable(false),
		id,
		relationTo,
		aspects = [],
		onSaved = undefined,
		onclose = undefined
	}: {
		open?: boolean;
		/** Media document id. */
		id: string;
		/** Upload collection slug. */
		relationTo: string;
		/** Aspect registry (cms.config → media.aspects) for the preview strips. */
		aspects?: { name: string; ratio: string; contexts?: string[] }[];
		/** Called with the updated doc after a successful save. */
		onSaved?: (doc: Record<string, unknown>) => void;
		/** Called whenever the modal closes (for parents driving `open` by id). */
		onclose?: () => void;
	} = $props();

	let doc = $state<Record<string, unknown> | null>(null);
	let schema = $state<ClientField[]>([]);
	let loading = $state(false);
	let saving = $state(false);
	let errorMsg = $state('');
	let fieldErrors = $state<Record<string, string>>({});
	let lightbox = $state(false);
	let bodyEl: HTMLDivElement | undefined = $state();

	function close() {
		open = false;
		onclose?.();
	}

	// The crop-preview strips only want 'preview'-context aspects.
	const previewAspects = $derived(
		aspects.filter((a) => !a.contexts || a.contexts.includes('preview'))
	);

	// Editable = simple declared fields. Managed upload fields (url, mimeType,
	// filesize) aren't in the schema; hidden/readOnly (provenance) stay out;
	// focalPoint's UI is the FocalPicker, not a JSON textarea.
	const SIMPLE = new Set(['text', 'textarea', 'email', 'number', 'date', 'select', 'checkbox', 'json', 'array']);
	const editableFields = $derived(
		schema.filter(
			(f) => SIMPLE.has(f.type) && !f.admin?.hidden && !f.admin?.readOnly && f.name !== 'focalPoint'
		)
	);
	const hasFocal = $derived(schema.some((f) => f.name === 'focalPoint'));
	const isImage = $derived(String(doc?.mimeType ?? '').startsWith('image/'));

	/** Namespace prefix — modal inputs must never collide with host fields. */
	const NS = '__hs_media_';

	$effect(() => {
		if (!open || !id) return;
		loading = true;
		errorMsg = '';
		fieldErrors = {};
		doc = null;
		Promise.all([
			fetch(`/api/${relationTo}/${id}`).then((r) => (r.ok ? r.json() : Promise.reject(r.status))),
			fetch(`/api/${relationTo}/options?schema=1`).then((r) => (r.ok ? r.json() : { fields: [] }))
		])
			.then(([d, s]) => {
				doc = d as Record<string, unknown>;
				schema = (s as { fields?: ClientField[] }).fields ?? [];
			})
			.catch((e) => (errorMsg = `Could not load media document (${e})`))
			.finally(() => (loading = false));
	});

	/** Collect values from the rendered inputs, coerced by field type. */
	function collect(): Record<string, unknown> | null {
		if (!bodyEl) return null;
		const out: Record<string, unknown> = {};
		fieldErrors = {};
		for (const f of editableFields) {
			const els = bodyEl.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
				`[name="${NS}${f.name}"]`
			);
			if (!els.length) continue;
			const checkbox = [...els].find((e) => (e as HTMLInputElement).type === 'checkbox');
			if (f.type === 'checkbox') {
				out[f.name] = checkbox ? (checkbox as HTMLInputElement).checked : els[els.length - 1].value === 'true';
				continue;
			}
			const el = els[els.length - 1];
			const raw = el.value;
			if (f.type === 'number') out[f.name] = raw === '' ? null : Number(raw);
			else if (f.type === 'date') out[f.name] = raw || null;
			else if (f.type === 'json' || f.type === 'array') {
				if (!raw.trim()) out[f.name] = null;
				else {
					try {
						out[f.name] = JSON.parse(raw);
					} catch {
						fieldErrors = { ...fieldErrors, [f.name]: 'Invalid JSON' };
					}
				}
			} else if (el instanceof HTMLSelectElement && el.multiple) {
				out[f.name] = [...el.selectedOptions].map((o) => o.value);
			} else out[f.name] = raw;
		}
		// FocalPicker's hidden input — '' means cleared.
		const focalEl = bodyEl.querySelector<HTMLInputElement>(`[name="${NS}focalPoint"]`);
		if (focalEl) out.focalPoint = focalEl.value ? JSON.parse(focalEl.value) : null;
		return Object.keys(fieldErrors).length ? null : out;
	}

	async function save() {
		const data = collect();
		if (!data) return;
		saving = true;
		errorMsg = '';
		try {
			const res = await fetch(`/api/${relationTo}/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(data)
			});
			const payload = (await res.json().catch(() => ({}))) as {
				doc?: Record<string, unknown>;
				message?: string;
				errors?: Record<string, string>;
			};
			if (!res.ok) {
				fieldErrors = payload.errors ?? {};
				errorMsg = payload.message ?? `Save failed (${res.status})`;
				return;
			}
			if (payload.doc) onSaved?.(payload.doc);
			close();
		} catch {
			errorMsg = 'Save failed — network error';
		} finally {
			saving = false;
		}
	}

	function onKeydown(e: KeyboardEvent) {
		if (!open) return;
		if (e.key === 'Escape') {
			if (lightbox) lightbox = false;
			else close();
			e.stopPropagation();
		} else if ((e.metaKey || e.ctrlKey) && e.key === 's') {
			// Save the modal, not the host doc.
			e.preventDefault();
			e.stopPropagation();
			save();
		}
	}

	const btn =
		'rounded-(--radius) border border-(--color-border) px-3 py-1.5 text-xs text-(--color-muted) hover:border-(--color-primary) hover:text-(--color-primary)';
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-[210] flex items-center justify-center bg-black/60 p-4" onclick={close}>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-(--color-border) bg-(--color-bg) shadow-2xl"
			onclick={(e) => e.stopPropagation()}
			oninput={(e) => e.stopPropagation()}
			onchange={(e) => e.stopPropagation()}
			role="dialog"
			tabindex="-1"
			aria-label="Edit media"
			aria-modal="true"
			data-hs-media-edit-modal
		>
			<div class="flex items-center gap-2 border-b border-(--color-border) px-4 py-3">
				<h2 class="truncate text-sm font-semibold">
					{String(doc?.filename ?? 'Edit media')}
				</h2>
				<a
					href="/admin/{relationTo}/{id}"
					class="text-[11px] text-(--color-muted) hover:text-(--color-primary)"
					title="Open the full media document page (leaves this doc)"
				>
					full page ↗
				</a>
				<button type="button" class="{btn} ml-auto" onclick={close}>Close</button>
			</div>

			<div class="flex-1 space-y-4 overflow-y-auto p-4" bind:this={bodyEl}>
				{#if loading}
					<p class="py-10 text-center text-sm text-(--color-muted)">Loading…</p>
				{:else if !doc}
					<p class="py-10 text-center text-sm text-(--color-danger)">{errorMsg || 'Not found'}</p>
				{:else}
					{#if isImage && hasFocal}
						<FocalPicker
							url={String(doc.url)}
							alt={String(doc.filename ?? 'upload')}
							value={doc.focalPoint}
							aspects={previewAspects}
							name="{NS}focalPoint"
						/>
						<button type="button" class="text-[11px] text-(--color-muted) hover:text-(--color-primary)" onclick={() => (lightbox = true)}>
							⤢ View full size
						</button>
					{:else if isImage}
						<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
						<img
							src={String(doc.url)}
							alt={String(doc.filename ?? '')}
							class="max-h-64 cursor-zoom-in rounded-(--radius) border border-(--color-border)"
							onclick={() => (lightbox = true)}
						/>
					{/if}

					{#each editableFields as field (field.name)}
						<FieldInput
							field={{ ...field, name: NS + field.name }}
							value={doc[field.name]}
							error={fieldErrors[field.name]}
						/>
					{/each}

					{#if errorMsg}
						<p class="text-sm text-(--color-danger)">{errorMsg}</p>
					{/if}
				{/if}
			</div>

			<div class="flex items-center gap-2 border-t border-(--color-border) px-4 py-3">
				<button
					type="button"
					class="rounded-(--radius) bg-(--color-primary) px-4 py-1.5 text-xs font-semibold text-(--color-primary-fg) hover:opacity-90 disabled:opacity-50"
					disabled={saving || loading || !doc}
					onclick={save}
				>
					{saving ? 'Saving…' : 'Save'}
				</button>
				<span class="text-[11px] text-(--color-muted)">Saves the media document — your open doc is untouched.</span>
			</div>
		</div>
	</div>
{/if}

{#if lightbox && doc}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-[220] flex cursor-zoom-out items-center justify-center bg-black/85 p-6" onclick={() => (lightbox = false)}>
		<img src={String(doc.url)} alt={String(doc.filename ?? '')} class="max-h-full max-w-full object-contain" />
	</div>
{/if}
