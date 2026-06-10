<script lang="ts">
	import { page } from '$app/state';
	import type { LayoutData } from './$types';
	import type { Snippet } from 'svelte';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	function isActive(slug: string): boolean {
		return page.url.pathname.startsWith(`/admin/${slug}`);
	}
</script>

<svelte:head>
	<title>{data.title} — Admin</title>
</svelte:head>

{#if data.user}
	<div class="flex min-h-screen">
		<aside class="flex w-60 shrink-0 flex-col border-r border-(--color-border) bg-(--color-elevate)">
			<a href="/admin" class="flex items-center gap-2 border-b border-(--color-border) px-5 py-4">
				<span class="inline-block h-2.5 w-2.5 rounded-full bg-(--color-primary)"></span>
				<span class="font-semibold tracking-tight">{data.title}</span>
			</a>
			<nav class="flex-1 space-y-0.5 p-3">
				<p class="px-2 pt-2 pb-1 text-[10px] font-semibold tracking-widest text-(--color-muted) uppercase">
					Collections
				</p>
				{#each data.collections as col (col.slug)}
					<a
						href="/admin/{col.slug}"
						class="block rounded-(--radius) px-3 py-2 text-sm transition-colors {isActive(col.slug)
							? 'bg-(--color-elevate-2) font-medium text-(--color-primary)'
							: 'text-(--color-fg) hover:bg-(--color-elevate-2)'}"
					>
						{col.labels.plural}
					</a>
				{/each}
			</nav>
			<div class="border-t border-(--color-border) p-3">
				<p class="truncate px-2 pb-2 text-xs text-(--color-muted)">{data.user.email}</p>
				<form method="POST" action="/admin/logout">
					<button
						class="w-full rounded-(--radius) border border-(--color-border) px-3 py-1.5 text-left text-sm text-(--color-muted) hover:text-(--color-fg)"
					>
						Log out
					</button>
				</form>
			</div>
		</aside>
		<main class="min-w-0 flex-1 p-8">
			{@render children()}
		</main>
	</div>
{:else}
	<main class="flex min-h-screen items-center justify-center p-6">
		{@render children()}
	</main>
{/if}
