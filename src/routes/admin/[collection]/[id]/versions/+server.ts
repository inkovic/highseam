import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { APIError } from '$lib/core/types';

/**
 * Version snapshots for the compare panel (1.7.4): GET ?ids=<id>,<id> → the
 * snapshots of up to two versions of this document, fetched when the panel
 * needs them rather than shipped with every page load. Same access as the
 * version list: signed in, and allowed to update the document.
 */
export const GET: RequestHandler = async ({ locals, params, url }) => {
	if (!locals.user) error(401, 'Sign in to see versions');
	const ids = (url.searchParams.get('ids') ?? '').split(',').filter(Boolean).slice(0, 2);
	if (!ids.length) error(400, 'ids required');
	try {
		const list = await locals.cms.findVersions({ user: locals.user }, params.collection, params.id);
		const out = ids
			.map((id) => list.find((v) => v.id === id))
			.filter((v) => v !== undefined)
			.map((v) => ({ id: v.id, createdAt: String(v.createdAt ?? ''), snapshot: v.snapshot ?? {} }));
		return json(out, { headers: { 'cache-control': 'private, no-store' } });
	} catch (err) {
		if (err instanceof APIError) error(err.status as 400, err.message);
		throw err;
	}
};
