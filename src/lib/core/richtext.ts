/**
 * Structured rich text — highseam's Lexical equivalent.
 *
 * A document is an array of typed nodes. Text-bearing nodes carry a
 * restricted inline-HTML string (strong/em/code/a/s/u/br only — enforced
 * server-side by sanitizeNodes). Embeds are first-class nodes: uploads,
 * relationships, and config-defined blocks live INSIDE the document flow.
 */
import type { BlockConfig, RichTextField } from './types';

/**
 * Mirrors core/media parseRatio's grammar ('16:9', '4/3', '1200x630').
 * Inlined so this module stays free of runtime imports (it runs standalone
 * on Node and Workers).
 */
const RATIO_RE = /^(\d+(?:\.\d+)?)\s*[:/x]\s*(\d+(?:\.\d+)?)$/;
function isRatio(s: string): boolean {
	const m = RATIO_RE.exec(s.trim());
	return m !== null && Number(m[1]) > 0 && Number(m[2]) > 0;
}

export type RichTextNode =
	| { type: 'p'; html: string }
	| { type: 'h2'; html: string }
	| { type: 'h3'; html: string }
	| { type: 'quote'; html: string }
	| { type: 'ul'; items: string[] }
	| { type: 'ol'; items: string[] }
	| { type: 'code'; code: string }
	| { type: 'divider' }
	| {
			type: 'gallery';
			relationTo: string;
			/** Ordered refs with per-item overrides (resolveMedia precedence). */
			items: { id: string; alt?: string; caption?: string }[];
			/** Presentation, not identity: layout name from media.galleryLayouts,
			 *  optional per-item aspect from media.aspects. */
			fields?: { layout?: string; aspect?: string };
	  }
	| {
			type: 'upload';
			relationTo: string;
			value: string;
			/**
			 * Per-placement presentation, not identity. `aspect` is a ratio
			 * string ('16:9'); absent = render at natural aspect. The media
			 * doc keeps the focal point; the renderer crops this USE of it.
			 */
			fields?: { aspect?: string };
	  }
	| {
			type: 'embed';
			/** The pasted URL — the durable source of truth. */
			url: string;
			/** Filled by server-side resolution at save (embed registry). */
			provider?: string;
			embedId?: string;
			title?: string;
			thumbUrl?: string;
	  }
	| { type: 'relationship'; relationTo: string; value: string }
	| { type: 'block'; blockType: string; fields: Record<string, unknown> };

export const TEXT_NODE_TYPES = ['p', 'h2', 'h3', 'quote'] as const;
export const ALL_NODE_TYPES = [
	...TEXT_NODE_TYPES,
	'ul',
	'ol',
	'code',
	'divider',
	'upload',
	'gallery',
	'embed',
	'relationship',
	'block'
] as const;

// ---------------------------------------------------------------------------
// Inline HTML sanitizer (no DOM required — runs on Node and Workers)
// ---------------------------------------------------------------------------

const ALLOWED_INLINE = ['strong', 'em', 'code', 'a', 's', 'u', 'br', 'b', 'i'];

/** rel tokens preserved on <a> (the rest are dropped). */
const ALLOWED_REL = new Set(['nofollow', 'noopener', 'noreferrer', 'sponsored', 'ugc']);

const attr = (tag: string, name: string): string =>
	(tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'))?.[2] ??
		tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'))?.[3] ??
		'').trim();

/**
 * Rebuild an <a> tag keeping a safe href, a whitelist of rel tokens
 * (nofollow/noopener/noreferrer/sponsored/ugc), and target="_blank". SEO
 * attributes written by content pipelines survive a sanitize pass; scripts
 * and unsafe schemes do not.
 */
export function safeAnchorOpen(tag: string): string {
	const href = attr(tag, 'href');
	if (!href || /^\s*(javascript|data|vbscript):/i.test(href)) return '<a>';
	const rel = new Set(
		attr(tag, 'rel')
			.toLowerCase()
			.split(/\s+/)
			.filter((t) => ALLOWED_REL.has(t))
	);
	const targetBlank = attr(tag, 'target').toLowerCase() === '_blank';
	if (targetBlank) rel.add('noopener'); // safety pairing for target=_blank
	const relAttr = rel.size ? ` rel="${[...rel].join(' ')}"` : '';
	const targetAttr = targetBlank ? ' target="_blank"' : '';
	return `<a href="${href.replace(/"/g, '&quot;')}"${relAttr}${targetAttr}>`;
}

export function sanitizeInlineHtml(html: string): string {
	if (typeof html !== 'string') return '';
	const allowed = ALLOWED_INLINE.join('|');
	// Drop any tag not in the whitelist (keeps inner text).
	let out = html.replace(new RegExp(`<(?!\\/?(?:${allowed})(?:[\\s/>]))[^>]*>`, 'gi'), '');
	// <a>: keep safe href + rel whitelist + target=_blank.
	out = out.replace(/<a\b[^>]*>/gi, (tag) => safeAnchorOpen(tag));
	// Strip attributes from all other allowed tags.
	out = out.replace(
		new RegExp(`<(${allowed.replace('a|', '').replace('|a', '')})\\b[^>]*>`, 'gi'),
		'<$1>'
	);
	// Normalize b/i to strong/em.
	out = out
		.replace(/<(\/?)b>/gi, '<$1strong>')
		.replace(/<(\/?)i>/gi, '<$1em>')
		.replace(/&nbsp;/g, ' ');
	return out;
}

// ---------------------------------------------------------------------------
// Document-level HTML sanitizer (for `html` fields)
// ---------------------------------------------------------------------------

const ALLOWED_BLOCK = [
	'p',
	'h1',
	'h2',
	'h3',
	'h4',
	'ul',
	'ol',
	'li',
	'blockquote',
	'pre',
	'hr',
	'figure',
	'figcaption',
	'img',
	'div',
	'span',
	'table',
	'thead',
	'tbody',
	'tr',
	'th',
	'td'
];

/**
 * Sanitize a full HTML document fragment: scripts/styles removed with their
 * content, tag whitelist, attributes stripped except safe href/src/alt.
 */
export function sanitizeDocumentHtml(html: string): string {
	if (typeof html !== 'string') return '';
	let out = html
		.replace(/<script[\s\S]*?<\/script\s*>/gi, '')
		.replace(/<style[\s\S]*?<\/style\s*>/gi, '')
		.replace(/<!--[\s\S]*?-->/g, '');

	const allowed = [...ALLOWED_BLOCK, ...ALLOWED_INLINE].join('|');
	out = out.replace(new RegExp(`<(?!\\/?(?:${allowed})(?:[\\s/>]))[^>]*>`, 'gi'), '');

	// <a>: safe href + rel whitelist + target=_blank. <img src/alt>: safe scheme.
	out = out.replace(/<a\b[^>]*>/gi, (tag) => safeAnchorOpen(tag));
	out = out.replace(/<img\b[^>]*>/gi, (tag) => {
		const src = (tag.match(/src\s*=\s*("([^"]*)"|'([^']*)')/i)?.[2] ?? '').trim();
		const alt = (tag.match(/alt\s*=\s*("([^"]*)"|'([^']*)')/i)?.[2] ?? '').trim();
		if (!src || /^\s*(javascript|data):/i.test(src)) return '';
		return `<img src="${src.replace(/"/g, '&quot;')}" alt="${alt.replace(/"/g, '&quot;')}">`;
	});
	// Strip attributes from every other allowed tag.
	const noAttr = [...ALLOWED_BLOCK, ...ALLOWED_INLINE].filter((t) => t !== 'a' && t !== 'img');
	out = out.replace(new RegExp(`<(${noAttr.join('|')})\\b[^>]*>`, 'gi'), '<$1>');
	return out;
}

/** Sanitize a full node array in place-safe fashion. Unknown nodes are dropped. */
export function sanitizeNodes(value: unknown): RichTextNode[] {
	if (!Array.isArray(value)) return [];
	const out: RichTextNode[] = [];
	for (const raw of value) {
		if (!raw || typeof raw !== 'object') continue;
		const node = raw as Record<string, unknown>;
		switch (node.type) {
			case 'p':
			case 'h2':
			case 'h3':
			case 'quote':
				out.push({ type: node.type, html: sanitizeInlineHtml(String(node.html ?? '')) });
				break;
			case 'ul':
			case 'ol':
				out.push({
					type: node.type,
					items: (Array.isArray(node.items) ? node.items : []).map((i) =>
						sanitizeInlineHtml(String(i ?? ''))
					)
				});
				break;
			case 'code':
				out.push({ type: 'code', code: String(node.code ?? '') });
				break;
			case 'divider':
				out.push({ type: 'divider' });
				break;
			case 'upload': {
				if (typeof node.value === 'string' && typeof node.relationTo === 'string') {
					const clean: Extract<RichTextNode, { type: 'upload' }> = { type: 'upload', relationTo: node.relationTo, value: node.value };
					// Presentation whitelist: keep fields.aspect only if it's a
					// parseable ratio. Everything else on `fields` is dropped.
					const aspect = (node.fields as Record<string, unknown> | undefined)?.aspect;
					if (typeof aspect === 'string' && isRatio(aspect)) clean.fields = { aspect };
					out.push(clean);
				}
				break;
			}
			case 'gallery': {
				if (typeof node.relationTo !== 'string') break;
				const rawItems = (node as { items?: unknown }).items;
				if (!Array.isArray(rawItems)) break;
				const items: { id: string; alt?: string; caption?: string }[] = [];
				for (const raw of rawItems) {
					// Upgrade path: bare id strings lift to the item shape.
					if (typeof raw === 'string' && raw) {
						items.push({ id: raw });
						continue;
					}
					if (typeof raw !== 'object' || raw === null) continue;
					const it = raw as Record<string, unknown>;
					if (typeof it.id !== 'string' || !it.id) continue;
					const item: { id: string; alt?: string; caption?: string } = { id: it.id };
					if (typeof it.alt === 'string') item.alt = it.alt;
					if (typeof it.caption === 'string') item.caption = it.caption;
					items.push(item);
				}
				const clean: Extract<RichTextNode, { type: 'gallery' }> = {
					type: 'gallery',
					relationTo: node.relationTo,
					items
				};
				const nf = (node as { fields?: Record<string, unknown> }).fields;
				const fields: { layout?: string; aspect?: string } = {};
				if (typeof nf?.layout === 'string' && /^[\w-]{1,40}$/.test(nf.layout)) fields.layout = nf.layout;
				if (typeof nf?.aspect === 'string' && isRatio(nf.aspect)) fields.aspect = nf.aspect;
				if (fields.layout || fields.aspect) clean.fields = fields;
				out.push(clean);
				break;
			}
			case 'embed': {
				const u = typeof node.url === 'string' ? node.url.trim() : '';
				if (!/^https?:\/\//i.test(u)) break;
				const clean: Extract<RichTextNode, { type: 'embed' }> = { type: 'embed', url: u };
				if (typeof node.provider === 'string' && /^[\w-]{1,40}$/.test(node.provider))
					clean.provider = node.provider;
				if (typeof node.embedId === 'string' && node.embedId.length <= 200)
					clean.embedId = node.embedId;
				if (typeof node.title === 'string') clean.title = node.title.slice(0, 300);
				if (typeof node.thumbUrl === 'string' && /^https:\/\//.test(node.thumbUrl))
					clean.thumbUrl = node.thumbUrl;
				out.push(clean);
				break;
			}
			case 'relationship':
				if (typeof node.value === 'string' && typeof node.relationTo === 'string') {
					out.push({ type: node.type, relationTo: node.relationTo, value: node.value });
				}
				break;
			case 'block':
				if (typeof node.blockType === 'string') {
					out.push({
						type: 'block',
						blockType: node.blockType,
						fields:
							node.fields && typeof node.fields === 'object'
								? (node.fields as Record<string, unknown>)
								: {}
					});
				}
				break;
		}
	}
	return out;
}

/**
 * Validate embedded block nodes against the field's block configs.
 * Returns an error string or null. (Inline html is already sanitized.)
 */
export function validateRichTextNodes(
	nodes: RichTextNode[],
	field: Pick<RichTextField, 'blocks' | 'uploads' | 'relationships'>,
	validateBlockFields: (block: BlockConfig, fields: Record<string, unknown>) => string | null
): string | null {
	for (const [i, node] of nodes.entries()) {
		if (node.type === 'block') {
			const block = (field.blocks ?? []).find((b) => b.slug === node.blockType);
			if (!block) return `Node ${i + 1}: unknown component "${node.blockType}"`;
			const err = validateBlockFields(block, node.fields);
			if (err) return `${block.slug} (node ${i + 1}): ${err}`;
		}
		if (node.type === 'upload' && field.uploads && node.relationTo !== field.uploads)
			return `Node ${i + 1}: uploads must reference "${field.uploads}"`;
		if (node.type === 'gallery' && field.uploads && node.relationTo !== field.uploads)
			return `Node ${i + 1}: gallery must reference "${field.uploads}"`;
		if (
			node.type === 'relationship' &&
			field.relationships &&
			!field.relationships.includes(node.relationTo)
		)
			return `Node ${i + 1}: relationship to "${node.relationTo}" not allowed`;
	}
	return null;
}

/** Collect upload/relationship references so consumers can resolve them. */
export function extractRichTextRefs(value: unknown): { relationTo: string; id: string }[] {
	if (!Array.isArray(value)) return [];
	const refs: { relationTo: string; id: string }[] = [];
	for (const node of value as RichTextNode[]) {
		if ((node.type === 'upload' || node.type === 'relationship') && node.value) {
			refs.push({ relationTo: node.relationTo, id: node.value });
		}
		if (node.type === 'gallery') {
			for (const item of node.items ?? []) {
				if (item?.id) refs.push({ relationTo: node.relationTo, id: item.id });
			}
		}
	}
	return refs;
}

/** Best-effort conversion of legacy markdown strings into nodes (for the editor). */
export function markdownToNodes(md: string): RichTextNode[] {
	const esc = (s: string) =>
		s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	const inline = (s: string) =>
		esc(s)
			.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
			.replace(/\*([^*]+)\*/g, '<em>$1</em>')
			.replace(/`([^`]+)`/g, '<code>$1</code>')
			.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" rel="noopener">$1</a>');

	const nodes: RichTextNode[] = [];
	const blocks = md.split(/\n{2,}/);
	for (const raw of blocks) {
		const b = raw.trim();
		if (!b) continue;
		const codeMatch = b.match(/^```\w*\n?([\s\S]*?)```$/);
		if (codeMatch) {
			nodes.push({ type: 'code', code: codeMatch[1].trim() });
		} else if (b.startsWith('### ')) {
			nodes.push({ type: 'h3', html: inline(b.slice(4)) });
		} else if (b.startsWith('## ')) {
			nodes.push({ type: 'h2', html: inline(b.slice(3)) });
		} else if (b.startsWith('> ')) {
			nodes.push({ type: 'quote', html: inline(b.replace(/^> /gm, '')) });
		} else if (/^- /m.test(b)) {
			nodes.push({ type: 'ul', items: b.split('\n').map((l) => inline(l.replace(/^- /, ''))) });
		} else if (/^\d+\. /m.test(b)) {
			nodes.push({
				type: 'ol',
				items: b.split('\n').map((l) => inline(l.replace(/^\d+\. /, '')))
			});
		} else if (b === '---') {
			nodes.push({ type: 'divider' });
		} else {
			nodes.push({ type: 'p', html: inline(b).replace(/\n/g, '<br>') });
		}
	}
	return nodes;
}


/**
 * Remove empty inline wrappers (browser-only).
 *
 * `Range.extractContents()` correctly closes and reopens inline tags when a
 * cut lands inside them, but it leaves an empty shell on the far side of the
 * boundary — splitting `<strong>Title</strong> body` right after `Title`
 * yields `<strong></strong> body`. Harmless to render, but it accumulates
 * with every split and pollutes the stored HTML, so prune it.
 */
export function pruneEmptyInline(html: string): string {
	const container = document.createElement('div');
	container.innerHTML = html;
	const INLINE = new Set(['STRONG', 'EM', 'CODE', 'A', 'S', 'U', 'B', 'I']);
	let changed = true;
	while (changed) {
		changed = false;
		for (const node of Array.from(container.querySelectorAll('*'))) {
			if (!INLINE.has(node.tagName)) continue;
			if (node.querySelector('br, img')) continue; // carries content
			if ((node.textContent ?? '') !== '') continue;
			node.remove();
			changed = true;
		}
	}
	return container.innerHTML;
}

// ---------------------------------------------------------------------------
// HTML -> nodes (editor-side paste & import; browser-only, uses DOMParser)
// ---------------------------------------------------------------------------

const INLINE_TAGS = new Set(['SPAN', 'STRONG', 'EM', 'A', 'CODE', 'B', 'I', 'U', 'S', 'BR', 'SUB', 'SUP', 'SMALL', 'MARK']);

/**
 * Best-effort conversion of arbitrary HTML (a pasted page fragment, a raw
 * rich_html string, a Word/Google-Docs clipboard payload) into typed nodes.
 * Block structure maps to node types; inline HTML is run through
 * sanitizeInlineHtml per block. Images/figures are skipped on purpose:
 * uploads are first-class nodes the author places deliberately.
 */
export function htmlToNodes(html: string): RichTextNode[] {
	if (typeof html !== 'string' || !html.trim() || typeof DOMParser === 'undefined') return [];
	const doc = new DOMParser().parseFromString(html, 'text/html');

	// Style-only emphasis (Google Docs / Word spans) -> real marks, so the
	// inline sanitizer keeps them when it strips the spans themselves.
	for (const span of Array.from(doc.querySelectorAll('span[style]'))) {
		const style = (span.getAttribute('style') ?? '').toLowerCase();
		const bold = /font-weight\s*:\s*(bold|[6-9]00)/.test(style);
		const italic = /font-style\s*:\s*italic/.test(style);
		if (!bold && !italic) continue;
		let inner = span.innerHTML;
		if (italic) inner = `<em>${inner}</em>`;
		if (bold) inner = `<strong>${inner}</strong>`;
		span.outerHTML = inner;
	}

	const nodes: RichTextNode[] = [];
	const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
	const pushText = (type: 'p' | 'h2' | 'h3' | 'quote', raw: string) => {
		const clean = sanitizeInlineHtml(raw).trim();
		if (clean.replace(/<br\s*\/?>|&nbsp;/gi, '').trim()) nodes.push({ type, html: clean });
	};
	const listItems = (el: Element): string[] =>
		Array.from(el.querySelectorAll(':scope > li'))
			.map((li) => sanitizeInlineHtml(li.innerHTML).trim())
			.filter(Boolean);

	const walk = (root: ParentNode) => {
		let run: string[] = [];
		const flush = () => {
			if (run.length) pushText('p', run.join(''));
			run = [];
		};
		for (const child of Array.from(root.childNodes)) {
			if (child.nodeType === 3) {
				if ((child.textContent ?? '').trim()) run.push(esc(child.textContent ?? ''));
				continue;
			}
			if (child.nodeType !== 1) continue;
			const el = child as Element;
			if (INLINE_TAGS.has(el.tagName)) {
				run.push(el.tagName === 'BR' ? '<br>' : el.outerHTML);
				continue;
			}
			flush();
			switch (el.tagName) {
				case 'P':
					pushText('p', el.innerHTML);
					break;
				case 'H1':
				case 'H2':
					pushText('h2', el.innerHTML);
					break;
				case 'H3':
				case 'H4':
				case 'H5':
				case 'H6':
					pushText('h3', el.innerHTML);
					break;
				case 'BLOCKQUOTE': {
					const ps = Array.from(el.querySelectorAll(':scope > p'));
					pushText('quote', ps.length ? ps.map((p) => p.innerHTML).join('<br>') : el.innerHTML);
					break;
				}
				case 'UL': {
					const items = listItems(el);
					if (items.length) nodes.push({ type: 'ul', items });
					break;
				}
				case 'OL': {
					const items = listItems(el);
					if (items.length) nodes.push({ type: 'ol', items });
					break;
				}
				case 'PRE': {
					const code = (el.textContent ?? '').trim();
					if (code) nodes.push({ type: 'code', code });
					break;
				}
				case 'HR':
					nodes.push({ type: 'divider' });
					break;
				case 'IMG':
				case 'FIGURE':
				case 'SCRIPT':
				case 'STYLE':
				case 'META':
				case 'LINK':
				case 'TITLE':
					break;
				default:
					walk(el); // div/section/table/li wrappers: recurse
			}
		}
		flush();
	};
	walk(doc.body);
	return nodes;
}
