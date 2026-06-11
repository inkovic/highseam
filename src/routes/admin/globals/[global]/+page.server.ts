import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { toClientGlobal } from '$lib/admin/client';
import { formToData } from '$lib/admin/form';
import { loadRelOptions } from '$lib/admin/server';
import { APIError, ValidationError } from '$lib/core/types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const { cms, user } = locals;
	if (!cms.hasGlobal(params.global)) error(404, 'Unknown global');
	const g = cms.global(params.global);

	try {
		const doc = await cms.findGlobal({ user }, params.global, { depth: 0 });
		return {
			global: toClientGlobal(g),
			doc,
			relOptions: await loadRelOptions(cms, { user }, { slug: g.slug, fields: g.fields })
		};
	} catch (err) {
		if (err instanceof APIError) error(err.status, err.message);
		throw err;
	}
};

export const actions: Actions = {
	default: async ({ request, locals, params }) => {
		const { cms, user } = locals;
		if (!cms.hasGlobal(params.global)) error(404, 'Unknown global');
		const g = cms.global(params.global);
		const data = formToData(await request.formData(), { slug: g.slug, fields: g.fields });

		try {
			await cms.updateGlobal({ user }, params.global, data);
			return { saved: true };
		} catch (err) {
			if (err instanceof ValidationError) return fail(err.status, { errors: err.errors });
			if (err instanceof APIError) return fail(err.status, { message: err.message });
			throw err;
		}
	}
};
