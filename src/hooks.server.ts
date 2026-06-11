import type { Handle } from '@sveltejs/kit';
import { getCMS, getUserFromCookies } from '$lib/server';

export const handle: Handle = async ({ event, resolve }) => {
	const cms = getCMS(event.platform);
	event.locals.cms = cms;

	// API key header takes precedence; falls back to the session cookie.
	event.locals.user =
		(await cms.authenticateAPIKey(event.request.headers.get('authorization'))) ??
		(await getUserFromCookies(cms, event.cookies));

	return resolve(event);
};
