<script lang="ts">
	import { displayValue } from '$lib/admin/client';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Posts — svelte-payload</title></svelte:head>

<main class="mx-auto max-w-2xl px-6 py-16">
	<a href="/" class="text-sm text-(--color-muted) hover:text-(--color-fg)">← Home</a>
	<h1 class="mt-2 mb-8 text-3xl font-semibold tracking-tight">Posts</h1>
	<div class="space-y-4">
		{#each data.posts.docs as post (post.id)}
			<a
				href="/posts/{post.slug}"
				class="block rounded-xl border border-(--color-border) bg-(--color-elevate) p-5 transition-colors hover:border-(--color-primary)"
			>
				<h2 class="font-semibold">{post.title}</h2>
				{#if post.excerpt}<p class="mt-1 text-sm text-(--color-muted)">{post.excerpt}</p>{/if}
				<p class="mt-2 text-xs text-(--color-muted)">{displayValue(post.publishedAt)}</p>
			</a>
		{:else}
			<p class="text-(--color-muted)">No published posts yet.</p>
		{/each}
	</div>
</main>
