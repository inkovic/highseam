/**
 * Version compare (1.7.4): two document snapshots → per-field diffs the admin
 * shows side by side with the version list. Word-level for text; for rich
 * text and HTML, a line (paragraph) diff with a word diff inside each changed
 * paragraph; JSON lines for everything else. Pure, no Svelte, so it is
 * unit-tested by scripts/test-diff.mjs.
 */
import type { ClientBlock, ClientField } from './client';

export type Op = { t: 'eq' | 'del' | 'ins'; v: string };
export type Row =
	| { t: 'eq' | 'del' | 'ins'; v: string }
	| { t: 'mod'; ops: Op[] }
	| { t: 'skip'; n: number };
export type FieldDiff =
	| { name: string; label: string; kind: 'text'; ops: Op[] }
	| { name: string; label: string; kind: 'lines'; rows: Row[] }
	| { name: string; label: string; kind: 'value'; before: string; after: string };

type Doc = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Myers O(ND) diff over token arrays
// ---------------------------------------------------------------------------

/** Replace-all instead of diffing once the work would get large (a full
 *  rewrite reads fine as "all removed, all added" anyway). */
const WORK_CAP = 6_000_000;

export function diffTokens(a: string[], b: string[]): Op[] {
	let pre = 0;
	while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
	let suf = 0;
	while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
	const eq = (v: string): Op => ({ t: 'eq', v });
	return [
		...a.slice(0, pre).map(eq),
		...myers(a.slice(pre, a.length - suf), b.slice(pre, b.length - suf)),
		...a.slice(a.length - suf).map(eq)
	];
}

function myers(a: string[], b: string[]): Op[] {
	const n = a.length;
	const m = b.length;
	const del = (v: string): Op => ({ t: 'del', v });
	const ins = (v: string): Op => ({ t: 'ins', v });
	if (!n) return b.map(ins);
	if (!m) return a.map(del);
	const max = n + m;
	const off = max + 1;
	const v = new Int32Array(2 * max + 3);
	v[off + 1] = 0;
	const trace: Int32Array[] = [];
	for (let d = 0; d <= max; d++) {
		if (d * max > WORK_CAP) return [...a.map(del), ...b.map(ins)];
		trace.push(v.slice());
		for (let k = -d; k <= d; k += 2) {
			let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
			let y = x - k;
			while (x < n && y < m && a[x] === b[y]) {
				x++;
				y++;
			}
			v[off + k] = x;
			if (x >= n && y >= m) return backtrack(trace, a, b, off);
		}
	}
	return [...a.map(del), ...b.map(ins)];
}

function backtrack(trace: Int32Array[], a: string[], b: string[], off: number): Op[] {
	const ops: Op[] = [];
	let x = a.length;
	let y = b.length;
	for (let d = trace.length - 1; d >= 0; d--) {
		const v = trace[d];
		const k = x - y;
		const prevK = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? k + 1 : k - 1;
		const prevX = v[off + prevK];
		const prevY = prevX - prevK;
		while (x > prevX && y > prevY) {
			ops.push({ t: 'eq', v: a[x - 1] });
			x--;
			y--;
		}
		if (d > 0) {
			if (x === prevX) ops.push({ t: 'ins', v: b[y - 1] });
			else ops.push({ t: 'del', v: a[x - 1] });
		}
		x = prevX;
		y = prevY;
	}
	return ops.reverse();
}

/** Words, runs of whitespace, and single punctuation marks. */
export function words(s: string): string[] {
	return s.match(/\s+|[\p{L}\p{N}_'’-]+|[^\s\p{L}\p{N}_]/gu) ?? [];
}

/** Merge neighbouring ops of the same kind (fewer spans to render). */
function merge(ops: Op[]): Op[] {
	const out: Op[] = [];
	for (const op of ops) {
		const last = out[out.length - 1];
		if (last && last.t === op.t) last.v += op.v;
		else out.push({ ...op });
	}
	return out;
}

/**
 * Readability pass: an unchanged sliver between two changes (a space, "a",
 * ", ") joins the change, and each changed stretch reads as all-removed then
 * all-added. Without it a rewritten sentence interleaves word by word
 * ("~~Old~~The ~~summary~~one …").
 */
function cleanup(ops: Op[]): Op[] {
	const m = merge(ops);
	const absorbed: Op[] = [];
	m.forEach((o, i) => {
		const between = i > 0 && i < m.length - 1 && m[i - 1].t !== 'eq' && m[i + 1].t !== 'eq';
		if (o.t === 'eq' && between && o.v.trim().length <= 2) absorbed.push({ t: 'del', v: o.v }, { t: 'ins', v: o.v });
		else absorbed.push(o);
	});
	const out: Op[] = [];
	for (let i = 0; i < absorbed.length; ) {
		if (absorbed[i].t === 'eq') {
			out.push(absorbed[i++]);
			continue;
		}
		let del = '';
		let ins = '';
		while (i < absorbed.length && absorbed[i].t !== 'eq') {
			if (absorbed[i].t === 'del') del += absorbed[i].v;
			else ins += absorbed[i].v;
			i++;
		}
		if (del) out.push({ t: 'del', v: del });
		if (ins) out.push({ t: 'ins', v: ins });
	}
	return merge(out);
}

export function diffWords(a: string, b: string): Op[] {
	return cleanup(diffTokens(words(a), words(b)));
}

/**
 * Line diff for rich text / HTML / JSON: removed-then-added runs are paired
 * into word-diffed "mod" rows; unchanged stretches keep one line of context
 * each side and collapse the rest.
 */
export function diffLines(a: string[], b: string[], context = 1): Row[] {
	const ops = diffTokens(a, b);
	const rows: Row[] = [];
	for (let i = 0; i < ops.length; ) {
		if (ops[i].t === 'eq') {
			rows.push({ t: 'eq', v: ops[i].v });
			i++;
			continue;
		}
		const dels: string[] = [];
		const inss: string[] = [];
		while (i < ops.length && ops[i].t === 'del') dels.push(ops[i++].v);
		while (i < ops.length && ops[i].t === 'ins') inss.push(ops[i++].v);
		const pairs = Math.min(dels.length, inss.length);
		for (let p = 0; p < pairs; p++) rows.push({ t: 'mod', ops: diffWords(dels[p], inss[p]) });
		for (const v of dels.slice(pairs)) rows.push({ t: 'del', v });
		for (const v of inss.slice(pairs)) rows.push({ t: 'ins', v });
	}
	// Collapse unchanged runs, keeping `context` lines next to each change.
	const keep = rows.map((r) => r.t !== 'eq');
	rows.forEach((r, i) => {
		if (r.t === 'eq') return;
		for (let j = Math.max(0, i - context); j <= Math.min(rows.length - 1, i + context); j++) keep[j] = true;
	});
	const out: Row[] = [];
	let skipped = 0;
	rows.forEach((r, i) => {
		if (keep[i]) {
			if (skipped) out.push({ t: 'skip', n: skipped });
			skipped = 0;
			out.push(r);
		} else skipped++;
	});
	if (skipped) out.push({ t: 'skip', n: skipped });
	return out;
}

// ---------------------------------------------------------------------------
// Field values → comparable lines
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };
function decode(s: string): string {
	return s.replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (m, e: string) => {
		if (ENTITIES[e.toLowerCase()]) return ENTITIES[e.toLowerCase()];
		if (e[0] === '#') {
			const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
			return Number.isFinite(code) ? String.fromCodePoint(code) : m;
		}
		return m;
	});
}
/** Inline HTML → plain text; links keep their URL so a changed href shows. */
export function inlineText(html: string): string {
	return decode(
		html
			.replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ⟨$1⟩')
			.replace(/<br\s*\/?>/gi, ' ')
			.replace(/<[^>]+>/g, '')
	)
		.replace(/\s+/g, ' ')
		.trim();
}

const short = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** A block's fields summarised on one line: its text fields, item counts. */
function blockSummary(fields: Record<string, unknown>): string {
	const parts: string[] = [];
	for (const [k, v] of Object.entries(fields ?? {})) {
		if (typeof v === 'string' && v.trim()) parts.push(`${k}: ${short(inlineText(v))}`);
		else if (Array.isArray(v) && v.length) parts.push(`${k}: ${v.length} item${v.length === 1 ? '' : 's'}`);
		else if (v && typeof v === 'object' && typeof (v as { url?: unknown }).url === 'string')
			parts.push(`${k}: ${(v as { url: string }).url}`);
	}
	return parts.join(' · ');
}

function asNodes(v: unknown): Record<string, unknown>[] {
	if (Array.isArray(v)) return v as Record<string, unknown>[];
	if (typeof v === 'string' && v.trim().startsWith('[')) {
		try {
			return JSON.parse(v) as Record<string, unknown>[];
		} catch {
			/* fall through */
		}
	}
	return typeof v === 'string' && v.trim() ? [{ type: 'p', html: v }] : [];
}

/** Rich-text nodes → one line per paragraph / list item / embedded thing. */
export function richTextLines(value: unknown, blocks: ClientBlock[] = []): string[] {
	const label = (slug: string) => blocks.find((b) => b.slug === slug)?.label ?? slug;
	const lines: string[] = [];
	for (const n of asNodes(value)) {
		const html = typeof n.html === 'string' ? n.html : '';
		switch (n.type) {
			case 'p':
				lines.push(inlineText(html));
				break;
			case 'h2':
				lines.push(`## ${inlineText(html)}`);
				break;
			case 'h3':
				lines.push(`### ${inlineText(html)}`);
				break;
			case 'quote':
				lines.push(`> ${inlineText(html)}`);
				break;
			case 'ul':
			case 'ol':
				((n.items as string[]) ?? []).forEach((it, i) => lines.push(`${n.type === 'ol' ? `${i + 1}.` : '•'} ${inlineText(it)}`));
				break;
			case 'code':
				String(n.code ?? '').split('\n').forEach((l) => lines.push(`\` ${l}`));
				break;
			case 'divider':
				lines.push('———');
				break;
			case 'upload':
				lines.push(`[Image ${String(n.value ?? '')}]`);
				break;
			case 'relationship':
				lines.push(`[${String(n.relationTo ?? 'link')} ${String(n.value ?? '')}]`);
				break;
			case 'gallery':
				lines.push(`[Gallery · ${Array.isArray(n.items) ? n.items.length : 0} photos]`);
				break;
			case 'embed':
				lines.push(`[Embed ${String(n.url ?? '')}]`);
				break;
			case 'block':
				lines.push(`[${label(String(n.blockType ?? 'block'))}] ${blockSummary(n.fields as Record<string, unknown>)}`.trim());
				break;
			default:
				lines.push(short(JSON.stringify(n)));
		}
	}
	return lines.filter((l) => l !== '');
}

/** HTML → one line per block element. */
export function htmlLines(html: unknown): string[] {
	if (typeof html !== 'string') return [];
	return html
		.replace(/<h([1-6])\b[^>]*>/gi, (_m, l: string) => `\n${'#'.repeat(Number(l))} `)
		.replace(/<li\b[^>]*>/gi, '\n• ')
		.replace(/<blockquote\b[^>]*>/gi, '\n> ')
		.replace(/<\/(p|h[1-6]|li|blockquote|div|tr|ul|ol|figure)>/gi, '\n')
		.replace(/<(hr)\b[^>]*>/gi, '\n———\n')
		.split('\n')
		.map((l) => inlineText(l))
		.filter(Boolean);
}

function jsonLines(v: unknown): string[] {
	if (v === undefined || v === null || v === '') return [];
	return JSON.stringify(v, null, 1).split('\n');
}

function display(v: unknown): string {
	if (v === undefined || v === null || v === '') return '—';
	if (typeof v === 'boolean') return v ? 'Yes' : 'No';
	if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ') || '—';
	if (typeof v === 'object') return JSON.stringify(v);
	return String(v);
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Per-field diffs from `before` to `after`, in field order; unchanged fields omitted. */
export function diffDocs(fields: ClientField[], before: Doc, after: Doc): FieldDiff[] {
	const out: FieldDiff[] = [];
	if (!same(before._status, after._status))
		out.push({ name: '_status', label: 'Status', kind: 'value', before: display(before._status), after: display(after._status) });
	for (const f of fields) {
		const a = before[f.name];
		const b = after[f.name];
		if (same(a, b)) continue;
		const base = { name: f.name, label: f.label };
		if ((f.type === 'text' || f.type === 'textarea' || f.type === 'email') && (a == null || typeof a === 'string') && (b == null || typeof b === 'string')) {
			out.push({ ...base, kind: 'text', ops: diffWords(String(a ?? ''), String(b ?? '')) });
		} else if (f.type === 'richText') {
			out.push({ ...base, kind: 'lines', rows: diffLines(richTextLines(a, f.blocks), richTextLines(b, f.blocks)) });
		} else if (f.type === 'html') {
			out.push({ ...base, kind: 'lines', rows: diffLines(htmlLines(a), htmlLines(b)) });
		} else if (a !== null && typeof a === 'object') {
			out.push({ ...base, kind: 'lines', rows: diffLines(jsonLines(a), jsonLines(b)) });
		} else if (b !== null && typeof b === 'object') {
			out.push({ ...base, kind: 'lines', rows: diffLines(jsonLines(a), jsonLines(b)) });
		} else {
			out.push({ ...base, kind: 'value', before: display(a), after: display(b) });
		}
	}
	return out;
}

/** Names of the configured fields that differ (server-side list summaries). */
export function changedFields(fields: { name: string; label: string }[], before: Doc, after: Doc): string[] {
	const out: string[] = [];
	if (!same(before._status, after._status)) out.push('Status');
	for (const f of fields) if (!same(before[f.name], after[f.name])) out.push(f.label);
	return out;
}
