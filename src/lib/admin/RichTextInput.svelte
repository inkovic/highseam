<script lang="ts">
	/**
	 * Block-based rich text editor — the Lexical-equivalent experience.
	 * The document is an array of typed nodes: text blocks (contenteditable
	 * with a restricted inline toolbar), lists, quotes, code, dividers, and
	 * EMBEDS: uploads, relationships, and config-defined components live
	 * inside the document flow. Serializes to JSON in a hidden input; the
	 * server re-sanitizes all inline HTML.
	 */
	import { tick } from 'svelte';
	import { htmlToNodes, markdownToNodes, pruneEmptyInline, type RichTextNode } from '$lib/core/richtext';
	import RelationPicker from './RelationPicker.svelte';
	import GalleryInput from './GalleryInput.svelte';
	import EmbedInput from './EmbedInput.svelte';
	import { matchEmbedProvider } from '$lib/core/embed';
	import type { ClientBlock, ClientField } from './client';
	import type { RelOption } from './server';

	type EditorNode = RichTextNode & { _key: string };
	type TextNodeType = 'p' | 'h2' | 'h3' | 'quote';
	const TEXT_TYPES: TextNodeType[] = ['p', 'h2', 'h3', 'quote'];

	let {
		field,
		value = undefined,
		relOptions = {},
		mediaAspects = [],
		galleryLayouts = []
	}: {
		field: ClientField;
		value?: unknown;
		relOptions?: Record<string, RelOption[]>;
		/** Aspect registry — placement vocabulary for upload nodes + the
		 *  in-context media edit modal. */
		mediaAspects?: { name: string; ratio: string; contexts?: string[] }[];
		/** Gallery layout vocabulary (cms.config → media.galleryLayouts). */
		galleryLayouts?: { name: string }[];
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

	function addNode(node: RichTextNode, after?: number): string {
		const withKey = { ...node, _key: key() } as EditorNode;
		if (after === undefined || after < 0 || after >= nodes.length) nodes.push(withKey);
		else nodes.splice(after + 1, 0, withKey);
		return withKey._key;
	}
	function remove(i: number) {
		nodes.splice(i, 1);
	}
	function move(i: number, dir: -1 | 1) {
		const j = i + dir;
		if (j < 0 || j >= nodes.length) return;
		[nodes[i], nodes[j]] = [nodes[j], nodes[i]];
	}
	function setType(i: number, type: TextNodeType) {
		const n = nodes[i];
		if ('html' in n) nodes[i] = { ...n, type } as EditorNode;
	}

	// --- caret / element plumbing -----------------------------------------------
	// Live contenteditable elements by node key, so structural ops can read the
	// DOM (the source of truth while a node is focused) and restore the caret.

	const els = new Map<string, HTMLElement>();
	let focusedIndex = $state<number | null>(null);

	function isEmptyHtml(html: string): boolean {
		return !html.replace(/<br\s*\/?>|&nbsp;|<[^>]+>|\s/gi, '');
	}
	function fragHtml(frag: DocumentFragment): string {
		const d = document.createElement('div');
		d.appendChild(frag);
		return pruneEmptyInline(d.innerHTML);
	}
	/** Prune the live element after an extract, keeping DOM and state in sync. */
	function pruneEl(el: HTMLElement): string {
		const cleaned = pruneEmptyInline(el.innerHTML);
		if (cleaned !== el.innerHTML) el.innerHTML = cleaned;
		return cleaned;
	}
	/** Place the caret in a node: at the start, the end, or a childNodes index. */
	async function focusNode(k: string, where: 'start' | 'end' | number = 'start') {
		await tick();
		const el = els.get(k);
		if (!el) return;
		el.focus();
		const r = document.createRange();
		if (where === 'end') {
			r.selectNodeContents(el);
			r.collapse(false);
		} else {
			r.setStart(el, where === 'start' ? 0 : Math.min(where, el.childNodes.length));
			r.collapse(true);
		}
		const sel = window.getSelection();
		sel?.removeAllRanges();
		sel?.addRange(r);
	}

	// --- 3.1 split on Enter ------------------------------------------------------
	// extractContents() mutates the live DOM: the tail leaves, so the element is
	// already the correct head. No re-key, no remount, no focus loss on the head.

	function splitAtCaret(el: HTMLElement, i: number) {
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0) return;
		const caret = sel.getRangeAt(0);
		if (!caret.collapsed) caret.deleteContents();

		const tailRange = document.createRange();
		tailRange.setStart(caret.startContainer, caret.startOffset);
		tailRange.setEnd(el, el.childNodes.length);
		const tailHtml = fragHtml(tailRange.extractContents());

		const cur = nodes[i];
		if ('html' in cur) cur.html = pruneEl(el);
		// Splitting a heading yields a paragraph — you're starting body copy.
		const newKey = addNode({ type: 'p', html: tailHtml }, i);
		focusNode(newKey, 'start');
	}

	// --- 3.2 merge on Backspace at node start ------------------------------------

	function caretAtStart(el: HTMLElement): boolean {
		const sel = window.getSelection();
		if (!sel || !sel.isCollapsed || sel.rangeCount === 0) return false;
		const r = sel.getRangeAt(0).cloneRange();
		r.setStart(el, 0);
		return r.toString().length === 0;
	}

	/** Returns true if it handled the keypress. */
	function mergeWithPrev(i: number): boolean {
		if (i === 0) return false;
		const cur = nodes[i];
		const prev = nodes[i - 1];
		if (!('html' in cur)) return false;

		// Previous node is an embed (upload / relationship / block / divider):
		// never concatenate text into it. Backspace on an empty node just
		// removes that node; a non-empty one is left alone.
		if (!('html' in prev)) {
			if (isEmptyHtml(cur.html)) {
				nodes.splice(i, 1);
				return true;
			}
			return false;
		}

		const prevEl = els.get(prev._key);
		if (prevEl) {
			const joinAt = prevEl.childNodes.length;
			if (cur.html) prevEl.insertAdjacentHTML('beforeend', cur.html);
			prev.html = prevEl.innerHTML; // DOM already updated → stays in sync
			nodes.splice(i, 1);
			focusNode(prev._key, joinAt);
		} else {
			prev.html = prev.html + cur.html;
			nodes.splice(i, 1);
		}
		return true;
	}

	// --- 3.3 selection-aware retype ----------------------------------------------
	// Toolbar buttons preventDefault on mousedown, so the text selection survives
	// the click — that's what makes "select a sentence → H2" work.

	function nodeElFromSelection(): { i: number; el: HTMLElement } | null {
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0) return null;
		let n: Node | null = sel.getRangeAt(0).startContainer;
		while (n) {
			if (n instanceof HTMLElement && n.dataset.hsNode) {
				const nodeKey = n.dataset.hsNode;
				const i = nodes.findIndex((x) => x._key === nodeKey);
				return i >= 0 ? { i, el: n } : null;
			}
			n = n.parentNode;
		}
		return null;
	}

	function applyType(type: TextNodeType) {
		const found = nodeElFromSelection();
		if (!found) {
			if (focusedIndex !== null && 'html' in (nodes[focusedIndex] ?? {})) setType(focusedIndex, type);
			return;
		}
		const { i, el } = found;
		const sel = window.getSelection()!;
		const range = sel.getRangeAt(0);

		// Collapsed (or selection spans the whole node): retype the node.
		if (range.collapsed) {
			setType(i, type);
			return;
		}

		// Sub-range: split into before / selected / after; the middle gets the
		// new type, empty parts are dropped.
		const afterRange = document.createRange();
		afterRange.setStart(range.endContainer, range.endOffset);
		afterRange.setEnd(el, el.childNodes.length);
		const afterHtml = fragHtml(afterRange.extractContents());

		const midRange = document.createRange();
		midRange.setStart(range.startContainer, range.startOffset);
		midRange.setEnd(el, el.childNodes.length);
		const midHtml = fragHtml(midRange.extractContents());

		const beforeHtml = pruneEl(el); // what's left in the live element
		const orig = nodes[i];
		if (!('html' in orig)) return;
		const origType = orig.type as TextNodeType;

		if (isEmptyHtml(midHtml)) return; // nothing meaningful selected

		orig.html = beforeHtml;
		const midKey = addNode({ type, html: midHtml }, i);
		if (!isEmptyHtml(afterHtml)) addNode({ type: origType, html: afterHtml }, i + 1);
		if (isEmptyHtml(beforeHtml)) nodes.splice(i, 1);
		focusNode(midKey, 'end');
	}

	// --- 3.5 markdown input rules ------------------------------------------------
	// Only fire when the marker is all that's been typed, so they can never eat
	// existing content mid-edit.

	function maybeInputRule(el: HTMLElement, i: number): boolean {
		const node = nodes[i];
		if (!('html' in node) || node.type !== 'p') return false;
		const text = (el.textContent ?? '').replace(/ /g, ' ');
		const heading: Record<string, TextNodeType> = { '## ': 'h2', '### ': 'h3', '> ': 'quote' };
		if (heading[text]) {
			el.innerHTML = '';
			nodes[i] = { ...node, type: heading[text], html: '' } as EditorNode;
			return true;
		}
		if (text === '- ' || text === '* ' || text === '1. ') {
			const listType = text === '1. ' ? 'ol' : 'ul';
			const newKey = key();
			nodes[i] = { type: listType, items: [''], _key: newKey } as EditorNode;
			focusNode(`${newKey}:0`, 'start');
			return true;
		}
		if (text === '---') {
			el.innerHTML = '';
			nodes[i] = { type: 'divider', _key: key() } as EditorNode;
			const newKey = addNode({ type: 'p', html: '' }, i);
			focusNode(newKey, 'start');
			return true;
		}
		return false;
	}

	function onTextInput(e: Event & { currentTarget: HTMLElement }, i: number) {
		const el = e.currentTarget;
		const node = nodes[i];
		if ('html' in node) node.html = el.innerHTML;
		maybeInputRule(el, i);
	}

	// --- keyboard: Enter/Backspace + type shortcuts + plain-text paste -----------

	let plainPasteNext = false;

	function onTextKeydown(e: KeyboardEvent & { currentTarget: HTMLElement }, i: number) {
		const el = e.currentTarget;
		const mod = e.metaKey || e.ctrlKey;

		if (mod && e.altKey && ['1', '2', '3'].includes(e.key)) {
			e.preventDefault();
			setType(i, e.key === '1' ? 'p' : e.key === '2' ? 'h2' : 'h3');
			return;
		}
		if (mod && e.shiftKey && e.key.toLowerCase() === 'v') {
			plainPasteNext = true; // consumed by the next paste event
			return;
		}
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			splitAtCaret(el, i);
			return;
		}
		if (e.key === 'Backspace' && caretAtStart(el)) {
			if (mergeWithPrev(i)) e.preventDefault();
		}
	}

	// --- paste: clipboard HTML / raw markup / multi-paragraph text -> nodes ----

	const BLOCKY_HTML = /<(p|h[1-6]|blockquote|ul|ol|li|pre|hr|div|table)\b/i;

	function clipboardToNodes(e: ClipboardEvent, plainOnly = false): RichTextNode[] | null {
		const html = plainOnly ? '' : (e.clipboardData?.getData('text/html') ?? '');
		const text = (e.clipboardData?.getData('text/plain') ?? '').trim();
		if (html && BLOCKY_HTML.test(html)) return htmlToNodes(html);
		if (plainOnly && text) {
			// Cmd/Ctrl+Shift+V: discard source markup entirely.
			const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
			return text
				.split(/\n{2,}/)
				.map((b) => ({ type: 'p', html: esc(b.trim()).replace(/\n/g, '<br>') }) as RichTextNode)
				.filter((n) => 'html' in n && n.html);
		}
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
		const plainOnly = plainPasteNext;
		plainPasteNext = false;
		// The QoL moment: pasting a bare provider URL into an empty paragraph
		// becomes an embed node (when the field allows embeds).
		if (allowEmbeds) {
			const text = (e.clipboardData?.getData('text/plain') ?? '').trim();
			if (text && !/\s/.test(text) && matchEmbedProvider(text)) {
				const cur = nodes[i];
				const curEmpty = cur && 'html' in cur && !cur.html.replace(/<br\s*\/?>|&nbsp;|\s/gi, '');
				if (curEmpty) {
					e.preventDefault();
					nodes.splice(i, 1, { type: 'embed', url: text, _key: key() } as EditorNode);
					return;
				}
			}
		}
		const parsed = clipboardToNodes(e, plainOnly);
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
	// svelte-ignore state_referenced_locally — field config is static per instance
	const allowEmbeds = Boolean(field.embeds);
	// Per-placement aspect vocabulary: registry entries scoped to 'placement'
	// (or unscoped). 'Natural' is always present — it's the absent value.
	const placementAspects = $derived(
		mediaAspects.filter((a) => !a.contexts || a.contexts.includes('placement'))
	);
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
			? [
					{ label: '🖼 Image', make: () => ({ type: 'upload', relationTo: uploadsSlug, value: '' }) as RichTextNode },
					{ label: '🖼🖼 Gallery', make: () => ({ type: 'gallery', relationTo: uploadsSlug, items: [] }) as RichTextNode }
				]
			: []),
		...(allowEmbeds
			? [{ label: '▶ Embed', make: () => ({ type: 'embed', url: '' }) as RichTextNode }]
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

	/**
	 * One-shot: paint innerHTML at mount and register the element so structural
	 * ops can read/repair the DOM. It deliberately does NOT react to later
	 * html changes — the DOM is the source of truth while a node is focused.
	 * Operations that change html programmatically either update the element
	 * directly (merge) or give the node a fresh _key to force a remount.
	 */
	function editable(el: HTMLElement, param: { html: string; key: string }) {
		el.innerHTML = param.html;
		els.set(param.key, el);
		return {
			destroy() {
				if (els.get(param.key) === el) els.delete(param.key);
			}
		};
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
			<span class="mx-1 h-4 w-px bg-(--color-border)"></span>
			<!-- Block type: applies to the selection (splitting the node if it's a
			     sub-range) or to the focused node. mousedown-preventDefault keeps
			     the text selection alive across the click. -->
			<button type="button" class={toolBtn} title="Paragraph (⌘⌥1)" onmousedown={(e) => e.preventDefault()} onclick={() => applyType('p')}>Text</button>
			<button type="button" class="{toolBtn} font-semibold" title="Heading 2 (⌘⌥2)" onmousedown={(e) => e.preventDefault()} onclick={() => applyType('h2')}>H2</button>
			<button type="button" class="{toolBtn} font-semibold" title="Heading 3 (⌘⌥3)" onmousedown={(e) => e.preventDefault()} onclick={() => applyType('h3')}>H3</button>
			<button type="button" class={toolBtn} title="Quote" onmousedown={(e) => e.preventDefault()} onclick={() => applyType('quote')}>❝</button>
			<span class="ml-auto text-[10px] text-(--color-muted)">{nodes.length} nodes</span>
		</div>

		<div class="divide-y divide-(--color-border)">
			{#each nodes as node, i (node._key)}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="group/node relative" onfocusin={() => (focusedIndex = i)}>
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
							data-hs-node={node._key}
							use:editable={{ html: node.html, key: node._key }}
							oninput={(e) => onTextInput(e, i)}
							onkeydown={(e) => onTextKeydown(e, i)}
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
										use:editable={{ html: item, key: `${node._key}:${j}` }}
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
					{:else if node.type === 'gallery'}
						<div class="bg-(--color-elevate-2)/50 px-3 py-2">
							<div class="mb-1 flex items-center gap-3">
								<span class="text-xs font-semibold tracking-wide text-(--color-primary) uppercase">Gallery</span>
								{#if galleryLayouts.length > 0}
									<label class="flex items-center gap-1.5 text-[11px] text-(--color-muted)">
										layout
										<select
											class="rounded-(--radius) border border-(--color-border) bg-(--color-elevate) px-1.5 py-0.5 text-[11px] text-(--color-fg) focus:border-(--color-primary) focus:outline-none"
											value={node.fields?.layout ?? ''}
											onchange={(e) => {
												const v = e.currentTarget.value;
												const f = { ...(node.fields ?? {}) };
												if (v) f.layout = v;
												else delete f.layout;
												node.fields = f.layout || f.aspect ? f : undefined;
											}}
										>
											<option value="">default</option>
											{#each galleryLayouts as l (l.name)}
												<option value={l.name}>{l.name}</option>
											{/each}
										</select>
									</label>
								{/if}
								{#if placementAspects.length > 0}
									<label class="ml-auto flex items-center gap-1.5 text-[11px] text-(--color-muted)">
										aspect
										<select
											class="rounded-(--radius) border border-(--color-border) bg-(--color-elevate) px-1.5 py-0.5 text-[11px] text-(--color-fg) focus:border-(--color-primary) focus:outline-none"
											value={node.fields?.aspect ?? ''}
											onchange={(e) => {
												const v = e.currentTarget.value;
												const f = { ...(node.fields ?? {}) };
												if (v) f.aspect = v;
												else delete f.aspect;
												node.fields = f.layout || f.aspect ? f : undefined;
											}}
										>
											<option value="">natural</option>
											{#each placementAspects as a (a.name)}
												<option value={a.ratio}>{a.name} · {a.ratio}</option>
											{/each}
										</select>
									</label>
								{/if}
							</div>
							<GalleryInput
								name="_rt_gallery"
								relationTo={node.relationTo}
								value={node.items}
								submitHidden={false}
								onChange={(v) => (node.items = v)}
								{mediaAspects}
							/>
						</div>
					{:else if node.type === 'embed'}
						<div class="bg-(--color-elevate-2)/50 px-3 py-2">
							<span class="mb-1 block text-xs font-semibold tracking-wide text-(--color-primary) uppercase">Embed</span>
							<div class="max-w-lg">
								<EmbedInput
									name="_rt_embed"
									value={node}
									submitHidden={false}
									onChange={(v) => {
										node.url = v?.url ?? '';
										node.provider = v?.provider;
										node.embedId = v?.embedId;
										node.title = v?.title;
										node.thumbUrl = v?.thumbUrl;
									}}
								/>
							</div>
						</div>
					{:else if node.type === 'upload'}
						<div class="bg-(--color-elevate-2)/50 px-3 py-2">
							<div class="mb-1 flex items-center gap-3">
								<span class="text-xs font-semibold tracking-wide text-(--color-primary) uppercase">Image</span>
								{#if node.value && placementAspects.length > 0}
									<!-- Per-placement presentation: this use of the image, not
									     the image itself. Absent = natural aspect. -->
									<label class="ml-auto flex items-center gap-1.5 text-[11px] text-(--color-muted)">
										aspect
										<select
											class="rounded-(--radius) border border-(--color-border) bg-(--color-elevate) px-1.5 py-0.5 text-[11px] text-(--color-fg) focus:border-(--color-primary) focus:outline-none"
											value={node.fields?.aspect ?? ''}
											onchange={(e) => {
												const v = e.currentTarget.value;
												node.fields = v ? { aspect: v } : undefined;
											}}
										>
											<option value="">natural</option>
											{#each placementAspects as a (a.name)}
												<option value={a.ratio}>{a.name} · {a.ratio}</option>
											{/each}
										</select>
									</label>
								{/if}
							</div>
							<div class="max-w-sm">
								<RelationPicker
									name="_rt_upload"
									options={optionsFor(node.relationTo)}
									value={node.value}
									relationTo={node.relationTo}
									searchUrl="/api/{node.relationTo}/options"
									uploadUrl="/api/{node.relationTo}"
									submitHidden={false}
									onChange={(ids) => (node.value = ids[0] ?? '')}
									editable={true}
									{mediaAspects}
									previewAspect={node.fields?.aspect}
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
													uploadUrl={sub.type === 'upload' && sub.relationTo ? `/api/${sub.relationTo}` : ''}
													submitHidden={false}
													onChange={(ids) => (node.fields[sub.name] = sub.hasMany ? ids : (ids[0] ?? ''))}
													editable={sub.type === 'upload'}
													{mediaAspects}
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
					onclick={() => addNode(item.make(), focusedIndex ?? undefined)}
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
