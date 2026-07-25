<script lang="ts">
	/**
	 * Block-based rich text editor — the Lexical-equivalent experience.
	 * The document is an array of typed nodes: text blocks (contenteditable
	 * with a restricted inline toolbar), lists, quotes, code, dividers, and
	 * EMBEDS: uploads, relationships, and config-defined components live
	 * inside the document flow. Serializes to JSON in a hidden input; the
	 * server re-sanitizes all inline HTML.
	 */
	import { htmlToNodes, markdownToNodes, type RichTextNode } from '$lib/core/richtext';
	import RelationPicker from './RelationPicker.svelte';
	import type { ClientBlock, ClientField } from './client';
	import type { RelOption } from './server';

	type EditorNode = RichTextNode & { _key: string };

	let {
		field,
		value = undefined,
		relOptions = {}
	}: {
		field: ClientField;
		value?: unknown;
		relOptions?: Record<string, RelOption[]>;
	} = $props();

	function key(): string {
		return crypto.randomUUID();
	}

	function initialNodes(): EditorNode[] {
		let base: RichTextNode[];
		if (Array.isArray(value)) base = value as RichTextNode[];
		else if (typeof value === 'string' && value.trim().startsWith('['))
			base = JSON.parse(value) as RichTextNode[];
		else if (typeof value === 'string' && value.trim()) base = markdownToNodes(value);
		else base = [{ type: 'p', html: '' }];
		return base.map((n) => ({ ...n, _key: key() }));
	}

	// svelte-ignore state_referenced_locally — seed once from the prop
	let nodes = $state<EditorNode[]>(initialNodes());

	const serialized = $derived(JSON.stringify(nodes.map(({ _key, ...node }) => node)));

	// --- structural ops --------------------------------------------------------

	function addNode(node: RichTextNode, after?: number) {
		const withKey = { ...node, _key: key() } as EditorNode;
		if (after === undefined) nodes.push(withKey);
		else nodes.splice(after + 1, 0, withKey);
	}
	function remove(i: number) {
		nodes.splice(i, 1);
	}
	function move(i: number, dir: -1 | 1) {
		const j = i + dir;
		if (j < 0 || j >= nodes.length) return;
		[nodes[i], nodes[j]] = [nodes[j], nodes[i]];
	}
	function setType(i: number, type: 'p' | 'h2' | 'h3' | 'quote') {
		const n = nodes[i];
		if ('html' in n) nodes[i] = { ...n, type } as EditorNode;
	}

	// --- paste: clipboard HTML / raw markup / multi-paragraph text -> nodes ----

	const BLOCKY_HTML = /<(p|h[1-6]|blockquote|ul|ol|li|pre|hr|div|table)\b/i;

	function clipboardToNodes(e: ClipboardEvent): RichTextNode[] | null {
		const html = e.clipboardData?.getData('text/html') ?? '';
		const text = (e.clipboardData?.getData('text/plain') ?? '').trim();
		if (html && BLOCKY_HTML.test(html)) return htmlToNodes(html);
		// Raw markup pasted as plain text (e.g. copied out of an HTML field).
		if (text.startsWith('<') && BLOCKY_HTML.test(text)) return htmlToNodes(text);
		// Plain text with blank-line paragraph breaks.
		if (/\n\s*\n/.test(text)) {
			const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
			return text
				.split(/\n{2,}/)
				.map((b) => ({ type: 'p', html: esc(b.trim()).replace(/\n/g, '<br>') }) as RichTextNode)
				.filter((n) => 'html' in n && n.html);
		}
		return null; // simple inline paste: browser default, re-sanitized on save
	}

	function onPaste(e: ClipboardEvent, i: number) {
		const parsed = clipboardToNodes(e);
		if (!parsed || parsed.length === 0) return;
		e.preventDefault();
		const withKeys = parsed.map((n) => ({ ...n, _key: key() }) as EditorNode);
		const cur = nodes[i];
		const curEmpty = cur && 'html' in cur && !cur.html.replace(/<br\s*\/?>|&nbsp;|\s/gi, '');
		if (curEmpty) nodes.splice(i, 1, ...withKeys);
		else nodes.splice(i + 1, 0, ...withKeys);
	}

	// svelte-ignore state_referenced_locally — field config is static per instance
	const blockTypes: ClientBlock[] = field.blocks ?? [];
	// svelte-ignore state_referenced_locally
	const uploadsSlug = field.uploads;
	// svelte-ignore state_referenced_locally
	const relationSlugs = field.relationships ?? [];

	interface AddItem {
		label: string;
		make: () => RichTextNode;
	}
	const addItems: AddItem[] = [
		{ label: 'Text', make: () => ({ type: 'p', html: '' }) },
		{ label: 'H2', make: () => ({ type: 'h2', html: '' }) },
		{ label: 'H3', make: () => ({ type: 'h3', html: '' }) },
		{ label: 'Quote', make: () => ({ type: 'quote', html: '' }) },
		{ label: '• List', make: () => ({ type: 'ul', items: [''] }) },
		{ label: '1. List', make: () => ({ type: 'ol', items: [''] }) },
		{ label: 'Code', make: () => ({ type: 'code', code: '' }) },
		{ label: '— Divider', make: () => ({ type: 'divider' }) },
		...(uploadsSlug
			? [{ label: '🖼 Image', make: () => ({ type: 'upload', relationTo: uploadsSlug, value: '' }) as RichTextNode }]
			: []),
		...relationSlugs.map((slug) => ({
			label: `↪ ${slug}`,
			make: () => ({ type: 'relationship', relationTo: slug, value: '' }) as RichTextNode
		})),
		...blockTypes.map((b) => ({
			label: `⧉ ${b.label}`,
			make: () => {
				const fields: Record<string, unknown> = {};
				for (const f of b.fields) {
					if (f.defaultValue !== undefined) fields[f.name] = f.defaultValue;
					else if (f.type === 'checkbox') fields[f.name] = false;
				}
				return { type: 'block', blockType: b.slug, fields } as RichTextNode;
			}
		}))
	];

	// --- contenteditable wiring --------------------------------------------------
	// Set innerHTML exactly once (mount); reads flow DOM -> state on input, so
	// the caret never jumps. Keyed {#each} keeps DOM nodes across reorders.

	function editable(el: HTMLElement, html: string) {
		el.innerHTML = html;
	}

	function exec(cmd: string, arg?: string) {
		document.execCommand(cmd, false, arg);
	}
	function addLink() {
		const url = prompt('Link URL:');
		if (url) exec('createLink', url);
	}
	function inlineCode() {
		const sel = window.getSelection()?.toString();
		if (sel) exec('insertHTML', `<code>${sel.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</code>`);
	}

	const ceClass =
		'min-h-[1.5rem] w-full px-3 py-2 text-(--color-fg) focus:outline-none [&_a]:text-(--color-primary) [&_a]:underline [&_code]:rounded [&_code]:bg-(--color-elevate-2) [&_code]:px-1 [&_code]:text-[0.85em]';
	const toolBtn =
		'rounded px-2 py-1 text-xs font-medium text-(--color-muted) hover:bg-(--color-elevate-2) hover:text-(--color-fg)';
	const miniInput =
		'w-full rounded-(--radius) border border-(--color-border) bg-(--color-bg) px-2.5 py-1.5 text-sm text-(--color-fg) focus:border-(--color-primary) focus:outline-none';
	const ctl =
		'rounded px-1.5 py-0.5 text-xs text-(--color-muted) hover:bg-(--color-elevate-2) hover:text-(--color-fg) disabled:opacity-30';

	function blockFor(slug: string): ClientBlock | undefined {
		return blockTypes.find((b) => b.slug === slug);
	}
	function optionsFor(slug: string): RelOption[] {
		return relOptions[slug] ?? [];
	}
</script>

<div class="space-y-1.5">
	<span class="block text-xs font-medium tracking-wide text-(--color-muted) uppercase">
		{field.label}
		{#if field.required}<span class="text-(--color-primary)">*</span>{/if}
	</span>

	<input type="hidden" name={field.name} value={serialized} />

	<div class="overflow-hidden rounded-(--radius) border border-(--color-border) bg-(--color-elevate)">
		<!-- inline formatting toolbar (applies to the focused text block) -->
		<div class="flex items-center gap-0.5 border-b border-(--color-border) px-2 py-1">
			<button type="button" class={toolBtn} title="Bold" onmousedown={(e) => e.preventDefault()} onclick={() => exec('bold')}><strong>B</strong></button>
			<button type="button" class={toolBtn} title="Italic" onmousedown={(e) => e.preventDefault()} onclick={() => exec('italic')}><em>I</em></button>
			<button type="button" class={toolBtn} title="Strikethrough" onmousedown={(e) => e.preventDefault()} onclick={() => exec('strikeThrough')}><s>S</s></button>
			<button type="button" class={toolBtn} title="Inline code" onmousedown={(e) => e.preventDefault()} onclick={inlineCode}>{'</>'}</button>
			<button type="button" class={toolBtn} title="Link" onmousedown={(e) => e.preventDefault()} onclick={addLink}>🔗</button>
			<span class="ml-auto text-[10px] text-(--color-muted)">{nodes.length} nodes</span>
		</div>

		<div class="divide-y divide-(--color-border)">
			{#each nodes as node, i (node._key)}
				<div class="group/node relative">
					<!-- node controls -->
					<div class="absolute top-1 right-1 z-10 flex items-center gap-0.5 rounded bg-(--color-elevate) opacity-0 transition-opacity group-hover/node:opacity-100">
						{#if 'html' in node}
							<select
								class="rounded border border-(--color-border) bg-(--color-elevate) px-1 py-0.5 text-[10px] text-(--color-muted)"
								value={node.type}
								onchange={(e) => setType(i, e.currentTarget.value as 'p')}
							>
								<option value="p">Text</option>
								<option value="h2">H2</option>
								<option value="h3">H3</option>
								<option value="quote">Quote</option>
							</select>
						{/if}
						<button type="button" class={ctl} disabled={i === 0} onclick={() => move(i, -1)}>↑</button>
						<button type="button" class={ctl} disabled={i === nodes.length - 1} onclick={() => move(i, 1)}>↓</button>
						<button type="button" class="{ctl} hover:text-(--color-danger)" onclick={() => remove(i)}>✕</button>
					</div>

					{#if node.type === 'p' || node.type === 'h2' || node.type === 'h3' || node.type === 'quote'}
						<div
							contenteditable="true"
							role="textbox"
							aria-multiline="true"
							tabindex="0"
							use:editable={node.html}
							oninput={(e) => (node.html = e.currentTarget.innerHTML)}
							onpaste={(e) => onPaste(e, i)}
							class="{ceClass} {node.type === 'h2'
								? 'text-xl font-semibold'
								: node.type === 'h3'
									? 'text-lg font-semibold'
									: node.type === 'quote'
										? 'border-l-2 border-(--color-primary) pl-4 text-(--color-muted) italic'
										: ''}"
							data-placeholder={node.type === 'p' ? 'Type something…' : node.type.toUpperCase()}
						></div>
					{:else if node.type === 'ul' || node.type === 'ol'}
						<div class="space-y-0.5 px-3 py-2">
							{#each node.items as item, j (j)}
								<div class="flex items-start gap-2">
									<span class="pt-1.5 text-xs text-(--color-muted)">{node.type === 'ol' ? `${j + 1}.` : '•'}</span>
									<div
										contenteditable="true"
										role="textbox"
										tabindex="0"
										use:editable={item}
										oninput={(e) => (node.items[j] = e.currentTarget.innerHTML)}
										onpaste={(e) => onPaste(e, i)}
										class="min-h-[1.4rem] flex-1 py-1 text-sm text-(--color-fg) focus:outline-none"
									></div>
									<button type="button" class="{ctl} mt-1" onclick={() => node.items.splice(j, 1)}>✕</button>
								</div>
							{/each}
							<button type="button" class="text-xs text-(--color-muted) hover:text-(--color-primary)" onclick={() => node.items.push('')}>
								+ item
							</button>
						</div>
					{:else if node.type === 'code'}
						<textarea
							rows={Math.max(3, node.code.split('\n').length)}
							bind:value={node.code}
							placeholder="code…"
							class="block w-full resize-y bg-(--color-elevate-2) px-3 py-2 font-mono text-xs text-(--color-fg) focus:outline-none"
						></textarea>
					{:else if node.type === 'divider'}
						<div class="px-3 py-3"><hr class="border-(--color-border)" /></div>
					{:else if node.type === 'upload'}
						<div class="bg-(--color-elevate-2)/50 px-3 py-2">
							<span class="mb-1 block text-xs font-semibold tracking-wide text-(--color-primary) uppercase">Image</span>
							<div class="max-w-sm">
								<RelationPicker
									name="_rt_upload"
									options={optionsFor(node.relationTo)}
									value={node.value}
									relationTo={node.relationTo}
									searchUrl="/api/{node.relationTo}/options"
									submitHidden={false}
									onChange={(ids) => (node.value = ids[0] ?? '')}
								/>
							</div>
						</div>
					{:else if node.type === 'relationship'}
						<div class="bg-(--color-elevate-2)/50 px-3 py-2">
							<span class="mb-1 block text-xs font-semibold tracking-wide text-(--color-primary) uppercase">↪ {node.relationTo}</span>
							<div class="max-w-sm">
								<RelationPicker
									name="_rt_rel"
									options={optionsFor(node.relationTo)}
									value={node.value}
									relationTo={node.relationTo}
									searchUrl="/api/{node.relationTo}/options"
									submitHidden={false}
									onChange={(ids) => (node.value = ids[0] ?? '')}
								/>
							</div>
						</div>
					{:else if node.type === 'block'}
						{@const block = blockFor(node.blockType)}
						<div class="bg-(--color-elevate-2)/50 px-3 py-2">
							<p class="mb-2 text-xs font-semibold tracking-wide text-(--color-primary) uppercase">
								⧉ {block?.label ?? node.blockType}
							</p>
							{#if block}
								<div class="space-y-2">
									{#each block.fields as sub (sub.name)}
										<div>
											<label class="mb-0.5 block text-[11px] font-medium text-(--color-muted)" for="{node._key}-{sub.name}">{sub.label}</label>
											{#if sub.type === 'textarea' || sub.type === 'richText'}
												<textarea id="{node._key}-{sub.name}" rows="3" class={miniInput} bind:value={node.fields[sub.name] as string}></textarea>
											{:else if sub.type === 'select'}
												<select id="{node._key}-{sub.name}" class={miniInput} bind:value={node.fields[sub.name] as string}>
													{#if !sub.required}<option value="">—</option>{/if}
													{#each sub.options ?? [] as opt (opt.value)}<option value={opt.value}>{opt.label}</option>{/each}
												</select>
											{:else if sub.type === 'checkbox'}
												<input id="{node._key}-{sub.name}" type="checkbox" class="h-4 w-4 accent-(--color-primary)" bind:checked={node.fields[sub.name] as boolean} />
											{:else if sub.type === 'number'}
												<input id="{node._key}-{sub.name}" type="number" step="any" class={miniInput} bind:value={node.fields[sub.name] as number} />
											{:else if sub.type === 'relationship' || sub.type === 'upload'}
												<RelationPicker
													name="_rt_sub"
													options={optionsFor(sub.relationTo ?? '')}
													value={node.fields[sub.name]}
													hasMany={sub.hasMany}
													relationTo={sub.relationTo ?? ''}
													searchUrl={sub.relationTo ? `/api/${sub.relationTo}/options` : ''}
													submitHidden={false}
													onChange={(ids) => (node.fields[sub.name] = sub.hasMany ? ids : (ids[0] ?? ''))}
												/>
											{:else}
												<input id="{node._key}-{sub.name}" type="text" class={miniInput} bind:value={node.fields[sub.name] as string} />
											{/if}
										</div>
									{/each}
								</div>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>

		<!-- add menu -->
		<div class="flex flex-wrap items-center gap-1 border-t border-(--color-border) px-2 py-1.5">
			<span class="pr-1 text-[10px] font-semibold tracking-widest text-(--color-muted) uppercase">Add</span>
			{#each addItems as item (item.label)}
				<button
					type="button"
					class="rounded border border-(--color-border) px-2 py-0.5 text-xs text-(--color-muted) hover:border-(--color-primary) hover:text-(--color-primary)"
					onclick={() => addNode(item.make())}
				>
					{item.label}
				</button>
			{/each}
		</div>
	</div>

	{#if field.admin.description}
		<p class="text-xs text-(--color-muted)">{field.admin.description}</p>
	{/if}
</div>

<style>
	[contenteditable]:empty::before {
		content: attr(data-placeholder);
		color: var(--color-muted);
		opacity: 0.5;
	}
</style>
