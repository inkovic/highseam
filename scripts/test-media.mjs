/**
 * resolveMedia() inherit-then-override precedence.
 *   node scripts/test-media.mjs
 */
import { resolveMedia, focalObjectPosition, normalizeFocalPoint } from '../src/lib/core/media.ts';

let pass = 0,
	fail = 0;
function check(name, actual, expected) {
	const ok = JSON.stringify(actual) === JSON.stringify(expected);
	console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
	if (!ok) console.log(`      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
	ok ? pass++ : fail++;
}

const media = {
	id: 'm1',
	url: '/media/x/beach.png',
	mimeType: 'image/png',
	filesize: 1024,
	filename: 'beach.png',
	alt: 'Dog on sand',
	caption: 'Sunset walk',
	credit: 'PawScapes',
	tags: ['hero', 'beach'],
	focalPoint: { v: 1, x: 0.3, y: 0.8 }
};

console.log('\ninherit');
{
	const r = resolveMedia(media);
	check('alt inherited', r.alt, 'Dog on sand');
	check('credit inherited', r.credit, 'PawScapes');
	check('tags inherited', r.tags, ['hero', 'beach']);
	check('isImage derived', r.isImage, true);
}

console.log('\noverride');
{
	const r = resolveMedia(media, { alt: 'Specific alt for this page' });
	check('alt overridden', r.alt, 'Specific alt for this page');
	check('caption still inherited', r.caption, 'Sunset walk');
}
{
	// empty string is a real value ("decorative"), not "inherit"
	const r = resolveMedia(media, { alt: '' });
	check('empty alt override is respected', r.alt, '');
}
{
	const r = resolveMedia(media, { alt: undefined });
	check('undefined means inherit', r.alt, 'Dog on sand');
}

console.log('\nedge cases');
{
	check('bare id string → null (not loaded)', resolveMedia('m1'), null);
	check('null → null', resolveMedia(null), null);
	check('doc without url → null', resolveMedia({ id: 'x' }), null);
}
{
	const noMeta = { id: 'm2', url: '/media/y/a.pdf', mimeType: 'application/pdf' };
	const r = resolveMedia(noMeta);
	check('missing metadata is undefined, not empty string', r.alt, undefined);
	check('non-image isImage false', r.isImage, false);
}

console.log('\nfocal point');
{
	check('object-position from focal', focalObjectPosition(media.focalPoint), '30% 80%');
	check('default centre', focalObjectPosition(undefined), '50% 50%');
	check('clamps out of range', normalizeFocalPoint({ x: 1.7, y: -3 }), { v: 1, x: 1, y: 0 });
	check('rejects garbage', normalizeFocalPoint({ x: 'a' }), undefined);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
