<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { form, data }: { form: ActionData; data: PageData } = $props();
	const inputClass =
		'w-full rounded-(--radius) border border-(--color-border) bg-(--color-bg) px-3 py-2 text-sm focus:border-(--color-primary) focus:outline-none';
</script>

<div class="w-full max-w-sm rounded-xl border border-(--color-border) bg-(--color-elevate) p-8">
	<h1 class="mb-1 text-lg font-semibold">Welcome</h1>
	<p class="mb-6 text-sm text-(--color-muted)">
		Create the first user to get started. They'll be an admin.
	</p>
	<form method="POST" use:enhance class="space-y-4">
		<div>
			<label class="mb-1.5 block text-xs font-medium tracking-wide text-(--color-muted) uppercase" for="name">Name</label>
			<input id="name" name="name" required value={form?.name ?? ''} class={inputClass} />
			{#if form?.errors?.name}<p class="mt-1 text-xs text-(--color-danger)">{form.errors.name}</p>{/if}
		</div>
		<div>
			<label class="mb-1.5 block text-xs font-medium tracking-wide text-(--color-muted) uppercase" for="email">Email</label>
			<input id="email" name="email" type="email" required value={form?.email ?? ''} class={inputClass} />
			{#if form?.errors?.email}<p class="mt-1 text-xs text-(--color-danger)">{form.errors.email}</p>{/if}
		</div>
		<div>
			<label class="mb-1.5 block text-xs font-medium tracking-wide text-(--color-muted) uppercase" for="password">Password</label>
			<input id="password" name="password" type="password" required class={inputClass} />
			{#if form?.errors?.password}<p class="mt-1 text-xs text-(--color-danger)">{form.errors.password}</p>{/if}
		</div>
		{#if form?.message}
			<p class="text-sm text-(--color-danger)">{form.message}</p>
		{/if}
		<button class="w-full rounded-(--radius) bg-(--color-primary) px-3 py-2 text-sm font-semibold text-(--color-primary-fg) hover:opacity-90">
			Create user
		</button>
	</form>
</div>
