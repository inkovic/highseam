<script lang="ts">
	/**
	 * Modal media browser — finding an image among thousands rather than
	 * scrolling a preloaded list. Server-backed search/paging (nothing is
	 * loaded until the modal opens), filters, keyboard traversal, and the same
	 * multipart-to-the-collection-endpoint upload path used everywhere else,
	 * so access control, mime/size limits and hooks still apply.
	 */
	import type { RelOption } from './server';

	let {
		open = $bindable(false),
		relationTo,
		optionsUrl,
		uploadUrl = '',
		hasMany = false,
		selectedIds = [],
		onPick
	}: {
		open?: boolean;
		relationTo: string;
		optionsUrl: string;
		uploadUrl?: string;
		hasMany?: boolean;
		selectedIds?: string[];
		onPick: (ids: string[]) => void;
	} = $props();

	let items = $state<RelOption[]>([]);
	let loading = $state(false);
	let q = $state('');
	let mime = $state('');
	let unused = $state(false);
	let sort = $state('-createdAt');
	let page = $state(1);
	let totalDocs = $state(0);
	let totalPages = $state(1);
	let cursor = $state(0);
	let picked = $state<string[]>([]);
	let uploading = $state(false);
	let errorMsg = $state('');
	let dragOver = $state(false);

	const LIMIT = 24;

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			const p = new URLSearchParams({ limit: String(LIMIT), page: String(page), sort });
			if (q) p.set('q', q);
			if (mime) p.set('mime', mime);
			if (unused) p.set('unused', 'true');
			const res = await fetch(`${optionsUrl}?${p}`);
			const data = (await res.json()) as {
				options: RelOption[];
				totalDocs: number;
				totalPages: number;
				message?: string;
			};
			if (!res.ok) {
				errorMsg = data.message ?? `Failed (${res.status})`;
				items = [];
				return;
			}
			items = data.options ?? [];
			totalDocs = data.totalDocs ?? items.length;
			totalPages = data.totalPages ?? 1;
			cursor = 0;
		} catch {
			errorMsg = 'Could not load media';
		} finally {
			loading = false;
		}
	}

	// (Re)load whenever the modal opens or a query input changes.
	let debounce: ReturnType<typeof setTimeout>;
	$effect(() => {
		if (!open) return;
		const deps = [q, mime, unused, sort, page];
		void deps;
		clearTimeout(debounce);
		debounce = setTimeout(load, q ? 250 : 0);
	});
	$effect(() => {
		if (open) picked = [...selectedIds];
	});

	function toggle(id: string) {
		if (hasMany) picked = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
		else picked = [id];
	}
	function confirmPick() {
		onPick(picked);
		open = false;
	}
	function pickOne(id: string) {
		if (hasMany) {
			toggle(id);
		} else {
			onPick([id]);
			open = false;
		}
	}

	async function uploadFiles(files: FileList | File[]) {
		if (!uploadUrl) return;
		const list = Array.from(files).slice(0, hasMany ? 20 : 1);
		if (!list.length) return;
		uploading = true;
		errorMsg = '';
		try {
			const fresh: string[] = [];
			for (const file of list) {
				const body = new FormData();
				body.append('file', file);
				const res = await fetch(uploadUrl, { method: 'POST', body });
				const payload = (await res.json().catch(() => ({}))) as { doc?: RelOption; message?: string };
				if (!res.ok || !payload.doc) {
					errorMsg = payload.message ?? `Upload failed (${res.status})`;
					break;
				}
				fresh.push(payload.doc.id);
			}
			if (fresh.length) {
				picked = hasMany ? [...picked, ...fresh] : [fresh[0]];
				page = 1;
				await load();
				if (!hasMany) {
					onPick(picked);
					open = false;
				}
			}
		} catch {
			errorMsg = 'Upload failed';
		} finally {
			uploading = false;
		}
	}

	function onKeydown(e: KeyboardEvent) {
		if (!open) return;
		if (e.key === 'Escape') {
			open = false;
			return;
		}
		const cols = 4;
		if (e.key === 'ArrowRight') cursor = Math.min(cursor + 1, items.length - 1);
		else if (e.key === 'ArrowLeft') cursor = Math.max(cursor - 1, 0);
		else if (e.key === 'ArrowDown') cursor = Math.min(cursor + cols, items.length - 1);
		else if (e.key === 'ArrowUp') cursor = Math.max(cursor - cols, 0);
		else if (e.key === 'Enter' && items[cursor]) {
			e.preventDefault();
			pickOne(items[cursor].id);
		} else return;
		e.preventDefault();
	}

	const btn =
		'rounded-(--radius) border border-(--color-border) px-2.5 py-1.5 text-xs text-(--color-muted) hover:border-(--color-primary) hover:text-(--color-primary)';
	const inputCls =
		'rounded-(--radius) border border-(--color-border) bg-(--color-elevate-2) px-2.5 py-1.5 text-sm text-(--color-fg) placeholder-(--color-muted) focus:border-(--color-primary) focus:outline-none';
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4" onclick={() => (open = false)}>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-(--color-border) bg-(--color-bg) shadow-2xl"
			onclick={(e) => e.stopPropagation()}
			role="dialog"
			tabindex="-1"
			aria-label="Media library"
			aria-modal="true"
		>
			<!-- toolbar -->
			<div class="flex flex-wrap items-center gap-2 border-b border-(--color-border) p-3">
				<input
					class="{inputCls} min-w-52 flex-1"
					placeholder="Search {relationTo} — filename, alt, caption, tags…"
					bind:value={q}
					oninput={() => (page = 1)}
				/>
				<select class={inputCls} bind:value={mime} onchange={() => (page = 1)}>
					<option value="">All types</option>
					<option value="image/">Images</option>
					<option value="application/pdf">PDFs</option>
				</select>
				<select class={inputCls} bind:value={sort} onchange={() => (page = 1)}>
					<option value="-createdAt">Newest</option>
					<option value="createdAt">Oldest</option>
					<option value="filename">Name</option>
				</select>
				<label class="flex items-center gap-1.5 text-xs text-(--color-muted)">
					<input type="checkbox" bind:checked={unused} onchange={() => (page = 1)} class="h-3.5 w-3.5 accent-(--color-primary)" />
					Unused only
				</label>
				<button type="button" class="{btn} ml-auto" onclick={() => (open = false)}>Close</button>
			</div>

			<!-- grid -->
			<div class="min-h-64 flex-1 overflow-y-auto p-3">
				{#if errorMsg}
					<p class="py-8 text-center text-sm text-(--color-danger)">{errorMsg}</p>
				{:else if loading}
					<p class="py-8 text-center text-sm text-(--color-muted)">Loading…</p>
				{:else if items.length === 0}
					<p class="py-8 text-center text-sm text-(--color-muted)">
						No media matches{q ? ` “${q}”` : ''}.
					</p>
				{:else}
					<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
						{#each items as opt, i (opt.id)}
							{@const isSel = picked.includes(opt.id)}
							<button
								type="button"
								onclick={() => pickOne(opt.id)}
								onmouseenter={() => (cursor = i)}
								class="group/item overflow-hidden rounded-(--radius) border text-left transition-colors {isSel
									? 'border-(--color-primary) ring-1 ring-(--color-primary)'
									: cursor === i
										? 'border-(--color-primary)'
										: 'border-(--color-border) hover:border-(--color-primary)'}"
							>
								<div class="flex aspect-square items-center justify-center bg-(--color-elevate-2)">
									{#if opt.url && (opt.mimeType ?? '').startsWith('image/')}
										<img src={opt.url} alt={opt.alt ?? opt.title} class="h-full w-full object-cover" loading="lazy" />
									{:else}
										<span class="text-2xl text-(--color-muted)">📄</span>
									{/if}
								</div>
								<div class="bg-(--color-elevate) p-1.5">
									<p class="truncate text-[11px] font-medium" title={opt.title}>{opt.title}</p>
									{#if opt.alt}
										<p class="truncate text-[10px] text-(--color-muted)" title={opt.alt}>{opt.alt}</p>
									{/if}
								</div>
							</button>
						{/each}
					</div>
				{/if}
			</div>

			<!-- footer: upload + paging + confirm -->
			<div class="flex flex-wrap items-center gap-2 border-t border-(--color-border) p-3">
				{#if uploadUrl}
					<label
						class="cursor-pointer rounded-(--radius) border border-dashed px-3 py-1.5 text-xs transition-colors {dragOver
							? 'border-(--color-primary) bg-(--color-primary)/10 text-(--color-primary)'
							: 'border-(--color-border) text-(--color-muted) hover:border-(--color-primary) hover:text-(--color-primary)'}"
						ondragover={(e) => {
							e.preventDefault();
							dragOver = true;
						}}
						ondragleave={() => (dragOver = false)}
						ondrop={(e) => {
							e.preventDefault();
							dragOver = false;
							if (e.dataTransfer?.files?.length) uploadFiles(e.dataTransfer.files);
						}}
					>
						{uploading ? 'Uploading…' : '⬆ Upload or drop here'}
						<input
							type="file"
							class="hidden"
							multiple={hasMany}
							disabled={uploading}
							onchange={(e) => {
								if (e.currentTarget.files) uploadFiles(e.currentTarget.files);
								e.currentTarget.value = '';
							}}
						/>
					</label>
				{/if}

				<span class="text-xs text-(--color-muted)">
					{totalDocs} item{totalDocs === 1 ? '' : 's'}{totalPages > 1 ? ` · page ${page}/${totalPages}` : ''}
				</span>
				{#if totalPages > 1}
					<button type="button" class={btn} disabled={page <= 1} onclick={() => (page = page - 1)}>←</button>
					<button type="button" class={btn} disabled={page >= totalPages} onclick={() => (page = page + 1)}>→</button>
				{/if}

				{#if hasMany}
					<button
						type="button"
						class="ml-auto rounded-(--radius) bg-(--color-primary) px-4 py-1.5 text-xs font-semibold text-(--color-primary-fg) hover:opacity-90"
						onclick={confirmPick}
					>
						Select {picked.length}
					</button>
				{/if}
			</div>
		</div>
	</div>
{/if}
