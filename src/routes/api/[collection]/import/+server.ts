import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { handleREST } from '$lib/server/rest';
import { APIError } from '$lib/core/types';

const MAX_BATCH = 50;

/**
 * POST /api/:collection/import — provenance-aware import for pipelines.
 *
 * JSON mode (adopt-in-place / metadata, batchable):
 *   { "items": [ { "storageKey": "venues/8545.webp", "mimeType": "image/webp",
 *                  "data": { "source": { "kind": "import", "via": "…",
 *                            "originUrl": "…", "externalKey": "venue:8545" },
 *                            "firstUsedIn": {…}, "alt": "…" } }, … ] }
 *
 * Multipart mode (bytes + provenance, one file per call):
 *   file=<binary> data=<json-string> [dedupeKey=source.externalKey]
 *
 * Batches are capped at 50 and report PER-ITEM outcomes — designed for
 * paced, resumable, idempotent runs over hours, not one atomic bulk call.
 * Re-running a batch is safe: matching externalKeys come back
 * 'updated' or 'unchanged', never duplicated.
 */
export const POST: RequestHandler = ({ locals, params, request }) =>
	handleREST(async () => {
		const cms = locals.cms;
		const req = { user: locals.user };
		const type = request.headers.get('content-type') ?? '';

		// --- multipart: single file + provenance -------------------------------
		if (type.includes('multipart/form-data')) {
			const form = await request.formData();
			const file = form.get('file');
			if (!file || typeof file === 'string') throw new APIError('Multipart import needs a `file`', 400);
			const dataRaw = form.get('data');
			const data =
				typeof dataRaw === 'string' && dataRaw ? (JSON.parse(dataRaw) as Record<string, unknown>) : {};
			const dedupeKey = typeof form.get('dedupeKey') === 'string' ? String(form.get('dedupeKey')) : undefined;

			const { doc, action } = await cms.importMedia(req, params.collection, { file, data, dedupeKey });
			return json({ doc, action });
		}

		// --- JSON: batch of adopt/metadata items -------------------------------
		const body = (await request.json().catch(() => null)) as {
			items?: Record<string, unknown>[];
			dedupeKey?: string;
		} | null;
		if (!body?.items || !Array.isArray(body.items)) {
			throw new APIError('JSON import needs { items: [...] }', 400);
		}
		if (body.items.length > MAX_BATCH) {
			throw new APIError(`Batch too large: ${body.items.length} > ${MAX_BATCH}. Send paced batches.`, 413);
		}

		const results: {
			ok: boolean;
			action?: 'created' | 'updated' | 'unchanged';
			id?: string;
			externalKey?: string;
			message?: string;
		}[] = [];

		for (const raw of body.items) {
			const data = (raw.data as Record<string, unknown>) ?? {};
			const externalKey =
				typeof (data.source as Record<string, unknown> | undefined)?.externalKey === 'string'
					? String((data.source as Record<string, unknown>).externalKey)
					: undefined;
			try {
				const { doc, action } = await cms.importMedia(req, params.collection, {
					storageKey: typeof raw.storageKey === 'string' ? raw.storageKey : undefined,
					filename: typeof raw.filename === 'string' ? raw.filename : undefined,
					mimeType: typeof raw.mimeType === 'string' ? raw.mimeType : undefined,
					filesize: typeof raw.filesize === 'number' ? raw.filesize : undefined,
					dedupeKey: body.dedupeKey,
					data
				});
				results.push({ ok: true, action, id: doc.id, externalKey });
			} catch (err) {
				results.push({
					ok: false,
					externalKey,
					message: err instanceof APIError ? err.message : 'Import failed'
				});
			}
		}

		const summary = {
			created: results.filter((r) => r.action === 'created').length,
			updated: results.filter((r) => r.action === 'updated').length,
			unchanged: results.filter((r) => r.action === 'unchanged').length,
			failed: results.filter((r) => !r.ok).length
		};
		return json({ results, summary });
	});
