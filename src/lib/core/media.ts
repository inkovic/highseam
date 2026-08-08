/**
 * Media metadata: describe once, use everywhere.
 *
 * Deliberately **convention, not injection**. Upload collections already get
 * managed `filename` / `mimeType` / `filesize` / `url`. Rather than also
 * injecting alt/caption/credit/tags — which would fight consumers who already
 * define them, and force a schema on people who don't want one — we simply
 * *use* those fields when a collection happens to declare them. Define `alt`
 * on your media collection and it becomes the inherited default; don't, and
 * nothing changes.
 */
import type { Doc } from './types';

/** Conventional metadata field names read off an upload document. */
export const MEDIA_META_FIELDS = ['alt', 'caption', 'credit', 'tags', 'focalPoint'] as const;

export interface FocalPoint {
	/** Schema version, so the shape can grow without a migration. */
	v: 1;
	/** Normalised 0–1 coordinates of the point that must survive any crop. */
	x: number;
	y: number;
}

export interface MediaMeta {
	alt?: string;
	caption?: string;
	credit?: string;
	tags?: string[];
	focalPoint?: FocalPoint;
}

export interface ResolvedMedia extends MediaMeta {
	id: string;
	url: string;
	mimeType: string;
	filesize: number;
	filename: string;
	isImage: boolean;
}

function asStringArray(v: unknown): string[] | undefined {
	if (Array.isArray(v)) return v.map(String).filter(Boolean);
	if (typeof v === 'string' && v.trim()) return v.split(',').map((s) => s.trim()).filter(Boolean);
	return undefined;
}

export function normalizeFocalPoint(v: unknown): FocalPoint | undefined {
	if (!v || typeof v !== 'object') return undefined;
	const o = v as Record<string, unknown>;
	const x = Number(o.x);
	const y = Number(o.y);
	if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
	return { v: 1, x: Math.min(Math.max(x, 0), 1), y: Math.min(Math.max(y, 0), 1) };
}

/** Pull the conventional metadata off a media document (absent keys omitted). */
export function mediaMeta(doc: Doc): MediaMeta {
	const meta: MediaMeta = {};
	if (typeof doc.alt === 'string' && doc.alt) meta.alt = doc.alt;
	if (typeof doc.caption === 'string' && doc.caption) meta.caption = doc.caption;
	if (typeof doc.credit === 'string' && doc.credit) meta.credit = doc.credit;
	const tags = asStringArray(doc.tags);
	if (tags?.length) meta.tags = tags;
	const fp = normalizeFocalPoint(doc.focalPoint);
	if (fp) meta.focalPoint = fp;
	return meta;
}

/**
 * Resolve a media reference for rendering: the image's own metadata, with
 * per-use overrides on top. One helper so every consumer inherits identically
 * instead of each renderer inventing its own precedence.
 *
 *   const img = resolveMedia(post.coverImage, { alt: post.coverAlt });
 *   // img.alt === post.coverAlt || media.alt
 *
 * Returns null for an unpopulated reference (a bare id string), so callers
 * can tell "not loaded" from "no image".
 */
export function resolveMedia(
	doc: unknown,
	overrides: MediaMeta = {}
): ResolvedMedia | null {
	if (!doc || typeof doc !== 'object') return null;
	const d = doc as Doc;
	if (typeof d.url !== 'string') return null;

	const inherited = mediaMeta(d);
	const mimeType = String(d.mimeType ?? '');
	return {
		id: String(d.id),
		url: d.url,
		mimeType,
		filesize: Number(d.filesize ?? 0),
		filename: String(d.filename ?? ''),
		isImage: mimeType.startsWith('image/'),
		// Overrides win, but only when actually provided — an empty string
		// means "no alt" and is respected; undefined means "inherit".
		alt: overrides.alt ?? inherited.alt,
		caption: overrides.caption ?? inherited.caption,
		credit: overrides.credit ?? inherited.credit,
		tags: overrides.tags ?? inherited.tags,
		focalPoint: overrides.focalPoint ?? inherited.focalPoint
	};
}

/**
 * CSS `object-position` for a focal point — the cheapest possible way to
 * honour a hotspot with no transform layer at all. Works with object-fit:cover
 * in any consumer, today.
 */
export function focalObjectPosition(fp: FocalPoint | undefined): string {
	if (!fp) return '50% 50%';
	return `${Math.round(fp.x * 100)}% ${Math.round(fp.y * 100)}%`;
}

/** Parse '16:7' / '1200:630' / '3:2' into {w, h}. Returns null on garbage. */
export function parseRatio(ratio: string): { w: number; h: number } | null {
	const m = /^(\d+(?:\.\d+)?)\s*[:/x]\s*(\d+(?:\.\d+)?)$/.exec(ratio.trim());
	if (!m) return null;
	const w = Number(m[1]);
	const h = Number(m[2]);
	return w > 0 && h > 0 ? { w, h } : null;
}

export interface MediaSrcOptions {
	/** Output width in px. */
	width?: number;
	/** Output height in px (or derive from `aspect`). */
	height?: number;
	/** Aspect ratio like '16:7' — with `width`, computes height and crops. */
	aspect?: string;
	/** 1–100. */
	quality?: number;
	/** Default 'auto' (webp/avif per browser). */
	format?: 'auto' | 'webp' | 'avif' | 'json';
	/** Extra raw cdn-cgi options, e.g. { sharpen: '1' }. */
	extra?: Record<string, string | number>;
}

/**
 * Build a Cloudflare Image Transformations URL for a media doc:
 * `/cdn-cgi/image/<options>/<original-url>` — resized/cropped at the edge,
 * gravity taken from the image's focal point, one original in R2.
 *
 * Requires Image Transformations enabled on the serving zone. Where it isn't
 * (or for docs without a url), this returns the ORIGINAL url unchanged —
 * pair with focalObjectPosition() and object-fit:cover and the hotspot still
 * steers the crop, just client-side.
 */
export function mediaSrc(doc: unknown, opts: MediaSrcOptions = {}): string {
	const d = doc as Doc | null;
	const url = d && typeof d === 'object' && typeof d.url === 'string' ? d.url : '';
	if (!url) return '';

	let { width, height } = opts;
	if (!height && width && opts.aspect) {
		const r = parseRatio(opts.aspect);
		if (r) height = Math.round((width * r.h) / r.w);
	}
	// Nothing to transform → original (the graceful-fallback contract).
	if (!width && !height) return url;

	const fp = normalizeFocalPoint((d as Doc).focalPoint);
	const parts: string[] = [];
	if (width) parts.push(`width=${Math.round(width)}`);
	if (height) parts.push(`height=${Math.round(height)}`);
	if (width && height) {
		parts.push('fit=crop');
		parts.push(fp ? `gravity=${fp.x.toFixed(3)}x${fp.y.toFixed(3)}` : 'gravity=auto');
	} else {
		parts.push('fit=scale-down');
	}
	parts.push(`format=${opts.format ?? 'auto'}`);
	if (opts.quality) parts.push(`quality=${Math.min(Math.max(opts.quality, 1), 100)}`);
	for (const [k, v] of Object.entries(opts.extra ?? {})) parts.push(`${k}=${v}`);

	return `/cdn-cgi/image/${parts.join(',')}${url.startsWith('/') ? url : `/${url}`}`;
}
