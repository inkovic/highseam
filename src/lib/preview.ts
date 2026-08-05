/**
 * highseam/preview — the front-end (public site) side of Live Preview.
 *
 * The CMS and public site are usually separate deploys sharing one database.
 * The admin opens `<your-url>?preview=<token>`; your site verifies the token
 * with the SHARED CMS_SECRET and, if valid, renders draft/unpublished content
 * instead of the published row.
 *
 * Framework-agnostic: Web Crypto only (Node + Workers). Import the Svelte
 * <PreviewBanner> from 'highseam/PreviewBanner.svelte'.
 */
import { verifyJWT } from './core/crypto.js';

export interface PreviewClaims {
	/** Document id. */
	id: string;
	/** Collection slug. */
	collection: string;
}

/**
 * Verify a preview token against your CMS_SECRET. Returns the document
 * reference if valid and unexpired, else null.
 *
 *   const claims = await verifyPreviewToken(env.CMS_SECRET, url.searchParams.get('preview'));
 *   const doc = claims
 *     ? await readDraft(claims.collection, claims.id)   // your data access
 *     : await readPublished(slug);
 */
export async function verifyPreviewToken(
	secret: string,
	token: string | null | undefined
): Promise<PreviewClaims | null> {
	if (!token) return null;
	const payload = await verifyJWT(token, secret);
	if (!payload || payload.preview !== true) return null;
	return { id: payload.sub, collection: payload.col };
}

/**
 * Mode B (live) subscription: when the page is inside the admin's preview
 * iframe, the edit form postMessages the in-progress document as you type.
 * Call this in your preview route to re-render from the live payload without
 * a round-trip. Returns an unsubscribe function. No-op outside a browser.
 */
export function onPreviewData<T = Record<string, unknown>>(
	callback: (doc: T) => void,
	options: { origin?: string } = {}
): () => void {
	if (typeof window === 'undefined') return () => {};
	const handler = (event: MessageEvent) => {
		if (options.origin && event.origin !== options.origin) return;
		const data = event.data as { type?: string; doc?: T } | null;
		if (data && data.type === 'highseam:preview' && data.doc) callback(data.doc);
	};
	window.addEventListener('message', handler);
	// Tell the parent we're ready to receive (admin starts sending on ack).
	try {
		window.parent?.postMessage({ type: 'highseam:preview-ready' }, options.origin ?? '*');
	} catch {
		/* cross-origin parent; fine */
	}
	return () => window.removeEventListener('message', handler);
}

/** True if the page is being rendered inside the admin preview iframe. */
export function isPreviewing(): boolean {
	return typeof window !== 'undefined' && window.self !== window.top;
}
