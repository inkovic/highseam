import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { handleREST } from '$lib/server/rest';
import { mediaMeta } from '$lib/core/media';
import { toClientCollection } from '$lib/admin/client';
import { APIError, type Doc, type Where } from '$lib/core/types';

/**
 * Option source for the relationship / upload pickers. Modes:
 *
 *   ?ids=a,b,c            resolve ids → options (chips keep their labels)
 *   ?q=<text>             search
 *   ?page= &limit=        paginated browsing (the media picker's grid)
 *   ?mime=image           filter by mime prefix
 *   ?unused=true          only docs not referenced anywhere (upload collections)
 *   ?sort=-createdAt      newest / title / etc.
 *
 * Search matches useAsTitle for ordinary collections. For upload collections
 * it also matches the conventional metadata fields (alt, caption, credit,
 * tags, source.originUrl) — which needs OR, and `Where` is AND-only, so those
 * run as parallel queries merged by id. Every query goes through cms.find, so
 * read access applies to all of them.
 */
export const GET: RequestHandler = ({ locals, params, url }) =>
	handleREST(async () => {
		const cms = locals.cms;
		const col = cms.collection(params.collection);
		const req = { user: locals.user };
		const titleKey = col.admin?.useAsTitle ?? (col.auth ? 'email' : 'id');
		const isUpload = Boolean(cms.uploadConfig(col));

		// ?schema=1 — the collection's client field definitions, for the
		// in-context media edit modal (which decides client-side what's
		// editable). Requires a logged-in user: schema is admin surface.
		if (url.searchParams.get('schema') === '1') {
			if (!locals.user) throw new APIError('Unauthorized', 401);
			return json({ fields: toClientCollection(col).fields, upload: isUpload });
		}

		const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 100);
		const page = Math.max(parseInt(url.searchParams.get('page') ?? '1', 10) || 1, 1);
		const sort = url.searchParams.get('sort') || (isUpload ? '-createdAt' : titleKey);
		const q = (url.searchParams.get('q') ?? '').trim();
		const mime = (url.searchParams.get('mime') ?? '').trim();
		const unused = url.searchParams.get('unused') === 'true';

		const toOption = (d: Doc) => ({
			id: d.id,
			title: String(d[titleKey] ?? d.filename ?? d.id),
			...(typeof d.url === 'string'
				? { url: d.url, mimeType: String(d.mimeType ?? ''), filesize: Number(d.filesize ?? 0) }
				: {}),
			...mediaMeta(d)
		});

		// --- resolve specific ids ------------------------------------------------
		const idsParam = url.searchParams.get('ids');
		if (idsParam) {
			const ids = idsParam.split(',').filter(Boolean);
			const { docs } = await cms.find(req, params.collection, {
				where: { id: { in: ids } },
				limit: 100
			}, { depth: 0 });
			return json({ options: docs.map(toOption), totalDocs: docs.length, page: 1, totalPages: 1 });
		}

		// --- search / browse -----------------------------------------------------
		const base: Where = {};
		if (mime) base.mimeType = { contains: mime };

		// Fields worth matching. Only those the collection actually defines are
		// used, so this stays convention-driven rather than injected schema.
		const fieldNames = new Set(col.fields.map((f) => f.name));
		const searchable = [titleKey, 'filename'].filter((f) => f === 'filename' ? isUpload : true);
		if (isUpload) {
			for (const f of ['alt', 'caption', 'credit', 'tags']) if (fieldNames.has(f)) searchable.push(f);
			// Provenance search: "type the venue slug you remember, not the
			// filename you don't".
			if (fieldNames.has('source')) searchable.push('source.originUrl', 'source.externalKey');
			if (fieldNames.has('firstUsedIn')) searchable.push('firstUsedIn.slug', 'firstUsedIn.title');
		}
		const uniqueSearchable = [...new Set(searchable)].filter((f) => f !== 'id');

		let docs: Doc[] = [];
		let totalDocs = 0;

		if (q && uniqueSearchable.length > 0) {
			// OR across fields: run each and merge, preserving first-seen order.
			const seen = new Map<string, Doc>();
			for (const field of uniqueSearchable) {
				const { docs: hits } = await cms.find(req, params.collection, {
					where: { ...base, [field]: { contains: q } },
					limit: 100,
					sort
				}, { depth: 0 });
				for (const d of hits) if (!seen.has(d.id)) seen.set(d.id, d);
			}
			const all = [...seen.values()];
			totalDocs = all.length;
			docs = all.slice((page - 1) * limit, page * limit);
		} else {
			const result = await cms.find(req, params.collection, {
				where: Object.keys(base).length ? base : undefined,
				limit,
				page,
				sort
			}, { depth: 0 });
			docs = result.docs;
			totalDocs = result.totalDocs;
		}

		// --- unused filter (upload collections) ----------------------------------
		// Computed by scanning references once, not per-document: see findUsage.
		if (unused && isUpload) {
			const referenced = await cms.referencedIds(params.collection);
			docs = docs.filter((d) => !referenced.has(d.id));
			totalDocs = docs.length;
		}

		return json({
			options: docs.map(toOption),
			totalDocs,
			page,
			totalPages: Math.max(Math.ceil(totalDocs / limit), 1)
		});
	});
