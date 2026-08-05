<script lang="ts">
	/**
	 * WYSIWYG editor for `html` fields: a single contenteditable surface with
	 * block-format + inline toolbars, and an HTML source toggle. The server
	 * re-sanitizes on every write (sanitizeDocumentHtml), so this editor only
	 * needs to be convenient, not trusted.
	 */
	import type { ClientField } from './client';

	let { field, value = undefined }: { field: ClientField; value?: unknown } = $props();

	// svelte-ignore state_referenced_locally — seed once from the prop
	let html = $state(typeof value === 'string' ? value : '');
	let mode = $state<'visual' | 'source'>('visual');
	let surface: HTMLDivElement | undefined = $state();

	function mounted(el: HTMLElement, initial: string) {
		el.innerHTML = initial;
	}
	function sync() {
		if (surface) html = surface.innerHTML;
	}
	function exec(cmd: string, arg?: string) {
		surface?.focus();
		document.execCommand(cmd, false, arg);
		sync();
	}
	function addLink() {
		const url = prompt('Link URL:');
		if (url) exec('createLink', url);
	}
	function toSource() {
		sync();
		mode = 'source';
	}
	function toVisual() {
		mode = 'visual';
		// surface remounts via {#key mode}; mounted() injects current html
	}

	const btn =
		'rounded px-2 py-1 text-xs font-medium text-(--color-muted) hover:bg-(--color-elevate-2) hover:text-(--color-fg)';
	const tools: { label: string; title: string; run: () => void }[] = [
		{ label: 'P', title: 'Paragraph', run: () => exec('formatBlock', '<p>') },
		{ label: 'H2', title: 'Heading 2', run: () => exec('formatBlock', '<h2>') },
		{ label: 'H3', title: 'Heading 3', run: () => exec('formatBlock', '<h3>') },
		{ label: '❝', title: 'Blockquote', run: () => exec('formatBlock', '<blockquote>') },
		{ label: 'B', title: 'Bold', run: () => exec('bold') },
		{ label: 'I', title: 'Italic', run: () => exec('italic') },
		{ label: 'S', title: 'Strikethrough', run: () => exec('strikeThrough') },
		{ label: '•', title: 'Bullet list', run: () => exec('insertUnorderedList') },
		{ label: '1.', title: 'Numbered list', run: () => exec('insertOrderedList') },
		{ label: '🔗', title: 'Link', run: addLink },
		{ label: '—', title: 'Horizontal rule', run: () => exec('insertHorizontalRule') }
	];
</script>

<div class="space-y-1.5">
	<label class="block text-xs font-medium tracking-wide text-(--color-muted) uppercase" for={field.name}>
		{field.label}
		{#if field.required}<span class="text-(--color-primary)">*</span>{/if}
		<span class="ml-1 font-normal normal-case opacity-60">(HTML)</span>
	</label>

	<input type="hidden" name={field.name} value={html} />

	<div class="overflow-hidden rounded-(--radius) border border-(--color-border) bg-(--color-elevate)">
		<div class="flex items-center gap-0.5 border-b border-(--color-border) px-2 py-1">
			{#each tools as tool (tool.title)}
				<button type="button" class={btn} title={tool.title} disabled={mode === 'source'} onmousedown={(e) => e.preventDefault()} onclick={tool.run}>
					{tool.label}
				</button>
			{/each}
			<span class="ml-auto flex items-center gap-1">
				<button type="button" class="{btn} {mode === 'visual' ? 'bg-(--color-elevate-2) text-(--color-fg)' : ''}" onclick={toVisual}>Visual</button>
				<button type="button" class="{btn} {mode === 'source' ? 'bg-(--color-elevate-2) text-(--color-fg)' : ''}" onclick={toSource}>HTML</button>
			</span>
		</div>

		{#if mode === 'visual'}
			{#key mode}
				<div
					bind:this={surface}
					contenteditable="true"
					role="textbox"
					aria-multiline="true"
					tabindex="0"
					use:mounted={html}
					oninput={sync}
					style="background:var(--hs-canvas);color:var(--hs-canvas-fg);"
					class="html-surface min-h-56 px-4 py-3 text-sm focus:outline-none"
				></div>
			{/key}
		{:else}
			<textarea
				id={field.name}
				rows="14"
				bind:value={html}
				class="block w-full resize-y bg-(--color-elevate-2) px-3 py-2 font-mono text-xs text-(--color-fg) focus:outline-none"
			></textarea>
		{/if}
	</div>

	{#if field.admin.description}
		<p class="text-xs text-(--color-muted)">{field.admin.description}</p>
	{/if}
</div>

<style>
	.html-surface :global(h1) { font-size: 1.5rem; font-weight: 600; margin: 0.8em 0 0.4em; }
	.html-surface :global(h2) { font-size: 1.3rem; font-weight: 600; margin: 0.8em 0 0.4em; }
	.html-surface :global(h3) { font-size: 1.1rem; font-weight: 600; margin: 0.8em 0 0.4em; }
	.html-surface :global(p) { margin: 0.5em 0; line-height: 1.65; }
	.html-surface :global(ul) { list-style: disc; padding-left: 1.5em; margin: 0.5em 0; }
	.html-surface :global(ol) { list-style: decimal; padding-left: 1.5em; margin: 0.5em 0; }
	.html-surface :global(blockquote) { border-left: 3px solid var(--color-primary); padding-left: 0.9em; color: var(--color-muted); margin: 0.7em 0; }
	.html-surface :global(a) { color: var(--color-primary); text-decoration: underline; }
	.html-surface :global(hr) { border-color: var(--color-border); margin: 1.2em 0; }
	.html-surface :global(img) { max-width: 100%; border-radius: 8px; }
	.html-surface :global(pre) { background: var(--color-elevate-2); padding: 0.7em 0.9em; border-radius: 6px; font-size: 0.85em; overflow-x: auto; }
</style>
