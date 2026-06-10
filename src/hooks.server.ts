import type { Handle } from '@sveltejs/kit';
import { getCMS, getUserFromCookies } from '$lib/server';

export const handle: Handle = async ({ event, resolve }) => {
	const cms = getCMS(event.platform);
	event.locals.cms = cms;
	event.locals.user = await getUserFromCookies(cms, event.cookies);
	return resolve(event);
};
