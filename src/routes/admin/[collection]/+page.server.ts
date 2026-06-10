import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { toClientCollection } from '$lib/admin/client';
import { APIError, type Where } from '$lib/core/types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const { cms, user } = locals;
	if (!cms.hasCollection(params.collection)) error(404, 'Unknown collection');
	const col = cms.collection(params.collection);
	const client = toClientCollection(col);

	const page = Math.max(parseInt(url.searchParams.get('page') ?? '1', 10) || 1, 1);
	const search = url.searchParams.get('q') ?? '';
	const sort = url.searchParams.get('sort') ?? '-createdAt';

	const where: Where | undefined =
		search && client.useAsTitle !== 'id'
			? { [client.useAsTitle]: { contains: search } }
			: undefined;

	try {
		const result = await cms.find(
			{ user },
			params.collection,
			{ where, page, limit: 20, sort },
			{ depth: 1 }
		);
		return { collection: client, result, search, sort };
	} catch (err) {
		if (err instanceof APIError) error(err.status, err.message);
		throw err;
	}
};
