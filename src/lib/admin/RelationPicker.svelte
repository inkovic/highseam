<script lang="ts">
	/**
	 * Searchable reference picker for relationship / upload fields (single or
	 * hasMany). Type to filter, click to add; selected items show as removable
	 * chips. Submits via hidden inputs named after the field.
	 *
	 * Two data modes:
	 *  - preloaded `options` (small targets): filtered client-side, instant.
	 *  - `searchUrl` (large targets, e.g. 8k rows): debounced fetch of matches
	 *    from /api/<collection>/options?q=…, and selected ids whose titles
	 *    aren't preloaded are resolved via ?ids=… so chips still read nicely.
	 */
	import type { RelOption } from './server';

	let {
		name,
		options,
		value = undefined,
		hasMany = false,
		required = false,
		relationTo = '',
		readOnly = false,
		searchUrl = '',
		uploadUrl = '',
		submitHidden = true,
		onChange = undefined
	}: {
		name: string;
		options: RelOption[];
		value?: unknown;
		hasMany?: boolean;
		required?: boolean;
		relationTo?: string;
		readOnly?: boolean;
		searchUrl?: string;
		/**
		 * Upload collection endpoint (`/api/<slug>`). When set, the field
		 * accepts a file directly — choose or drop — creating the document and
		 * selecting it, instead of making you leave and use the collection.
		 */
		uploadUrl?: string;
		/** Render hidden <input>s for native form submission. */
		submitHidden?: boolean;
		/** Callback mode (e.g. inside the rich-text editor, which serializes
		 *  to JSON): receives the selected id(s) on change. */
		onChange?: (ids: string[]) => void;
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
	// Titles discovered via search / id-resolution, merged over preloaded options.
	let extra = $state<Map<string, RelOption>>(new Map());
	let remoteMatches = $state<RelOption[]>([]);
	let loading = $state(false);

	const byId = $derived(
		new Map<string, RelOption>([...options.map((o) => [o.id, o] as const), ...extra])
	);
	const selectedOptions = $derived(selectedIds.map((id) => byId.get(id) ?? { id, title: id }));

	const localMatches = $derived(
		options
			.filter((o) => !selectedIds.includes(o.id))
			.filter((o) => o.title.toLowerCase().includes(query.toLowerCase()))
	);
	const matches = $derived(
		(searchUrl && query
			? remoteMatches.filter((o) => !selectedIds.includes(o.id))
			: localMatches
		).slice(0, 50)
	);

	// Resolve titles for any selected ids not present in preloaded options.
	$effect(() => {
		if (!searchUrl) return;
		const missing = selectedIds.filter((id) => !byId.has(id));
		if (missing.length === 0) return;
		fetch(`${searchUrl}?ids=${encodeURIComponent(missing.join(','))}`)
			.then((r) => (r.ok ? r.json() : { options: [] }))
			.then((d: { options: RelOption[] }) => {
				const m = new Map(extra);
				for (const o of d.options) m.set(o.id, o);
				extra = m;
			})
			.catch(() => {});
	});

	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	function onQuery() {
		open = true;
		if (!searchUrl) return;
		clearTimeout(searchTimer);
		const q = query;
		if (!q) {
			remoteMatches = [];
			return;
		}
		loading = true;
		searchTimer = setTimeout(async () => {
			try {
				const r = await fetch(`${searchUrl}?q=${encodeURIComponent(q)}`);
				const d = (await r.json()) as { options: RelOption[] };
				remoteMatches = d.options ?? [];
			} catch {
				remoteMatches = [];
			} finally {
				loading = false;
			}
		}, 250);
	}

	// --- inline upload -----------------------------------------------------------
	// Reuses the collection's own create endpoint: POST multipart {file} to
	// /api/<slug>. No bespoke upload route, so access control, mime/size limits
	// and hooks all apply exactly as they do for a normal create.

	let uploading = $state(false);
	let uploadError = $state('');
	let dragOver = $state(false);

	async function uploadFiles(files: FileList | File[]) {
		if (!uploadUrl || readOnly) return;
		const list = Array.from(files).slice(0, hasMany ? 20 : 1);
		if (list.length === 0) return;
		uploading = true;
		uploadError = '';
		try {
			for (const file of list) {
				const body = new FormData();
				body.append('file', file);
				const res = await fetch(uploadUrl, { method: 'POST', body });
				const payload = (await res.json().catch(() => ({}))) as {
					doc?: RelOption & { filename?: string };
					message?: string;
				};
				if (!res.ok || !payload.doc) {
					uploadError = payload.message ?? `Upload failed (${res.status})`;
					break;
				}
				const doc = payload.doc;
				const opt: RelOption = {
					id: doc.id,
					title: String(doc.title ?? doc.filename ?? doc.id),
					url: doc.url,
					mimeType: doc.mimeType
				};
				extra = new Map(extra).set(opt.id, opt);
				selectedIds = hasMany ? [...selectedIds, opt.id] : [opt.id];
			}
			onChange?.(selectedIds);
		} catch {
			uploadError = 'Upload failed';
		} finally {
			uploading = false;
		}
	}

	function onDrop(e: DragEvent) {
		dragOver = false;
		const files = e.dataTransfer?.files;
		if (uploadUrl && files && files.length) {
			e.preventDefault();
			uploadFiles(files);
		}
	}

	function add(id: string) {
		if (readOnly) return;
		if (hasMany) selectedIds = [...selectedIds, id];
		else selectedIds = [id];
		query = '';
		remoteMatches = [];
		open = hasMany;
		onChange?.(selectedIds);
	}
	function remove(id: string) {
		if (readOnly) return;
		selectedIds = selectedIds.filter((x) => x !== id);
		onChange?.(selectedIds);
	}

	const inputClass =
		'w-full rounded-(--radius) border border-(--color-border) bg-(--color-elevate) px-3 py-2 text-sm text-(--color-fg) placeholder-(--color-muted) focus:border-(--color-primary) focus:outline-none disabled:opacity-50';
</script>

<div class="relative">
	{#if submitHidden}
		{#if selectedIds.length === 0}
			<input type="hidden" {name} value="" />
		{:else}
			{#each selectedIds as id (id)}<input type="hidden" {name} value={id} />{/each}
		{/if}
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
			oninput={onQuery}
		/>
		{#if open && (matches.length > 0 || loading)}
			<ul class="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-(--radius) border border-(--color-border) bg-(--color-elevate) py-1 shadow-lg">
				{#if loading}
					<li class="px-3 py-1.5 text-xs text-(--color-muted)">Searching…</li>
				{/if}
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
		{:else if open && query && !loading}
			<div class="absolute z-20 mt-1 w-full rounded-(--radius) border border-(--color-border) bg-(--color-elevate) px-3 py-2 text-xs text-(--color-muted)">
				No matches
			</div>
		{/if}
	{/if}

	{#if uploadUrl && !readOnly}
		<!-- Choose or drop a file right here; it becomes a document in the
		     upload collection and is selected immediately. -->
		<label
			class="mt-1.5 flex cursor-pointer items-center justify-center gap-2 rounded-(--radius) border border-dashed px-3 py-2 text-xs transition-colors {dragOver
				? 'border-(--color-primary) bg-(--color-primary)/10 text-(--color-primary)'
				: 'border-(--color-border) text-(--color-muted) hover:border-(--color-primary) hover:text-(--color-primary)'}"
			ondragover={(e) => {
				e.preventDefault();
				dragOver = true;
			}}
			ondragleave={() => (dragOver = false)}
			ondrop={onDrop}
		>
			{#if uploading}
				<span class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"></span>
				Uploading…
			{:else}
				<span>⬆ Upload{hasMany ? ' files' : ' a file'} — or drop {hasMany ? 'them' : 'it'} here</span>
			{/if}
			<input
				type="file"
				class="hidden"
				multiple={hasMany}
				disabled={uploading}
				onchange={(e) => {
					const f = e.currentTarget.files;
					if (f) uploadFiles(f);
					e.currentTarget.value = '';
				}}
			/>
		</label>
		{#if uploadError}
			<p class="mt-1 text-[11px] text-(--color-danger)">{uploadError}</p>
		{/if}
	{/if}

	{#if required && selectedIds.length === 0}
		<p class="mt-1 text-[11px] text-(--color-muted)">Required</p>
	{/if}
	<p class="mt-1 text-xs text-(--color-muted)">→ {relationTo}{hasMany ? ' (multiple)' : ''}</p>
</div>
