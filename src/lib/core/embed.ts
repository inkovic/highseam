/**
 * Embeds: a URL resolved to structured data — never stored third-party HTML.
 *
 * The renderer builds iframes from an allowlist of providers, which is what
 * makes embeds sanitizable. Core ships resolvers for YouTube, Vimeo, and any
 * provider you register with a FIXED oEmbed endpoint. There is deliberately
 * no oEmbed *discovery* (fetching arbitrary editor-supplied URLs to find
 * their oEmbed link) — that's an SSRF vector; a provider registry with fixed
 * hosts and endpoints is not.
 *
 * Provider-specific surfaces rot with their platforms, so core carries only
 * the two that have outlived every page builder, plus the neutral protocol.
 * Everything else (X, TikTok, Maps, …) belongs in your config registry.
 */
import type { EmbedProviderConfig } from './types';

export interface ResolvedEmbed {
	provider: string;
	embedId: string;
	title?: string;
	thumbUrl?: string;
}

/** The two core providers. Registered providers are checked first. */
export const DEFAULT_EMBED_PROVIDERS: EmbedProviderConfig[] = [
	{
		name: 'youtube',
		hosts: ['youtube.com', 'youtu.be', 'youtube-nocookie.com'],
		extractId: (url) => {
			if (url.hostname.endsWith('youtu.be')) return url.pathname.slice(1).split('/')[0] || null;
			const v = url.searchParams.get('v');
			if (v) return v;
			const m = /\/(shorts|embed|live)\/([\w-]{6,20})/.exec(url.pathname);
			return m ? m[2] : null;
		},
		oembed: 'https://www.youtube.com/oembed'
	},
	{
		name: 'vimeo',
		hosts: ['vimeo.com'],
		extractId: (url) => {
			const m = /^\/(\d{6,12})(?:\/|$)/.exec(url.pathname);
			return m ? m[1] : null;
		},
		oembed: 'https://vimeo.com/api/oembed.json'
	}
];

function hostMatches(hostname: string, suffix: string): boolean {
	return hostname === suffix || hostname.endsWith(`.${suffix}`);
}

/**
 * Pure provider match (no network) — safe in the editor for instant badges.
 * Registered providers win over core defaults of the same name.
 */
export function matchEmbedProvider(
	rawUrl: string,
	providers: EmbedProviderConfig[] = []
): { provider: EmbedProviderConfig; embedId: string } | null {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		return null;
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

	const merged = [
		...providers,
		...DEFAULT_EMBED_PROVIDERS.filter((d) => !providers.some((p) => p.name === d.name))
	];
	for (const provider of merged) {
		if (!provider.hosts.some((h) => hostMatches(url.hostname, h))) continue;
		const embedId = provider.extractId ? provider.extractId(url) : rawUrl;
		if (embedId) return { provider, embedId };
	}
	return null;
}

/**
 * Resolve a URL to structured embed data. Network fetch only ever goes to
 * the provider's FIXED oEmbed endpoint; failures degrade to the match
 * without title/thumb (the renderer falls back gracefully). Returns null
 * when no registered provider claims the URL.
 */
export async function resolveEmbed(
	rawUrl: string,
	providers: EmbedProviderConfig[] = [],
	fetchFn: typeof fetch = fetch
): Promise<ResolvedEmbed | null> {
	const match = matchEmbedProvider(rawUrl, providers);
	if (!match) return null;

	const out: ResolvedEmbed = { provider: match.provider.name, embedId: match.embedId };
	if (!match.provider.oembed) return out;

	try {
		const endpoint = new URL(match.provider.oembed);
		endpoint.searchParams.set('url', rawUrl);
		endpoint.searchParams.set('format', 'json');
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), 4000);
		const res = await fetchFn(endpoint.toString(), { signal: ctrl.signal });
		clearTimeout(timer);
		if (!res.ok) return out;
		const data = (await res.json()) as { title?: string; thumbnail_url?: string };
		if (typeof data.title === 'string') out.title = data.title.slice(0, 300);
		if (typeof data.thumbnail_url === 'string' && /^https:\/\//.test(data.thumbnail_url))
			out.thumbUrl = data.thumbnail_url;
	} catch {
		/* resolution is best-effort — the match alone is enough to render */
	}
	// YouTube thumbnails are constructible without a fetch; fill the gap.
	if (!out.thumbUrl && out.provider === 'youtube')
		out.thumbUrl = `https://i.ytimg.com/vi/${out.embedId}/hqdefault.jpg`;
	return out;
}
