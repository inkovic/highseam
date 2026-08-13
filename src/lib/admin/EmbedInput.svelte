<script lang="ts">
	/**
	 * Editor for embed values: paste a URL, get an instant provider badge
	 * (client-side match against the core providers — no network), and the
	 * server fills title/thumbnail from the registry at save. Unrecognized
	 * URLs are kept and render as links — loudly labeled here so the editor
	 * knows before publishing.
	 */
	import { matchEmbedProvider } from '$lib/core/embed';

	type EmbedValue = { url: string; provider?: string; embedId?: string; title?: string; thumbUrl?: string };

	let {
		name,
		value = undefined,
		submitHidden = true,
		onChange = undefined,
		readOnly = false
	}: {
		name: string;
		value?: unknown;
		submitHidden?: boolean;
		onChange?: (v: EmbedValue | null) => void;
		readOnly?: boolean;
	} = $props();

	function initial(): EmbedValue | null {
		// Upgrade path: raw URL strings lift to the object shape.
		if (typeof value === 'string' && value.trim()) return { url: value.trim() };
		if (value && typeof value === 'object' && typeof (value as EmbedValue).url === 'string')
			return value as EmbedValue;
		return null;
	}

	// svelte-ignore state_referenced_locally — seed once from the prop
	let embed = $state<EmbedValue | null>(initial());
	// svelte-ignore state_referenced_locally
	let draft = $state(initial()?.url ?? '');
	let hiddenInput: HTMLInputElement | undefined = $state();

	const serialized = $derived(embed ? JSON.stringify(embed) : '');
	// Instant, network-free badge. Server resolution at save is authoritative.
	const liveMatch = $derived(embed && !embed.provider ? matchEmbedProvider(embed.url) : null);
	const badge = $derived(embed?.provider ?? liveMatch?.provider.name ?? null);

	function notify() {
		onChange?.(embed);
		queueMicrotask(() => hiddenInput?.dispatchEvent(new Event('input', { bubbles: true })));
	}
	function commit() {
		const u = draft.trim();
		if (!u) {
			embed = null;
		} else if (u !== embed?.url) {
			// URL changed: drop stale resolution; the server re-resolves at save.
			embed = { url: u };
		}
		notify();
	}
</script>

<div class="space-y-1.5" data-hs-embed-input>
	{#if submitHidden}
		<input type="hidden" {name} value={serialized} bind:this={hiddenInput} />
	{/if}

	<input
		type="url"
		class="w-full rounded-(--radius) border border-(--color-border) bg-(--color-elevate) px-3 py-2 text-sm text-(--color-fg) placeholder-(--color-muted) focus:border-(--color-primary) focus:outline-none disabled:opacity-50"
		placeholder="Paste a URL — YouTube, Vimeo, or a registered provider…"
		bind:value={draft}
		onblur={commit}
		onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), commit())}
		disabled={readOnly}
	/>

	{#if embed}
		<div class="flex items-center gap-2 text-xs">
			{#if embed.thumbUrl}
				<img src={embed.thumbUrl} alt="" class="h-9 w-16 rounded object-cover" loading="lazy" />
			{/if}
			{#if badge}
				<span class="rounded-full border border-(--color-border) bg-(--color-elevate-2) px-2 py-0.5 font-medium text-(--color-primary)">{badge}</span>
			{:else}
				<span class="rounded-full border border-(--color-border) px-2 py-0.5 text-(--color-muted)" title="No registered provider claims this URL — it will render as a plain link">
					⚠ no provider — renders as a link
				</span>
			{/if}
			<span class="truncate text-(--color-muted)">{embed.title ?? embed.url}</span>
			{#if embed.provider && !embed.title}
				<span class="text-(--color-muted)">(title resolves on save)</span>
			{/if}
		</div>
	{/if}
</div>
