/**
 * Version compare diffs (1.7.4).
 *   node --experimental-strip-types scripts/test-diff.mjs
 */
import { diffTokens, diffWords, diffLines, richTextLines, htmlLines, diffDocs, changedFields } from '../src/lib/admin/version-diff.ts';

let pass = 0,
	fail = 0;
function check(name, actual, expected) {
	const ok = JSON.stringify(actual) === JSON.stringify(expected);
	console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
	if (!ok) console.log(`      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
	ok ? pass++ : fail++;
}
const apply = (ops, side) => ops.filter((o) => o.t === 'eq' || o.t === side).map((o) => o.v).join('');

console.log('\ntokens');
{
	const a = 'the quick brown fox'.split(' ');
	const b = 'the slow brown fox jumps'.split(' ');
	const ops = diffTokens(a, b);
	check('rebuilds before', ops.filter((o) => o.t !== 'ins').map((o) => o.v), a);
	check('rebuilds after', ops.filter((o) => o.t !== 'del').map((o) => o.v), b);
	check('minimal', ops.filter((o) => o.t !== 'eq').length, 3);
	check('identical → all eq', diffTokens(['a', 'b'], ['a', 'b']).every((o) => o.t === 'eq'), true);
	check('empty before', diffTokens([], ['x']), [{ t: 'ins', v: 'x' }]);
	check('empty after', diffTokens(['x'], []), [{ t: 'del', v: 'x' }]);
	// random round-trips
	let ok = true;
	for (let r = 0; r < 200; r++) {
		const rnd = () => Array.from({ length: Math.floor(Math.random() * 12) }, () => 'abcd'[Math.floor(Math.random() * 4)]);
		const x = rnd(), y = rnd(), d = diffTokens(x, y);
		if (JSON.stringify(d.filter((o) => o.t !== 'ins').map((o) => o.v)) !== JSON.stringify(x)) ok = false;
		if (JSON.stringify(d.filter((o) => o.t !== 'del').map((o) => o.v)) !== JSON.stringify(y)) ok = false;
	}
	check('200 random round-trips', ok, true);
}

console.log('\nwords');
{
	const ops = diffWords('Dogs are welcome on lead.', 'Dogs are welcome off lead!');
	check('before text', apply(ops, 'del'), 'Dogs are welcome on lead.');
	check('after text', apply(ops, 'ins'), 'Dogs are welcome off lead!');
	check('changed words only', ops.filter((o) => o.t !== 'eq').map((o) => o.v), ['on', 'off', '.', '!']);
	const rw = diffWords('Old summary about snow.', 'The one Victorian alpine village that lets dogs in.');
	check('rewrite reads as one removal + one addition', rw.map((o) => o.t), ['del', 'ins', 'eq']);
	check('rewrite round-trips', [apply(rw, 'del'), apply(rw, 'ins')], ['Old summary about snow.', 'The one Victorian alpine village that lets dogs in.']);
}

console.log('\nlines');
{
	const a = ['one', 'two', 'three', 'four', 'five', 'six'];
	const b = ['one', 'two', 'THREE', 'four', 'five', 'six', 'seven'];
	const rows = diffLines(a, b);
	check('mod row for a changed line', rows.some((r) => r.t === 'mod'), true);
	check('added line', rows.some((r) => r.t === 'ins' && r.v === 'seven'), true);
	check('far context collapsed', rows[0], { t: 'skip', n: 1 });
}

console.log('\nrich text / html');
{
	const nodes = [
		{ type: 'h2', html: 'Getting there' },
		{ type: 'p', html: 'Take the <a href="https://x.test/">coast road</a>.' },
		{ type: 'ul', items: ['On lead', 'Bring water'] },
		{ type: 'block', blockType: 'callout', fields: { tone: 'tip', title: 'Go early', items: [1, 2] } }
	];
	check('lines', richTextLines(nodes, [{ slug: 'callout', label: 'Callout', fields: [] }]), [
		'## Getting there',
		'Take the coast road ⟨https://x.test/⟩.',
		'• On lead',
		'• Bring water',
		'[Callout] tone: tip · title: Go early · items: 2 items'
	]);
	check('json string value', richTextLines(JSON.stringify([{ type: 'p', html: 'Hi &amp; bye' }])), ['Hi & bye']);
	check('html lines', htmlLines('<h2>Rules</h2><p>Dogs <b>on</b> lead.</p><ul><li>Water</li></ul>'), ['## Rules', 'Dogs on lead.', '• Water']);
}

console.log('\ndocs');
{
	const fields = [
		{ name: 'title', label: 'Title', type: 'text' },
		{ name: 'body', label: 'Body', type: 'richText' },
		{ name: 'rating', label: 'Rating', type: 'number' },
		{ name: 'tags', label: 'Tags', type: 'json' }
	];
	const before = { _status: 'draft', title: 'Dinner Plain', body: [{ type: 'p', html: 'Snow.' }], rating: 4, tags: ['snow'] };
	const after = { _status: 'published', title: 'Dinner Plain with dogs', body: [{ type: 'p', html: 'Snow.' }], rating: 5, tags: ['snow'] };
	const d = diffDocs(fields, before, after);
	check('changed fields in order', d.map((x) => x.label), ['Status', 'Title', 'Rating']);
	check('title is a word diff', d[1].kind, 'text');
	check('number is before/after', [d[2].before, d[2].after], ['4', '5']);
	check('changedFields', changedFields(fields, before, after), ['Status', 'Title', 'Rating']);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail) process.exit(1);
