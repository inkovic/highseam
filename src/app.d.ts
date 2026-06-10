import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { CMS } from '$lib/core/cms';
import type { Doc } from '$lib/core/types';

declare global {
	namespace App {
		interface Locals {
			cms: CMS;
			user: Doc | null;
		}
		interface Platform {
			env?: {
				DB?: D1Database;
				BUCKET?: R2Bucket;
				CMS_SECRET?: string;
			};
		}
	}
}

export {};
