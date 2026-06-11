import { json } from '@sveltejs/kit';
import { graphql } from 'graphql';
import type { RequestHandler } from './$types';
import { getSchema } from '$lib/core/graphql';
import { APIError, ValidationError } from '$lib/core/types';

/** POST /api/graphql — { query, variables?, operationName? } */
export const POST: RequestHandler = async ({ locals, request }) => {
	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	if (typeof body.query !== 'string') {
		return json({ errors: [{ message: 'Missing "query"' }] }, { status: 400 });
	}

	const result = await graphql({
		schema: getSchema(locals.cms),
		source: body.query,
		variableValues: (body.variables as Record<string, unknown>) ?? undefined,
		operationName: (body.operationName as string) ?? undefined,
		contextValue: { req: { user: locals.user }, cms: locals.cms }
	});

	// Surface CMS errors with useful messages (graphql-js wraps thrown errors).
	const errors = result.errors?.map((e) => {
		const original = e.originalError;
		if (original instanceof ValidationError)
			return { message: original.message, errors: original.errors, path: e.path };
		if (original instanceof APIError)
			return { message: original.message, status: original.status, path: e.path };
		return { message: e.message, path: e.path };
	});

	return json({ data: result.data, ...(errors ? { errors } : {}) });
};

/** GET /api/graphql?query=... — convenience for simple queries. */
export const GET: RequestHandler = async ({ locals, url }) => {
	const query = url.searchParams.get('query');
	if (!query) {
		return json({
			message: 'svelte-payload GraphQL endpoint. POST { query, variables } or GET ?query=...'
		});
	}
	const result = await graphql({
		schema: getSchema(locals.cms),
		source: query,
		contextValue: { req: { user: locals.user }, cms: locals.cms }
	});
	return json(result);
};
