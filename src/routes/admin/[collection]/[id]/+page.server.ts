import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { toClientCollection } from '$lib/admin/client';
import { formToData } from '$lib/admin/form';
import { loadRelOptions } from '$lib/admin/server';
import { APIError, ValidationError, type Doc } from '$lib/core/types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const { cms, user } = locals;
	if (!cms.hasCollection(params.collection)) error(404, 'Unknown collection');
	const col = cms.collection(params.collection);
	const client = toClientCollection(col);
	const locale = url.searchParams.get('locale') ?? undefined;

	try {
		// depth 0: the edit form needs raw relationship ids, not populated docs
		const doc = await cms.findByID({ user }, params.collection, params.id, { depth: 0, locale });

		// Drafts: edit the latest draft, not the published copy.
		let formDoc = doc;
		let hasDraftChanges = false;
		if (client.drafts) {
			const draft = await cms.findByID({ user }, params.collection, params.id, {
				depth: 0,
				draft: true,
				locale
			});
			hasDraftChanges = (draft.updatedAt ?? '') > (doc.updatedAt ?? '');
			formDoc = draft;
		}

		let versions: { id: string; createdAt: string; status: string; title: string }[] = [];
		if (client.versioned) {
			const list = await cms.findVersions({ user }, params.collection, params.id);
			versions = list.slice(0, 15).map((v) => {
				const snap = (v.snapshot ?? {}) as Doc;
				const title = snap[client.useAsTitle];
				return {
					id: v.id,
					createdAt: String(v.createdAt ?? ''),
					status: String(snap._status ?? '—'),
					title:
						title && typeof title === 'object'
							? String(Object.values(title)[0] ?? '')
							: String(title ?? snap.id ?? '')
				};
			});
		}

		// Document locking: try to take the edit lock.
		const lock = await cms.takeLock(params.collection, params.id, user);

		// Media docs: live usage backlinks ("used in N places") + provenance.
		let usage: { collection: string; id: string; field: string; title: string }[] = [];
		if (cms.uploadConfig(col)) {
			usage = await cms.findUsage(params.collection, params.id);
		}

		// Live preview: mint a short-lived token and resolve the public URL.
		let previewUrl: string | null = null;
		if (col.admin?.preview) {
			const token = await cms.signPreviewToken(params.collection, params.id);
			try {
				previewUrl = col.admin.preview.url(doc, token);
			} catch {
				previewUrl = null;
			}
		}

		return {
			collection: client,
			doc: formDoc,
			liveStatus: String(doc._status ?? ''),
			hasDraftChanges,
			versions,
			relOptions: await loadRelOptions(cms, { user }, col),
			locale: locale ?? cms.config.localization?.defaultLocale ?? null,
			locales: cms.config.localization?.locales ?? [],
			hasLocalizedFields: col.fields.some((f) => f.localized),
			usage,
			mediaAspects: cms.config.media?.aspects ?? [],
		galleryLayouts: cms.config.media?.galleryLayouts ?? [],
			lockedBy: lock.lockedBy,
			previewUrl
		};
	} catch (err) {
		if (err instanceof APIError) error(err.status, err.message);
		throw err;
	}
};

function asActionError(err: unknown) {
	if (err instanceof ValidationError) return fail(err.status, { errors: err.errors });
	if (err instanceof APIError) return fail(err.status, { message: err.message });
	throw err;
}

function localeOf(url: URL): string | undefined {
	return url.searchParams.get('locale') ?? undefined;
}

export const actions: Actions = {
	/** Plain save (non-draft collections). */
	save: async ({ request, locals, params, url }) => {
		const { cms, user } = locals;
		const col = cms.collection(params.collection);
		const data = formToData(await request.formData(), col);
		try {
			await cms.update({ user }, params.collection, params.id, data, { locale: localeOf(url) });
			await cms.releaseLock(params.collection, params.id, user);
			return { saved: true };
		} catch (err) {
			return asActionError(err);
		}
	},

	/** Save form contents as a draft version; published doc untouched. */
	saveDraft: async ({ request, locals, params, url }) => {
		const { cms, user } = locals;
		const col = cms.collection(params.collection);
		const data = formToData(await request.formData(), col);
		try {
			await cms.update({ user }, params.collection, params.id, data, {
				draft: true,
				locale: localeOf(url)
			});
			return { saved: true, draft: true };
		} catch (err) {
			return asActionError(err);
		}
	},

	/** Save form contents as a draft, then promote it to published. */
	publish: async ({ request, locals, params, url }) => {
		const { cms, user } = locals;
		const col = cms.collection(params.collection);
		const data = formToData(await request.formData(), col);
		try {
			await cms.update({ user }, params.collection, params.id, data, {
				draft: true,
				locale: localeOf(url)
			});
			await cms.publish({ user }, params.collection, params.id);
			await cms.releaseLock(params.collection, params.id, user);
			return { saved: true, published: true };
		} catch (err) {
			return asActionError(err);
		}
	},

	unpublish: async ({ locals, params }) => {
		try {
			await locals.cms.unpublish({ user: locals.user }, params.collection, params.id);
			return { saved: true, unpublished: true };
		} catch (err) {
			return asActionError(err);
		}
	},

	restore: async ({ request, locals, params }) => {
		const form = await request.formData();
		const versionId = String(form.get('versionId') ?? '');
		try {
			await locals.cms.restoreVersion({ user: locals.user }, params.collection, params.id, versionId);
			return { saved: true, restored: true };
		} catch (err) {
			return asActionError(err);
		}
	},

	delete: async ({ locals, params }) => {
		try {
			await locals.cms.delete({ user: locals.user }, params.collection, params.id);
			await locals.cms.releaseLock(params.collection, params.id, locals.user);
		} catch (err) {
			return asActionError(err);
		}
		redirect(303, `/admin/${params.collection}`);
	}
};
