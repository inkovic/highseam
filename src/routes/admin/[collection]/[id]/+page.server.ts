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

	try {
		// depth 0: the edit form needs raw relationship ids, not populated docs
		const doc = await cms.findByID({ user }, params.collection, params.id, { depth: 0 });
		return {
			collection: toClientCollection(col),
			doc,
			relOptions: await loadRelOptions(cms, { user }, col)
		};
	} catch (err) {
		if (err instanceof APIError) error(err.status, err.message);
		throw err;
	}
};

export const actions: Actions = {
	save: async ({ request, locals, params }) => {
		const { cms, user } = locals;
		const col = cms.collection(params.collection);
		const form = await request.formData();
		const data = formToData(form, col);

		try {
			await cms.update({ user }, params.collection, params.id, data);
			return { saved: true };
		} catch (err) {
			if (err instanceof ValidationError) return fail(err.status, { errors: err.errors });
			if (err instanceof APIError) return fail(err.status, { message: err.message });
			throw err;
		}
	},
	delete: async ({ locals, params }) => {
		const { cms, user } = locals;
		try {
			await cms.delete({ user }, params.collection, params.id);
		} catch (err) {
			if (err instanceof APIError) return fail(err.status, { message: err.message });
			throw err;
		}
		redirect(303, `/admin/${params.collection}`);
	}
};
