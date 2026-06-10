<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { form, data }: { form: ActionData; data: PageData } = $props();
</script>

<div class="w-full max-w-sm rounded-xl border border-(--color-border) bg-(--color-elevate) p-8">
	<div class="mb-6 flex items-center gap-2">
		<span class="inline-block h-2.5 w-2.5 rounded-full bg-(--color-primary)"></span>
		<h1 class="text-lg font-semibold">{data.title}</h1>
	</div>
	<form method="POST" use:enhance class="space-y-4">
		<input type="hidden" name="collection" value="users" />
		<div>
			<label class="mb-1.5 block text-xs font-medium tracking-wide text-(--color-muted) uppercase" for="email">Email</label>
			<input
				id="email"
				name="email"
				type="email"
				required
				value={form?.email ?? ''}
				class="w-full rounded-(--radius) border border-(--color-border) bg-(--color-bg) px-3 py-2 text-sm focus:border-(--color-primary) focus:outline-none"
			/>
		</div>
		<div>
			<label class="mb-1.5 block text-xs font-medium tracking-wide text-(--color-muted) uppercase" for="password">Password</label>
			<input
				id="password"
				name="password"
				type="password"
				required
				class="w-full rounded-(--radius) border border-(--color-border) bg-(--color-bg) px-3 py-2 text-sm focus:border-(--color-primary) focus:outline-none"
			/>
		</div>
		{#if form?.message}
			<p class="text-sm text-(--color-danger)">{form.message}</p>
		{/if}
		<button
			class="w-full rounded-(--radius) bg-(--color-primary) px-3 py-2 text-sm font-semibold text-(--color-primary-fg) hover:opacity-90"
		>
			Log in
		</button>
	</form>
</div>
