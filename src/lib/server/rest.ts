/** Helpers shared by the auto-generated REST endpoints. */
import { json } from '@sveltejs/kit';
import type { FindArgs, Where, WhereOperators } from '$lib/core/types';
import { APIError, ValidationError } from '$lib/core/types';

const OPS = new Set([
	'equals',
	'not_equals',
	'contains',
	'in',
	'greater_than',
	'less_than',
	'exists'
]);

/**
 * Parse Payload-style query params:
 *   ?where[status][equals]=published&limit=10&page=2&sort=-createdAt&depth=1
 */
export function parseFindArgs(url: URL): FindArgs & { depth: number; locale?: string } {
	const where: Where = {};
	for (const [key, value] of url.searchParams) {
		const m = key.match(/^where\[([^\]]+)\]\[([^\]]+)\]$/);
		if (!m) continue;
		const [, field, op] = m;
		if (!OPS.has(op)) continue;
		const ops: WhereOperators = where[field] ?? {};
		switch (op) {
			case 'in':
				ops.in = value.split(',');
				break;
			case 'exists':
				ops.exists = value === 'true';
				break;
			case 'equals':
			case 'not_equals': {
				const v = value === 'true' ? true : value === 'false' ? false : value;
				if (op === 'equals') ops.equals = v;
				else ops.not_equals = v;
				break;
			}
			case 'contains':
				ops.contains = value;
				break;
			case 'greater_than':
				ops.greater_than = value;
				break;
			case 'less_than':
				ops.less_than = value;
				break;
		}
		where[field] = ops;
	}

	return {
		where: Object.keys(where).length ? where : undefined,
		limit: intParam(url, 'limit', 10),
		page: intParam(url, 'page', 1),
		sort: url.searchParams.get('sort') ?? undefined,
		depth: intParam(url, 'depth', 1),
		locale: url.searchParams.get('locale') ?? undefined
	};
}

function intParam(url: URL, name: string, fallback: number): number {
	const raw = url.searchParams.get(name);
	if (raw === null) return fallback;
	const n = parseInt(raw, 10);
	return Number.isNaN(n) ? fallback : n;
}

/** Run an endpoint body and translate CMS errors into JSON responses. */
export async function handleREST(fn: () => Promise<Response>): Promise<Response> {
	try {
		return await fn();
	} catch (err) {
		if (err instanceof ValidationError) {
			return json({ errors: err.errors, message: err.message }, { status: err.status });
		}
		if (err instanceof APIError) {
			return json({ message: err.message }, { status: err.status });
		}
		console.error('[svelte-payload]', err);
		return json({ message: 'Internal server error' }, { status: 500 });
	}
}

export async function readBody(request: Request): Promise<Record<string, unknown>> {
	const type = request.headers.get('content-type') ?? '';
	if (type.includes('application/json')) {
		return (await request.json()) as Record<string, unknown>;
	}
	if (type.includes('form')) {
		const form = await request.formData();
		const out: Record<string, unknown> = {};
		for (const [k, v] of form.entries()) out[k] = v;
		return out;
	}
	throw new APIError('Unsupported content type', 415);
}
