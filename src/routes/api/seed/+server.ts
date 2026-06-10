import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import type { RequestHandler } from './$types';
import { seed } from '$lib/server/seed';

/**
 * POST /api/seed — dev-only convenience to load demo content.
 * Body: { "email": "...", "password": "..." } for the admin user.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!dev) return json({ message: 'Seeding is dev-only' }, { status: 403 });
	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	const email = typeof body.email === 'string' ? body.email : 'admin@example.com';
	const password = typeof body.password === 'string' ? body.password : 'password123';
	const message = await seed(locals.cms, email, password);
	return json({ message });
};
