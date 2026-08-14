/**
 * Links: internal document reference OR external URL, one value.
 *
 * Internal links store `{ doc: { collection, id } }` — by id, not by href —
 * so slug renames never break stored links (a no-redirects policy expressed
 * as a field type; the internal-link rewrite migration this replaces should
 * never need to run again). External links store `{ url }`.
 *
 * Route mapping is consumer knowledge: highseam knows which DOCUMENT a link
 * targets, your app knows what URL that document lives at. `linkHref()`
 * takes that mapping.
 */
import type { Doc } from './types';

export interface LinkValue {
	/** External destination (http(s), mailto:, tel:, or site-relative /path). */
	url?: string;
	/** Internal destination, stored by id. */
	doc?: { collection: string; id: string; /** filled by populate at depth ≥ 1 */ resolved?: Doc };
	newTab?: boolean;
}

export const LINK_URL_RE = /^(https?:\/\/|mailto:|tel:|\/(?!\/))/i;

/**
 * Resolve a link value to an href. `routes` maps collection slugs to
 * URL builders over the populated target doc; unresolvable internal links
 * (not populated, dangling, or no route registered) return null so callers
 * can skip rendering the anchor rather than emit a dead '#'.
 */
export function linkHref(
	value: unknown,
	routes: Record<string, (doc: Doc) => string> = {}
): string | null {
	if (!value || typeof value !== 'object') return null;
	const v = value as LinkValue;
	if (typeof v.url === 'string' && LINK_URL_RE.test(v.url)) return v.url;
	if (v.doc?.resolved && routes[v.doc.collection]) return routes[v.doc.collection](v.doc.resolved);
	return null;
}

/** target/rel attribute pair for a link value (safe pairing for new tabs). */
export function linkAttrs(value: unknown): { target?: string; rel?: string } {
	const v = (value ?? {}) as LinkValue;
	return v.newTab ? { target: '_blank', rel: 'noopener' } : {};
}
