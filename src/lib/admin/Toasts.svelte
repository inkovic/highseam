<script lang="ts">
	import { toasts, dismissToast } from './toast-store.svelte.js';
	const items = $derived(toasts());
</script>

<div class="pointer-events-none fixed right-4 bottom-4 z-[9999] flex w-80 flex-col gap-2">
	{#each items as t (t.id)}
		<div
			class="pointer-events-auto flex items-start gap-2 rounded-(--radius) border px-3 py-2 text-sm shadow-lg bg-(--color-elevate) {t.kind ===
			'error'
				? 'border-(--color-danger) text-(--color-danger)'
				: t.kind === 'success'
					? 'border-(--color-success) text-(--color-success)'
					: 'border-(--color-border) text-(--color-fg)'}"
		>
			<span class="flex-1">{t.message}</span>
			<button type="button" onclick={() => dismissToast(t.id)} class="text-(--color-muted) hover:text-(--color-fg)" aria-label="Dismiss">✕</button>
		</div>
	{/each}
</div>
