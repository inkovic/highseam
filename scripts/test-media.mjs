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

console.log('\nmediaSrc (transform URLs)');
{
	const { mediaSrc, parseRatio } = await import('../src/lib/core/media.ts');
	const doc = { url: '/media/k/beach.png', focalPoint: { v: 1, x: 0.3, y: 0.8 } };

	check('parseRatio 16:7', parseRatio('16:7'), { w: 16, h: 7 });
	check('parseRatio 1200:630', parseRatio('1200:630'), { w: 1200, h: 630 });
	check('parseRatio garbage', parseRatio('wide'), null);

	check(
		'width+aspect crops with focal gravity',
		mediaSrc(doc, { width: 800, aspect: '16:7' }),
		'/cdn-cgi/image/width=800,height=350,fit=crop,gravity=0.300x0.800,format=auto/media/k/beach.png'
	);
	check(
		'no focal → gravity=auto',
		mediaSrc({ url: '/media/k/a.png' }, { width: 600, height: 400 }),
		'/cdn-cgi/image/width=600,height=400,fit=crop,gravity=auto,format=auto/media/k/a.png'
	);
	check(
		'width only → scale-down, no crop',
		mediaSrc(doc, { width: 1200 }),
		'/cdn-cgi/image/width=1200,fit=scale-down,format=auto/media/k/beach.png'
	);
	check('no dimensions → original url (fallback contract)', mediaSrc(doc), '/media/k/beach.png');
	check('no url → empty string', mediaSrc({ id: 'x' }, { width: 100 }), '');
	check(
		'quality clamps',
		mediaSrc(doc, { width: 100, height: 100, quality: 500 }).includes('quality=100'),
		true
	);
}

console.log('\nupload-node placement aspect (sanitizer whitelist)');
{
	const { sanitizeNodes } = await import('../src/lib/core/richtext.ts');
	const clean = (n) => sanitizeNodes([n])[0];

	check(
		'valid aspect kept',
		clean({ type: 'upload', relationTo: 'media', value: 'm1', fields: { aspect: '16:9' } }),
		{ type: 'upload', relationTo: 'media', value: 'm1', fields: { aspect: '16:9' } }
	);
	check(
		'invalid aspect dropped',
		clean({ type: 'upload', relationTo: 'media', value: 'm1', fields: { aspect: 'wide' } }),
		{ type: 'upload', relationTo: 'media', value: 'm1' }
	);
	check(
		'junk fields dropped, aspect survives',
		clean({ type: 'upload', relationTo: 'media', value: 'm1', fields: { aspect: '4:3', evil: '<script>' } }),
		{ type: 'upload', relationTo: 'media', value: 'm1', fields: { aspect: '4:3' } }
	);
	check(
		'non-string aspect dropped',
		clean({ type: 'upload', relationTo: 'media', value: 'm1', fields: { aspect: 42 } }),
		{ type: 'upload', relationTo: 'media', value: 'm1' }
	);
	check(
		'no fields at all — unchanged shape',
		clean({ type: 'upload', relationTo: 'media', value: 'm1' }),
		{ type: 'upload', relationTo: 'media', value: 'm1' }
	);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
