import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { toClientCollection } from '$lib/admin/client';
import { APIError, type Where, type WhereOperators } from '$lib/core/types';

export interface FacetControl {
	name: string;
	label: string;
	kind: 'select' | 'boolean' | 'exists' | 'text';
	options?: { label: string; value: string }[];
	value: string;
}

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const { cms, user } = locals;
	if (!cms.hasCollection(params.collection)) error(404, 'Unknown collection');
	const col = cms.collection(params.collection);
	const client = toClientCollection(col);

	const page = Math.max(parseInt(url.searchParams.get('page') ?? '1', 10) || 1, 1);
	const search = url.searchParams.get('q') ?? '';
	const sort = url.searchParams.get('sort') ?? '-createdAt';

	const where: Where = {};
	if (search && client.useAsTitle !== 'id') where[client.useAsTitle] = { contains: search };

	// Faceted filters (admin.filters): build combinable where clauses + the
	// control descriptors the UI renders. Filter state lives in the URL.
	const facets: FacetControl[] = [];
	for (const name of client.filters) {
		const field = client.fields.find((f) => f.name === name);
		if (!field) continue;
		const raw = url.searchParams.get(`f_${name}`) ?? '';
		let kind: FacetControl['kind'] = 'text';
		let options: { label: string; value: string }[] | undefined;

		if (field.type === 'select') {
			kind = 'select';
			options = field.options ?? [];
		} else if (field.type === 'checkbox') {
			kind = 'boolean';
		} else if (field.type === 'html' || field.type === 'richText' || field.type === 'textarea') {
			kind = 'exists';
		}

		if (raw !== '') {
			const ops: WhereOperators = {};
			if (kind === 'boolean') ops.equals = raw === 'true';
			else if (kind === 'exists') ops.exists = raw === 'true';
			else if (kind === 'select') ops.equals = raw;
			else ops.contains = raw;
			where[name] = ops;
		}
		facets.push({ name, label: field.label, kind, options, value: raw });
	}

	try {
		const result = await cms.find(
			{ user },
			params.collection,
			{ where: Object.keys(where).length ? where : undefined, page, limit: 20, sort },
			{ depth: 1 }
		);
		return { collection: client, result, search, sort, facets };
	} catch (err) {
		if (err instanceof APIError) error(err.status, err.message);
		throw err;
	}
};

/** Bulk actions over selected ids. */
export const actions: Actions = {
	bulk: async ({ request, locals, params, fetch }) => {
		const { cms, user } = locals;
		const form = await request.formData();
		const op = String(form.get('op') ?? '');
		const ids = form.getAll('ids').map(String).filter(Boolean);
		const actionUrl = String(form.get('actionUrl') ?? '');
		if (ids.length === 0) return fail(400, { message: 'No rows selected' });

		let ok = 0;
		const errors: string[] = [];
		for (const id of ids) {
			try {
				if (op === 'delete') await cms.delete({ user }, params.collection, id);
				else if (op === 'publish') await cms.publish({ user }, params.collection, id);
				else if (op === 'unpublish') await cms.unpublish({ user }, params.collection, id);
				else if (op === 'action' && actionUrl) {
					// Bulk-run a document action against the consumer endpoint.
					const res = await fetch(actionUrl, {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ collection: params.collection, id })
					});
					if (!res.ok) throw new Error(`${res.status}`);
				} else return fail(400, { message: `Unknown bulk op: ${op}` });
				ok++;
			} catch (err) {
				errors.push(`${id}: ${err instanceof Error ? err.message : 'failed'}`);
			}
		}
		return { bulk: { op, ok, failed: errors.length, errors: errors.slice(0, 5) } };
	}
};
