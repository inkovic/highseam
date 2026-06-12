import type { Handle } from '@sveltejs/kit';
import { createCMSHandle } from '$lib/server';
import cmsConfig from './cms.config';

export const handle: Handle = createCMSHandle(cmsConfig) as Handle;
