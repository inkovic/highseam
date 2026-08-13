<script lang="ts">
	/**
	 * Frontend renderer for structured rich text. Inline HTML in nodes was
	 * sanitized server-side on write. `refs` resolves embedded upload /
	 * relationship ids to documents (see extractRichTextRefs).
	 */
	import { markdownToNodes, type RichTextNode } from '$lib/core/richtext';
	import { focalObjectPosition, normalizeFocalPoint, parseRatio } from '$lib/core/media';
	import type { Doc } from '$lib/core/types';

	let {
		content,
		refs = {}
	}: {
		content: RichTextNode[] | string | null | undefined;
		refs?: Record<string, Doc>;
	} = $props();

	const nodes: RichTextNode[] = $derived(
		Array.isArray(content) ? content : typeof content === 'string' ? markdownToNodes(content) : []
	);

	// Embeds: iframes come from this allowlist only — never from stored HTML.
	// Click-to-load facade when a poster frame exists (privacy: no third-party
	// request until the reader opts in; YouTube goes through nocookie).
	function embedSrc(node: { provider?: string; embedId?: string }): string | null {
		if (!node.embedId) return null;
		if (node.provider === 'youtube')
			return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(node.embedId)}`;
		if (node.provider === 'vimeo')
			return `https://player.vimeo.com/video/${encodeURIComponent(node.embedId)}`;
		return null;
	}
	let activated = $state<Set<number>>(new Set());
	function activate(i: number) {
		activated = new Set(activated).add(i);
	}
</script>

<div class="rt">
	{#each nodes as node, i (i)}
		{#if node.type === 'p'}
			<p>{@html node.html}</p>
		{:else if node.type === 'h2'}
			<h2>{@html node.html}</h2>
		{:else if node.type === 'h3'}
			<h3>{@html node.html}</h3>
		{:else if node.type === 'quote'}
			<blockquote>{@html node.html}</blockquote>
		{:else if node.type === 'ul'}
			<ul>{#each node.items as item, j (j)}<li>{@html item}</li>{/each}</ul>
		{:else if node.type === 'ol'}
			<ol>{#each node.items as item, j (j)}<li>{@html item}</li>{/each}</ol>
		{:else if node.type === 'code'}
			<pre><code>{node.code}</code></pre>
		{:else if node.type === 'divider'}
			<hr />
		{:else if node.type === 'gallery'}
			{@const gratio = node.fields?.aspect ? parseRatio(node.fields.aspect) : null}
			<!-- Reference implementation: a simple grid, focal-aware, override-
			     respecting. Layout names (node.fields.layout) are yours to style:
			     the wrapper carries data-layout for your CSS. -->
			<div class="rt-gallery" data-layout={node.fields?.layout ?? 'default'}>
				{#each node.items ?? [] as item (item.id)}
					{@const media = refs[item.id]}
					{#if media && String(media.mimeType ?? '').startsWith('image/')}
						<figure>
							<img
								src={String(media.url)}
								alt={String(item.alt ?? media.alt ?? '')}
								style="{gratio ? `aspect-ratio: ${gratio.w} / ${gratio.h};` : 'aspect-ratio: 3 / 2;'} width: 100%; object-fit: cover; object-position: {focalObjectPosition(normalizeFocalPoint(media.focalPoint))};"
								loading="lazy"
							/>
							{#if item.caption ?? media.caption}<figcaption>{item.caption ?? media.caption}</figcaption>{/if}
						</figure>
					{/if}
				{/each}
			</div>
		{:else if node.type === 'upload'}
			{@const media = refs[node.value]}
			{@const ratio = node.fields?.aspect ? parseRatio(node.fields.aspect) : null}
			{#if media && String(media.mimeType ?? '').startsWith('image/')}
				<figure>
					{#if ratio}
						<!-- Per-placement presentation: this USE renders at the chosen
						     aspect, cropped toward the doc's focal point. -->
						<img
							src={String(media.url)}
							alt={String(media.alt ?? '')}
							style="aspect-ratio: {ratio.w} / {ratio.h}; width: 100%; object-fit: cover; object-position: {focalObjectPosition(normalizeFocalPoint(media.focalPoint))};"
						/>
					{:else}
						<img src={String(media.url)} alt={String(media.alt ?? '')} />
					{/if}
					{#if media.alt}<figcaption>{media.alt}</figcaption>{/if}
				</figure>
			{:else if media}
				<p><a href={String(media.url)}>{String(media.filename ?? 'Download')}</a></p>
			{/if}
		{:else if node.type === 'embed'}
			{@const src = embedSrc(node)}
			{#if src && (!node.thumbUrl || activated.has(i))}
				<div class="rt-embed-frame">
					<iframe {src} title={node.title ?? 'Embedded content'} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe>
				</div>
			{:else if src && node.thumbUrl}
				<button type="button" class="rt-embed-frame rt-embed-facade" onclick={() => activate(i)} aria-label="Play {node.title ?? 'embedded content'}">
					<img src={node.thumbUrl} alt={node.title ?? ''} loading="lazy" />
					<span class="rt-embed-play">▶</span>
				</button>
			{:else}
				<p><a href={node.url} rel="noopener nofollow" target="_blank">{node.title ?? node.url}</a></p>
			{/if}
		{:else if node.type === 'relationship'}
			{@const doc = refs[node.value]}
			{#if doc}
				<a class="rt-embed" href="/{node.relationTo}/{doc.slug ?? doc.id}">
					<span class="rt-embed-kind">{node.relationTo}</span>
					<span class="rt-embed-title">{String(doc.title ?? doc.name ?? doc.id)}</span>
					{#if doc.excerpt}<span class="rt-embed-sub">{String(doc.excerpt)}</span>{/if}
				</a>
			{/if}
		{:else if node.type === 'block'}
			{#if node.blockType === 'callout'}
				<aside class="rt-callout rt-callout-{String(node.fields.tone ?? 'info')}">
					{String(node.fields.text ?? '')}
				</aside>
			{:else if node.blockType === 'cta'}
				<p><a class="rt-cta" href={String(node.fields.url ?? '#')}>{String(node.fields.label ?? 'Learn more')} →</a></p>
			{:else}
				<div class="rt-block">
					<p class="rt-embed-kind">{node.blockType}</p>
					{#each Object.entries(node.fields) as [k, v] (k)}
						<p><strong>{k}:</strong> {String(v)}</p>
					{/each}
				</div>
			{/if}
		{/if}
	{/each}
</div>

<style>
	.rt :global(h2) { font-size: 1.5rem; font-weight: 600; margin: 1.4em 0 0.5em; }
	.rt :global(h3) { font-size: 1.2rem; font-weight: 600; margin: 1.2em 0 0.4em; }
	.rt :global(p) { margin: 0.7em 0; line-height: 1.7; }
	.rt :global(ul) { list-style: disc; padding-left: 1.5em; margin: 0.7em 0; }
	.rt :global(ol) { list-style: decimal; padding-left: 1.5em; margin: 0.7em 0; }
	.rt :global(li) { margin: 0.25em 0; line-height: 1.6; }
	.rt :global(blockquote) { border-left: 3px solid var(--color-primary); padding-left: 1em; color: var(--color-muted); font-style: italic; margin: 1em 0; }
	.rt :global(pre) { background: var(--color-elevate); border: 1px solid var(--color-border); padding: 0.8em 1em; border-radius: 8px; overflow-x: auto; margin: 1em 0; font-size: 0.85em; }
	.rt :global(code) { font-family: var(--font-mono); }
	.rt :global(p code) { background: var(--color-elevate-2); padding: 0.1em 0.35em; border-radius: 4px; font-size: 0.85em; }
	.rt :global(a) { color: var(--color-primary); text-decoration: underline; }
	.rt :global(hr) { border-color: var(--color-border); margin: 1.6em 0; }
	.rt :global(img) { border-radius: 10px; border: 1px solid var(--color-border); max-width: 100%; }
	.rt :global(figcaption) { font-size: 0.8em; color: var(--color-muted); margin-top: 0.4em; }
	.rt-gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 0.75rem; margin: 1em 0; }
	.rt-gallery figure { margin: 0; }
	.rt-embed-frame { position: relative; aspect-ratio: 16 / 9; width: 100%; margin: 1em 0; border-radius: 10px; overflow: hidden; border: 1px solid var(--color-border); background: #000; padding: 0; display: block; cursor: pointer; }
	.rt-embed-frame iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
	.rt-embed-facade img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0.85; border: 0; border-radius: 0; }
	.rt-embed-play { position: absolute; inset: 0; display: grid; place-items: center; font-size: 2.5rem; color: #fff; text-shadow: 0 2px 12px rgba(0,0,0,0.7); }
	.rt-embed { display: block; border: 1px solid var(--color-border); border-radius: 10px; padding: 0.8em 1em; margin: 1em 0; text-decoration: none !important; background: var(--color-elevate); }
	.rt-embed-kind { display: block; font-size: 0.7em; text-transform: uppercase; letter-spacing: 0.1em; color: var(--color-muted); }
	.rt-embed-title { display: block; font-weight: 600; color: var(--color-fg); }
	.rt-embed-sub { display: block; font-size: 0.85em; color: var(--color-muted); }
	.rt-callout { border-radius: 10px; padding: 0.9em 1.1em; margin: 1em 0; border: 1px solid var(--color-border); background: var(--color-elevate); }
	.rt-callout-warning { border-color: #eab308; }
	.rt-callout-success { border-color: var(--color-success); }
	.rt-cta { display: inline-block; background: var(--color-primary); color: var(--color-primary-fg) !important; font-weight: 600; padding: 0.5em 1.1em; border-radius: 8px; text-decoration: none !important; }
	.rt-block { border: 1px dashed var(--color-border); border-radius: 10px; padding: 0.8em 1em; margin: 1em 0; font-size: 0.9em; }
</style>
