import { json, text } from '@sveltejs/kit';
import { dev } from '$app/environment';
import type { RequestHandler } from './$types';
import { generateTypes } from '$lib/core/typegen';

/** GET /api/generate-types — returns the generated .ts source (dev only). */
export const GET: RequestHandler = async ({ locals }) => {
	if (!dev) return json({ message: 'Type generation is dev-only' }, { status: 403 });
	return text(generateTypes(locals.cms.config));
};

/** POST /api/generate-types — writes src/generated-types.ts (dev only). */
export const POST: RequestHandler = async ({ locals }) => {
	if (!dev) return json({ message: 'Type generation is dev-only' }, { status: 403 });
	const source = generateTypes(locals.cms.config);
	const fs = await import('node:fs/promises');
	await fs.writeFile('src/generated-types.ts', source);
	return json({ message: 'Wrote src/generated-types.ts', bytes: source.length });
};
