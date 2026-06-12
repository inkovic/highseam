<script lang="ts">
	import RichTextRenderer from '$lib/RichTextRenderer.svelte';
	import { displayValue } from '$lib/admin/client';
	import type { RichTextNode } from '$lib/core/richtext';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const author = $derived(
		data.post.author && typeof data.post.author === 'object'
			? String((data.post.author as Record<string, unknown>).name ?? '')
			: ''
	);
	const cover = $derived(
		data.post.coverImage && typeof data.post.coverImage === 'object'
			? (data.post.coverImage as Record<string, unknown>)
			: null
	);
</script>

<svelte:head>
	<title>{data.post.title} — svelte-payload</title>
	{#if data.post.excerpt}<meta name="description" content={String(data.post.excerpt)} />{/if}
</svelte:head>

<main class="mx-auto max-w-2xl px-6 py-16">
	<a href="/posts" class="text-sm text-(--color-muted) hover:text-(--color-fg)">← Posts</a>
	<article class="mt-4">
		<h1 class="text-3xl leading-tight font-semibold tracking-tight">{data.post.title}</h1>
		<p class="mt-2 text-sm text-(--color-muted)">
			{displayValue(data.post.publishedAt)}{author ? ` · ${author}` : ''}
		</p>
		{#if cover && String(cover.mimeType ?? '').startsWith('image/')}
			<img
				src={String(cover.url)}
				alt={String(cover.alt ?? '')}
				class="mt-6 w-full rounded-xl border border-(--color-border)"
			/>
		{/if}
		<div class="mt-8">
			<RichTextRenderer content={data.post.content as RichTextNode[] | string} refs={data.refs} />
		</div>
	</article>
</main>
