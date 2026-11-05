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
		{ slug: 'venues', table: { name: 'venues', autoId: true }, versions: { drafts: true, maxPerDoc: 3, unpublish: false }, fields },
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

console.log('\n1.8.1: one draft entry, updated in place');
{
	const { cms } = await fresh();
	const v = await cms.create(req, 'venues', { name: 'Kingo', body: 'old' });
	for (const b of ['a', 'b', 'c', 'd']) {
		await tick();
		await cms.update(req, 'venues', v.id, { body: b }, { draft: true });
	}
	let rows = await cms.findVersions(req, 'venues', v.id);
	check('4 autosaves = 1 draft row (+ the create snapshot)', rows.map((r) => r.snapshot._status), ['draft', 'published']);
	check('the draft row holds the latest edit', rows[0].snapshot.body, 'd');
	await tick();
	await cms.publish(req, 'venues', v.id);
	rows = await cms.findVersions(req, 'venues', v.id);
	check('publish replaces the draft row with the published one', rows.map((r) => [r.snapshot._status, r.snapshot.body]), [['published', 'd'], ['published', 'old']]);
}

console.log('\n1.8.1: legacy autosave rows fold into one');
{
	const { cms, db } = await fresh();
	const v = await cms.create(req, 'venues', { name: 'Kingo', body: 'old' });
	for (const b of ['x1', 'x2', 'x3']) {
		await tick();
		await db.create('_versions_venues', { parent: v.id, snapshot: { id: v.id, name: 'Kingo', body: b, _status: 'draft', _draftFields: ['body'] } });
	}
	await tick();
	await cms.update(req, 'venues', v.id, { name: 'The Kingo' }, { draft: true });
	const rows = await cms.findVersions(req, 'venues', v.id);
	check('3 old draft rows + a save = 1 draft row', rows.filter((r) => r.snapshot._status === 'draft').length, 1);
	check('it keeps the old edits and the new one', [rows[0].snapshot.body, rows[0].snapshot.name, rows[0].snapshot._draftFields], ['x3', 'The Kingo', ['name', 'body']]);
}

console.log('\n1.8.1: discard removes the draft row');
{
	const { cms } = await fresh();
	const v = await cms.create(req, 'venues', { name: 'Kingo', body: 'old' });
	await tick();
	await cms.update(req, 'venues', v.id, { body: 'new' }, { draft: true });
	await tick();
	await cms.discardDraft(req, 'venues', v.id);
	const rows = await cms.findVersions(req, 'venues', v.id);
	check('only the create snapshot is left', rows.map((r) => r.snapshot._status), ['published']);
}

console.log('\n1.8.1: a live write keeps the open draft open (table mode)');
{
	const { cms } = await fresh();
	const v = await cms.create(req, 'venues', { name: 'Kingo', body: 'old', photo_url: 'A' });
	await tick();
	await cms.update(req, 'venues', v.id, { body: 'new' }, { draft: true });
	await tick();
	await cms.update(req, 'venues', v.id, { photo_url: 'B' }); // e.g. an action writing live
	const d = await cms.findByID(req, 'venues', v.id, { draft: true });
	check('draft still open: edit + the live write', [d._status, d.body, d.photo_url], ['draft', 'new', 'B']);
	const rows = await cms.findVersions(req, 'venues', v.id);
	check('no history row while the draft is open; draft stays on top', rows.map((r) => r.snapshot._status), ['draft', 'published']);
}

console.log('\n1.8.1: restore goes into the draft (table mode)');
{
	const { cms, db } = await fresh();
	const v = await cms.create(req, 'venues', { name: 'Kingo', body: 'v1', photo_url: 'A' });
	await tick();
	await cms.update(req, 'venues', v.id, { body: 'v2' }, { draft: true });
	await tick();
	await cms.publish(req, 'venues', v.id);
	await db.update('venues', v.id, { photo_url: 'B' }); // pipeline, after
	let rows = await cms.findVersions(req, 'venues', v.id);
	const v1 = rows.find((r) => r.snapshot.body === 'v1');
	await tick();
	await cms.restoreVersion(req, 'venues', v.id, v1.id);
	const live = await cms.findByID(req, 'venues', v.id);
	check('live row untouched by restore', [live.body, live.photo_url], ['v2', 'B']);
	const d = await cms.findByID(req, 'venues', v.id, { draft: true });
	check('draft = the old version, every field that differs (photo too: review before Publish)', [d._status, d.body, d.photo_url], ['draft', 'v1', 'A']);
	rows = await cms.findVersions(req, 'venues', v.id);
	check('draft edit list names them', rows[0].snapshot._draftFields, ['body', 'photo_url']);
}

console.log('\n1.8.1: "Unpublished changes" filter');
{
	const { cms } = await fresh();
	const a = await cms.create(req, 'venues', { name: 'A' });
	const b = await cms.create(req, 'venues', { name: 'B' });
	const c = await cms.create(req, 'venues', { name: 'C' });
	await tick();
	await cms.update(req, 'venues', a.id, { body: 'draft' }, { draft: true });
	await cms.update(req, 'venues', c.id, { body: 'draft' }, { draft: true });
	await tick();
	await cms.publish(req, 'venues', c.id);
	const res = await cms.find(req, 'venues', { openDrafts: true, limit: 0 });
	check('only A (C was published, B never drafted)', res.docs.map((d) => d.name), ['A']);
	const all = await cms.find(req, 'venues', { limit: 0 });
	check('without the filter: all three', all.docs.length, 3);
}

console.log('\n1.8.1: prune keeps maxPerDoc published versions; the draft does not count');
{
	const { cms } = await fresh(); // venues maxPerDoc: 3
	const v = await cms.create(req, 'venues', { name: 'Kingo', body: '0' });
	for (const b of ['1', '2', '3', '4']) {
		await tick();
		await cms.update(req, 'venues', v.id, { body: b }, { draft: true });
		await tick();
		await cms.publish(req, 'venues', v.id);
	}
	await tick();
	await cms.update(req, 'venues', v.id, { body: '5' }, { draft: true });
	const rows = await cms.findVersions(req, 'venues', v.id);
	check('draft + 3 newest published', rows.map((r) => [r.snapshot._status, r.snapshot.body]), [['draft', '5'], ['published', '4'], ['published', '3'], ['published', '2']]);
}

console.log('\n1.8.1: unpublish can be turned off');
{
	const { cms } = await fresh();
	const v = await cms.create(req, 'venues', { name: 'Kingo' });
	let msg = '';
	try { await cms.unpublish(req, 'venues', v.id); } catch (e) { msg = e.message; }
	check('venues (unpublish: false) refuses', msg.includes('turned off'), true);
	const e = await cms.create(req, 'diary', { name: 'Entry' });
	await cms.unpublish(req, 'diary', e.id);
	check('diary (default) still unpublishes', (await cms.findByID(req, 'diary', e.id))._status, 'draft');
}

console.log('\n1.8.1: document mode drafts are one entry too');
{
	const { cms } = await fresh();
	const e = await cms.create(req, 'diary', { name: 'Entry', body: 'old' });
	for (const b of ['a', 'b', 'c']) {
		await tick();
		await cms.update(req, 'diary', e.id, { name: 'Entry', body: b }, { draft: true });
	}
	let rows = await cms.findVersions(req, 'diary', e.id);
	check('3 autosaves = 1 draft row', rows.map((r) => r.snapshot._status), ['draft', 'published']);
	const d = await cms.findByID(req, 'diary', e.id, { draft: true });
	check('draft read = latest edit', d.body, 'c');
	await tick();
	await cms.publish(req, 'diary', e.id);
	rows = await cms.findVersions(req, 'diary', e.id);
	check('published', rows.map((r) => [r.snapshot._status, r.snapshot.body]), [['published', 'c'], ['published', 'old']]);
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
