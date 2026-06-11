import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** GET /media/:key — serve a stored upload (dev: .data/uploads, prod: R2). */
export const GET: RequestHandler = async ({ locals, params }) => {
	const storage = locals.cms.storage;
	if (!storage) error(404, 'No file storage configured');

	const file = await storage.get(params.key);
	if (!file) error(404, 'File not found');

	return new Response(file.bytes as BodyInit, {
		headers: {
			'content-type': file.contentType,
			'content-length': String(file.bytes.byteLength),
			'cache-control': 'public, max-age=31536000, immutable'
		}
	});
};
