<script lang="ts">
	import { onPreviewData } from '$lib/preview';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Mode B: re-render live from the admin's postMessage payload, no save.
	let live = $state<Record<string, unknown> | null>(null);
	$effect(() => onPreviewData((doc) => (live = doc)));

	const v = $derived(live ?? data.venue);
</script>

<svelte:head><title>Preview — {String(v.name ?? '')}</title></svelte:head>

<main style="max-width:42rem;margin:0 auto;padding:2.5rem 1.5rem;font-family:system-ui,sans-serif;">
	<p style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.1em;color:#888;">
		Preview{live ? ' · live' : ''}
	</p>
	<h1 style="font-size:2rem;font-weight:600;margin:0.3em 0;">{String(v.name ?? '')}</h1>
	<p style="color:#666;">{String(v.suburb ?? '')} · ★ {String(v.rating ?? '—')} · {v.dog_friendly ? '🐾 dog-friendly' : 'no dogs'}</p>
	<!-- rich_html is sanitized server-side on save -->
	<div style="margin-top:1.5rem;line-height:1.7;">{@html String(v.rich_html ?? '')}</div>
</main>
