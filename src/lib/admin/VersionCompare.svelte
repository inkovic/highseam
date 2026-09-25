<script lang="ts">
	/**
	 * Version history, compared (1.7.4) — the Sanity-style review panel.
	 * Left: every kept version, newest first, with the fields each save
	 * changed. Right: the selected version's changes, field by field, against
	 * the save before it ("What this save changed") or against the latest.
	 * Text shows a word diff; rich text and HTML a paragraph diff with the words
	 * marked inside changed paragraphs; everything else before → after.
	 * Snapshots load on demand from ./versions (two at a time, cached).
	 */
	import { enhance } from '$app/forms';
	import { displayValue, type ClientField } from './client';
	import { diffDocs, type FieldDiff, type Op } from './version-diff';

	type VersionRow = { id: string; createdAt: string; status: string; title: string; changed: string[] | null };

	let {
		open = $bindable(false),
		versions,
		fields,
		endpoint,
		startId = null
	}: {
		open?: boolean;
		versions: VersionRow[];
		fields: ClientField[];
		/** GET endpoint returning snapshots: `${endpoint}?ids=a,b`. */
		endpoint: string;
		/** Version to select on open (default: the latest). */
		startId?: string | null;
	} = $props();

	let dialog: HTMLDialogElement | undefined = $state();
	let selected = $state<string | null>(null);
	let against = $state<'previous' | 'latest'>('previous');

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) {
			selected = startId ?? versions[0]?.id ?? null;
			against = 'previous';
			dialog.showModal();
		} else if (!open && dialog.open) {
			dialog.close();
		}
	});

	const idx = $derived(versions.findIndex((v) => v.id === selected));
	const pair = $derived.by(() => {
		if (idx < 0) return null;
		if (against === 'previous') {
			const older = versions[idx + 1];
			return older ? { from: older, to: versions[idx] } : null;
		}
		return idx === 0 ? null : { from: versions[idx], to: versions[0] };
	});

	const cache = new Map<string, Record<string, unknown>>();
	let diffs = $state<FieldDiff[] | null>(null);
	let loading = $state(false);
	let failed = $state(false);
	$effect(() => {
		const p = pair;
		if (!open || !p) {
			diffs = null;
			return;
		}
		let cancelled = false;
		const need = [p.from.id, p.to.id].filter((id) => !cache.has(id));
		(async () => {
			try {
				if (need.length) {
					loading = true;
					const res = await fetch(`${endpoint}?ids=${need.map(encodeURIComponent).join(',')}`);
					if (!res.ok) throw new Error(String(res.status));
					for (const v of (await res.json()) as { id: string; snapshot: Record<string, unknown> }[])
						cache.set(v.id, v.snapshot);
				}
				if (cancelled) return;
				diffs = diffDocs(fields, cache.get(p.from.id) ?? {}, cache.get(p.to.id) ?? {});
				failed = false;
			} catch {
				if (!cancelled) failed = true;
			} finally {
				if (!cancelled) loading = false;
			}
		})();
		return () => {
			cancelled = true;
		};
	});

	const when = (v: VersionRow | undefined) => (v ? displayValue(v.createdAt) : '');
	const opClass = (t: Op['t']) =>
		t === 'del'
			? 'mr-0.5 rounded-sm bg-(--color-danger)/15 text-(--color-danger) line-through decoration-(--color-danger)/50'
			: t === 'ins'
				? 'rounded-sm bg-(--color-success)/20 text-(--color-success)'
				: '';
	const seg = (on: boolean) =>
		`px-2.5 py-1 ${on ? 'bg-(--color-elevate-2) text-(--color-fg)' : 'text-(--color-muted) hover:text-(--color-fg)'}`;
</script>

<dialog
	bind:this={dialog}
	onclose={() => (open = false)}
	aria-label="Compare versions"
	class="m-auto h-[88vh] w-[min(1200px,94vw)] max-w-none overflow-hidden rounded-(--radius) border border-(--color-border) bg-(--color-bg) p-0 text-(--color-fg) shadow-2xl backdrop:bg-black/60"
>
	{#if open}
		<div class="flex h-full">
			<!-- Version list -->
			<aside class="w-72 shrink-0 overflow-y-auto border-r border-(--color-border) p-3">
				<p class="mb-2 px-1 text-[10px] font-semibold tracking-widest text-(--color-muted) uppercase">
					Versions ({versions.length})
				</p>
				<ol class="space-y-1">
					{#each versions as v, i (v.id)}
						<li>
							<button
								type="button"
								onclick={() => (selected = v.id)}
								aria-current={selected === v.id}
								class="block w-full rounded-(--radius) px-3 py-2 text-left transition-colors {selected === v.id
									? 'bg-(--color-elevate-2) ring-1 ring-(--color-primary)'
									: 'hover:bg-(--color-elevate)'}"
							>
								<span class="flex items-center justify-between gap-2">
									<span class="text-xs text-(--color-fg)">{displayValue(v.createdAt)}</span>
									<span class="text-[10px] font-medium uppercase {v.status === 'published' ? 'text-(--color-success)' : 'text-(--color-muted)'}">{v.status}</span>
								</span>
								<span class="mt-0.5 block truncate text-[11px] text-(--color-muted)">
									{i === 0 ? 'Latest · ' : ''}{v.changed === null
										? 'Oldest kept'
										: v.changed.length
											? v.changed.join(', ')
											: 'No field changes'}
								</span>
							</button>
						</li>
					{/each}
				</ol>
			</aside>

			<!-- Changes -->
			<section class="flex min-w-0 flex-1 flex-col">
				<header class="flex flex-wrap items-center gap-3 border-b border-(--color-border) px-5 py-3">
					<div class="min-w-0">
						<p class="text-sm font-semibold">{against === 'previous' ? 'What this save changed' : 'This version compared with the latest'}</p>
						<p class="text-xs text-(--color-muted)">
							{#if pair}{when(pair.from)} → {when(pair.to)}{:else}{when(versions[idx])}{/if}
						</p>
					</div>
					<div role="group" aria-label="Compare with" class="ml-auto flex overflow-hidden rounded-(--radius) border border-(--color-border) text-xs">
						<button type="button" class={seg(against === 'previous')} aria-pressed={against === 'previous'} onclick={() => (against = 'previous')}>Previous save</button>
						<button type="button" class="border-l border-(--color-border) {seg(against === 'latest')}" aria-pressed={against === 'latest'} onclick={() => (against = 'latest')}>Latest</button>
					</div>
					{#if selected && idx > 0}
						<form
							method="POST"
							action="?/restore"
							use:enhance={({ cancel }) => {
								if (!confirm('Restore this version? It replaces the current content. Unsaved edits in the form are lost; saved versions stay in this list.')) {
									cancel();
									return;
								}
								return async ({ update }) => {
									await update();
									open = false;
								};
							}}
						>
							<input type="hidden" name="versionId" value={selected} />
							<button class="rounded-(--radius) border border-(--color-primary) px-3 py-1.5 text-xs font-medium text-(--color-primary) hover:bg-(--color-primary) hover:text-(--color-primary-fg)">
								Restore this version
							</button>
						</form>
					{/if}
					<button type="button" onclick={() => (open = false)} aria-label="Close" class="rounded-(--radius) px-2 py-1 text-(--color-muted) hover:bg-(--color-elevate-2) hover:text-(--color-fg)">✕</button>
				</header>

				<div class="flex-1 overflow-y-auto px-5 py-4">
					{#if !pair}
						<p class="text-sm text-(--color-muted)">
							{against === 'previous'
								? 'This is the oldest version kept, so there is nothing earlier to compare it with. Try “Latest”.'
								: 'This is the latest version. Pick an older one to compare it with this.'}
						</p>
					{:else if failed}
						<p class="text-sm text-(--color-danger)">Couldn’t load these versions. Close and try again.</p>
					{:else if loading || !diffs}
						<p class="text-sm text-(--color-muted)">Loading…</p>
					{:else if diffs.length === 0}
						<p class="text-sm text-(--color-muted)">No field changes between these two (only the save time differs).</p>
					{:else}
						<p class="mb-4 text-xs text-(--color-muted)">
							{diffs.length} field{diffs.length === 1 ? '' : 's'} changed ·
							<span class={opClass('del')}>removed</span> · <span class={opClass('ins')}>added</span>
						</p>
						{#each diffs as d (d.name)}
							<section class="mb-6">
								<h3 class="mb-1.5 text-xs font-semibold tracking-wide text-(--color-muted) uppercase">{d.label}</h3>
								{#if d.kind === 'text'}
									<p class="rounded-(--radius) border border-(--color-border) bg-(--color-elevate) px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap">{#each d.ops as o, i (i)}<span class={opClass(o.t)}>{o.v}</span>{/each}</p>
								{:else if d.kind === 'value'}
									<p class="text-sm"><span class={opClass('del')}>{d.before}</span> <span class="text-(--color-muted)">→</span> <span class={opClass('ins')}>{d.after}</span></p>
								{:else}
									<div class="divide-y divide-(--color-border)/60 overflow-hidden rounded-(--radius) border border-(--color-border) bg-(--color-elevate) text-sm leading-relaxed">
										{#each d.rows as r, i (i)}
											{#if r.t === 'skip'}
												<p class="px-3 py-1 text-[11px] text-(--color-muted) italic">⋯ {r.n} unchanged</p>
											{:else if r.t === 'mod'}
												<p class="px-3 py-1.5 whitespace-pre-wrap">{#each r.ops as o, j (j)}<span class={opClass(o.t)}>{o.v}</span>{/each}</p>
											{:else if r.t === 'del'}
												<p class="bg-(--color-danger)/10 px-3 py-1.5 whitespace-pre-wrap"><span class="mr-1.5 text-(--color-danger)">−</span><span class={opClass('del')}>{r.v}</span></p>
											{:else if r.t === 'ins'}
												<p class="bg-(--color-success)/10 px-3 py-1.5 whitespace-pre-wrap"><span class="mr-1.5 text-(--color-success)">+</span><span class={opClass('ins')}>{r.v}</span></p>
											{:else}
												<p class="px-3 py-1.5 whitespace-pre-wrap text-(--color-muted)">{r.v}</p>
											{/if}
										{/each}
									</div>
								{/if}
							</section>
						{/each}
					{/if}
				</div>
			</section>
		</div>
	{/if}
</dialog>
