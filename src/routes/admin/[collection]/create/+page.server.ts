import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { toClientCollection } from '$lib/admin/client';
import { formToData } from '$lib/admin/form';
import { loadRelOptions } from '$lib/admin/server';
import { APIError, ValidationError } from '$lib/core/types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const { cms, user } = locals;
	if (!cms.hasCollection(params.collection)) error(404, 'Unknown collection');
	const col = cms.collection(params.collection);
	return {
		collection: toClientCollection(col),
		relOptions: await loadRelOptions(cms, { user }, col)
	};
};

async function create(
	{ request, locals, params }: Parameters<NonNullable<Actions[string]>>[0],
	draft: boolean
) {
	const { cms, user } = locals;
	if (!cms.hasCollection(params.collection!)) error(404, 'Unknown collection');
	const col = cms.collection(params.collection!);
	const form = await request.formData();
	const data = formToData(form, col);

	try {
		const doc = await cms.create({ user }, params.collection!, data, { draft });
		redirect(303, `/admin/${params.collection}/${doc.id}?created=1`);
	} catch (err) {
		if (err instanceof ValidationError)
			return fail(err.status, { errors: err.errors, values: jsonSafe(data) });
		if (err instanceof APIError)
			return fail(err.status, { message: err.message, values: jsonSafe(data) });
		throw err;
	}
}

// Note: SvelteKit forbids mixing `default` with named actions, so both are named.
export const actions: Actions = {
	create: (event) => create(event, false),
	draft: (event) => create(event, true)
};

function jsonSafe(data: Record<string, unknown>): Record<string, unknown> {
	return JSON.parse(JSON.stringify(data));
}
