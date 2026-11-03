/**
 * Field-scoped drafts for table-backed collections (1.8.0).
 *   npx -y tsx scripts/test-table-drafts.mjs
 *
 * The scenario that broke full-copy drafts: an editor saves a draft, other
 * code writes the row (a pipeline, a SQL backfill), the editor publishes.
 * Publish must apply the editor's fields and keep the other write.
 */
import { CMS } from '../src/lib/core/cms.ts';
import { MemoryAdapter } from '../src/lib/core/adapters/memory.ts';

let pass = 0,
	fail = 0;
function check(name, actual, expected) {
	const ok = JSON.stringify(actual) === JSON.stringify(expected);
	console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
	if (!ok) console.log(`      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
	ok ? pass++ : fail++;
}

const fields = [
	{ name: 'name', type: 'text', required: true },
	{ name: 'body', type: 'textarea' },
	{ name: 'photo_url', type: 'text' },
	{ name: 'rating', type: 'number' },
	{ name: 'tags', type: 'json' },
	{ name: 'indoor', type: 'checkbox' }
];
const config = {
	secret: 'test',
	collections: [
		{ slug: 'venues', table: { name: 'venues', autoId: true }, versions: { drafts: true }, fields },
		{ slug: 'diary', versions: { drafts: true }, fields }
	]
};
const req = { user: { id: 'u1', email: 'a@b.c' } };
// Versions sort by createdAt (ms); space the steps so "latest" is unambiguous.
const tick = () => new Promise((r) => setTimeout(r, 3));

async function fresh() {
	const db = new MemoryAdapter();
	const cms = new CMS(config, db);
	return { cms, db };
}

console.log('\ntable mode: a draft carries only its edits');
{
	const { cms, db } = await fresh();
	const v = await cms.create(req, 'venues', { name: 'Kingo', body: 'old', photo_url: 'A', rating: 4.1 });
	await tick();
	await cms.update(req, 'venues', v.id, { name: 'Kingo', body: 'new', photo_url: 'A', rating: 4.1 }, { draft: true });

	const live = await cms.findByID(req, 'venues', v.id);
	check('live row untouched by draft save', [live.body, live._status], ['old', 'published']);

	// Someone else writes the row (pipeline / SQL), bypassing the CMS.
	await db.update('venues', v.id, { photo_url: 'B', rating: 4.3 });

	const draft = await cms.findByID(req, 'venues', v.id, { draft: true });
	check('draft read: edits over the current row', [draft.body, draft.photo_url, draft.rating], ['new', 'B', 4.3]);
	check('draft read: status draft, no bookkeeping key', [draft._status, '_draftFields' in draft], ['draft', false]);

	await tick();
	const pub = await cms.publish(req, 'venues', v.id);
	check('publish: editor field applied', pub.body, 'new');
	check('publish: outside writes kept', [pub.photo_url, pub.rating], ['B', 4.3]);
	check('publish: status published', pub._status, 'published');
}

console.log('\ntable mode: the admin form posts every field');
{
	const { cms, db } = await fresh();
	const v = await cms.create(req, 'venues', { name: 'Kingo', body: 'old', photo_url: 'A', tags: { b: 1, a: 2 } });
	// Form opened before the outside write, so it still holds photo A …
	await db.update('venues', v.id, { photo_url: 'B' });
	// … but the editor only changed body; key order of tags differs, empty string vs null.
	await tick();
	await cms.update(req, 'venues', v.id, { name: 'Kingo', body: 'new', photo_url: 'B', rating: '', tags: { a: 2, b: 1 } }, { draft: true });
	const versions = await cms.findVersions(req, 'venues', v.id);
	check('only the real edit is recorded', versions[0].snapshot._draftFields, ['body']);
	await tick();
	const pub = await cms.publish(req, 'venues', v.id);
	check('publish keeps photo B', [pub.body, pub.photo_url], ['new', 'B']);
}

console.log('\ntable mode: drafts accumulate and reverts drop out');
{
	const { cms } = await fresh();
	const v = await cms.create(req, 'venues', { name: 'Kingo', body: 'old', photo_url: 'A' });
	await tick();
	await cms.update(req, 'venues', v.id, { body: 'new' }, { draft: true }); // API: partial
	await tick();
	await cms.update(req, 'venues', v.id, { name: 'The Kingo' }, { draft: true }); // second partial
	let d = await cms.findByID(req, 'venues', v.id, { draft: true });
	check('two partial draft saves both kept', [d.name, d.body], ['The Kingo', 'new']);
	await tick();
	await cms.update(req, 'venues', v.id, { name: 'Kingo' }, { draft: true }); // revert name
	const versions = await cms.findVersions(req, 'venues', v.id);
	check('reverted field leaves the edit list', versions[0].snapshot._draftFields, ['body']);
}

console.log('\ntable mode: publish with no open draft');
{
	const { cms, db } = await fresh();
	const v = await cms.create(req, 'venues', { name: 'Kingo', body: 'old', photo_url: 'A' });
	await db.update('venues', v.id, { photo_url: 'B' });
	await tick();
	const pub = await cms.publish(req, 'venues', v.id);
	check('stale published snapshot is not copied back', pub.photo_url, 'B');
	const d = await cms.findByID(req, 'venues', v.id, { draft: true });
	check('draft read with no draft = live row', [d.photo_url, d._status], ['B', 'published']);
}

console.log('\ntable mode: an unknown (NULL) checkbox is not an edit');
{
	const { cms, db } = await fresh();
	const v = await cms.create(req, 'venues', { name: 'Kingo', body: 'old' });
	await db.update('venues', v.id, { indoor: null }); // unknown, as stored by a pipeline
	await tick();
	await cms.update(req, 'venues', v.id, { name: 'Kingo', body: 'new', indoor: false }, { draft: true }); // form: unticked
	let versions = await cms.findVersions(req, 'venues', v.id);
	check('unticked over NULL is not recorded', versions[0].snapshot._draftFields, ['body']);
	await tick();
	await cms.update(req, 'venues', v.id, { indoor: true }, { draft: true }); // ticked
	versions = await cms.findVersions(req, 'venues', v.id);
	check('ticking it is', versions[0].snapshot._draftFields, ['body', 'indoor']);
}

console.log('\ndiscard draft');
{
	const { cms, db } = await fresh();
	const v = await cms.create(req, 'venues', { name: 'Kingo', body: 'old', photo_url: 'A' });
	await tick();
	await cms.update(req, 'venues', v.id, { body: 'new' }, { draft: true });
	await db.update('venues', v.id, { photo_url: 'B' });
	await tick();
	await cms.discardDraft(req, 'venues', v.id);
	const d = await cms.findByID(req, 'venues', v.id, { draft: true });
	check('table mode: draft gone, live row shown', [d.body, d.photo_url, d._status], ['old', 'B', 'published']);
	const live = await cms.findByID(req, 'venues', v.id);
	check('table mode: row untouched', [live.body, live.photo_url], ['old', 'B']);

	const e = await cms.create(req, 'diary', { name: 'Entry', body: 'old' });
	await tick();
	await cms.update(req, 'diary', e.id, { name: 'Entry', body: 'new' }, { draft: true });
	await tick();
	await cms.discardDraft(req, 'diary', e.id);
	const dd = await cms.findByID(req, 'diary', e.id, { draft: true });
	check('document mode: draft gone', [dd.body, dd._status], ['old', 'published']);
}

console.log('\ndocument mode: unchanged (full-copy drafts)');
{
	const { cms } = await fresh();
	const v = await cms.create(req, 'diary', { name: 'Entry', body: 'old', photo_url: 'A' });
	await tick();
	await cms.update(req, 'diary', v.id, { name: 'Entry', body: 'new', photo_url: 'A' }, { draft: true });
	const versions = await cms.findVersions(req, 'diary', v.id);
	check('no edit list on document-mode drafts', '_draftFields' in versions[0].snapshot, false);
	const d = await cms.findByID(req, 'diary', v.id, { draft: true });
	check('draft read = snapshot', d.body, 'new');
	await tick();
	const pub = await cms.publish(req, 'diary', v.id);
	check('publish copies the draft', [pub.body, pub._status], ['new', 'published']);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
