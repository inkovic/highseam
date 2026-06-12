import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { APIError } from '$lib/core/types';
import { handleREST } from '$lib/server/rest';

/**
 * Demo document action — the "Generate with AI" pattern. A custom admin
 * button POSTs { collection, id } here; this endpoint runs whatever
 * pipeline you want through the Local API (hooks + validation included).
 */
export const POST: RequestHandler = ({ locals, request }) =>
	handleREST(async () => {
		if (!locals.user) throw new APIError('Forbidden', 403);
		const { collection, id } = (await request.json()) as { collection: string; id: string };
		if (collection !== 'venues') throw new APIError('Wrong collection', 400);

		const venue = await locals.cms.findByID({ user: locals.user }, 'venues', id, { depth: 0 });

		// Stand-in for the real AI writer pipeline:
		const enriched =
			`<h2>${String(venue.name)}</h2>` +
			`<p><strong>${String(venue.suburb ?? 'Somewhere')}</strong> — rated ${String(venue.rating ?? '?')}/5. ` +
			(venue.dog_friendly ? 'Dogs are welcome here. 🐾' : 'No dogs allowed.') +
			`</p><p><em>Enriched at ${new Date().toISOString()}</em></p>`;

		await locals.cms.update({ user: locals.user }, 'venues', id, { rich_html: enriched });
		return json({ message: '✓ Enriched' });
	});
