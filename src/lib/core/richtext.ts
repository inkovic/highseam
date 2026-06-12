/**
 * Structured rich text — svelte-payload's Lexical equivalent.
 *
 * A document is an array of typed nodes. Text-bearing nodes carry a
 * restricted inline-HTML string (strong/em/code/a/s/u/br only — enforced
 * server-side by sanitizeNodes). Embeds are first-class nodes: uploads,
 * relationships, and config-defined blocks live INSIDE the document flow.
 */
import type { BlockConfig, RichTextField } from './types';

export type RichTextNode =
	| { type: 'p'; html: string }
	| { type: 'h2'; html: string }
	| { type: 'h3'; html: string }
	| { type: 'quote'; html: string }
	| { type: 'ul'; items: string[] }
	| { type: 'ol'; items: string[] }
	| { type: 'code'; code: string }
	| { type: 'divider' }
	| { type: 'upload'; relationTo: string; value: string }
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
	'relationship',
	'block'
] as const;

// ---------------------------------------------------------------------------
// Inline HTML sanitizer (no DOM required — runs on Node and Workers)
// ---------------------------------------------------------------------------

const ALLOWED_INLINE = ['strong', 'em', 'code', 'a', 's', 'u', 'br', 'b', 'i'];

export function sanitizeInlineHtml(html: string): string {
	if (typeof html !== 'string') return '';
	const allowed = ALLOWED_INLINE.join('|');
	// Drop any tag not in the whitelist (keeps inner text).
	let out = html.replace(new RegExp(`<(?!\\/?(?:${allowed})(?:[\\s/>]))[^>]*>`, 'gi'), '');
	// <a>: keep only a safe href attribute.
	out = out.replace(/<a\b[^>]*>/gi, (tag) => {
		const m = tag.match(/href\s*=\s*("([^"]*)"|'([^']*)')/i);
		const href = (m?.[2] ?? m?.[3] ?? '').trim();
		if (!href || /^\s*javascript:/i.test(href)) return '<a>';
		return `<a href="${href.replace(/"/g, '&quot;')}" rel="noopener">`;
	});
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
			case 'upload':
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
