/**
 * Verifies the Range-based block operations used by RichTextInput:
 * split-at-caret, the three-way selection split behind "select text → H2",
 * and merge. Runs the same algorithms against jsdom so we can assert the
 * halves stay well-formed when the cut lands inside inline markup.
 *
 *   node scripts/test-richtext-split.mjs
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>');
const { document, Range } = dom.window;
global.document = document;

let pass = 0;
let fail = 0;
function check(name, actual, expected) {
	const ok = actual === expected;
	console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
	if (!ok) console.log(`      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`);
	ok ? pass++ : fail++;
}
/** A fragment is well-formed if re-parsing it round-trips unchanged. */
function wellFormed(html) {
	const d = document.createElement('div');
	d.innerHTML = html;
	return d.innerHTML === html;
}

function el(html) {
	const d = document.createElement('div');
	d.innerHTML = html;
	return d;
}
/** Mirrors pruneEmptyInline() from core/richtext.ts. */
function pruneEmptyInline(html) {
	const container = document.createElement('div');
	container.innerHTML = html;
	const INLINE = new Set(['STRONG', 'EM', 'CODE', 'A', 'S', 'U', 'B', 'I']);
	let changed = true;
	while (changed) {
		changed = false;
		for (const node of Array.from(container.querySelectorAll('*'))) {
			if (!INLINE.has(node.tagName)) continue;
			if (node.querySelector('br, img')) continue;
			if ((node.textContent ?? '') !== '') continue;
			node.remove();
			changed = true;
		}
	}
	return container.innerHTML;
}
function fragHtml(frag) {
	const d = document.createElement('div');
	d.appendChild(frag);
	return pruneEmptyInline(d.innerHTML);
}
/** Locate a text node by its content, for placing carets deterministically. */
function textNode(root, contains) {
	const walk = (n) => {
		if (n.nodeType === 3 && n.textContent.includes(contains)) return n;
		for (const c of n.childNodes) {
			const found = walk(c);
			if (found) return found;
		}
		return null;
	};
	return walk(root);
}

// --- the algorithms under test (mirrors RichTextInput.svelte) ---------------

function splitAtCaret(element, container, offset) {
	const r = document.createRange();
	r.setStart(container, offset);
	r.setEnd(element, element.childNodes.length);
	const tail = fragHtml(r.extractContents());
	return { head: pruneEmptyInline(element.innerHTML), tail };
}

function threeWaySplit(element, startC, startO, endC, endO) {
	const afterRange = document.createRange();
	afterRange.setStart(endC, endO);
	afterRange.setEnd(element, element.childNodes.length);
	const after = fragHtml(afterRange.extractContents());

	const midRange = document.createRange();
	midRange.setStart(startC, startO);
	midRange.setEnd(element, element.childNodes.length);
	const mid = fragHtml(midRange.extractContents());

	return { before: pruneEmptyInline(element.innerHTML), mid, after };
}

const isEmptyHtml = (h) => !h.replace(/<br\s*\/?>|&nbsp;|<[^>]+>|\s/gi, '');

// --- tests -------------------------------------------------------------------

console.log('\nsplit at caret');
{
	// mid-<strong>: the exact case that naive string slicing corrupts
	const e = el('<strong>bold text</strong> tail');
	const t = textNode(e, 'bold text');
	const { head, tail } = splitAtCaret(e, t, 4); // after "bold"
	check('head keeps opening+closing strong', head, '<strong>bold</strong>');
	check('tail reopens strong', tail, '<strong> text</strong> tail');
	check('head well-formed', wellFormed(head), true);
	check('tail well-formed', wellFormed(tail), true);
}
{
	// across an <a>: the anchor must not leak an unclosed tag
	const e = el('Visit <a href="https://x.com" rel="nofollow">our site</a> today');
	const t = textNode(e, 'our site');
	const { head, tail } = splitAtCaret(e, t, 3); // inside the link text
	check('head closes the anchor', head, 'Visit <a href="https://x.com" rel="nofollow">our</a>');
	check('tail reopens anchor with attrs', tail, '<a href="https://x.com" rel="nofollow"> site</a> today');
	check('both halves well-formed', wellFormed(head) && wellFormed(tail), true);
}
{
	const e = el('hello');
	const { head, tail } = splitAtCaret(e, textNode(e, 'hello'), 0);
	check('split at very start → empty head', isEmptyHtml(head), true);
	check('split at very start → full tail', tail, 'hello');
}
{
	const e = el('hello');
	const { head, tail } = splitAtCaret(e, textNode(e, 'hello'), 5);
	check('split at very end → full head', head, 'hello');
	check('split at very end → empty tail', isEmptyHtml(tail), true);
}

console.log('\nthree-way split (select text → H2)');
{
	// Peter's exact trigger case
	const e = el('<strong>The rules.</strong> The off-leash area sits south of the Princes Highway.');
	const t = textNode(e, 'The rules.');
	const { before, mid, after } = threeWaySplit(e, t, 0, t, 10);
	check('before is empty (selection at node start)', isEmptyHtml(before), true);
	check('mid is the promoted heading', mid, '<strong>The rules.</strong>');
	check('after keeps the paragraph body', after, ' The off-leash area sits south of the Princes Highway.');
	check('all parts well-formed', wellFormed(mid) && wellFormed(after), true);
}
{
	// selection in the middle → all three parts non-empty
	const e = el('lead in. Heading here. trailing copy.');
	const t = textNode(e, 'lead in.');
	const { before, mid, after } = threeWaySplit(e, t, 9, t, 23);
	check('before', before, 'lead in. ');
	check('mid', mid, 'Heading here. ');
	check('after', after, 'trailing copy.');
}
{
	// selection spanning inline markup boundaries
	const e = el('a <em>b</em> c <strong>d</strong> e');
	const t1 = textNode(e, 'b');
	const t2 = textNode(e, 'd');
	const { before, mid, after } = threeWaySplit(e, t1, 0, t2, 1);
	check('before drops the emptied em', before, 'a ');
	check('mid spans em→strong well-formed', wellFormed(mid), true);
	check('mid content', mid, '<em>b</em> c <strong>d</strong>');
	check('after', after, ' e');
}

console.log('\nmerge (backspace at start)');
{
	const prev = el('<strong>Heading</strong>');
	const curHtml = ' and the body text';
	const joinAt = prev.childNodes.length;
	prev.insertAdjacentHTML('beforeend', curHtml);
	check('merged html', prev.innerHTML, '<strong>Heading</strong> and the body text');
	check('join index is the old child count', joinAt, 1);
	check('merged well-formed', wellFormed(prev.innerHTML), true);
}

console.log('\nempty detection');
{
	check('<br> is empty', isEmptyHtml('<br>'), true);
	check('&nbsp; is empty', isEmptyHtml('&nbsp;'), true);
	check('empty tags are empty', isEmptyHtml('<strong></strong>'), true);
	check('text is not empty', isEmptyHtml('x'), false);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
