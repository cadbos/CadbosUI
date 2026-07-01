import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { SessionUser } from '$lib/api/contract';

// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			user: SessionUser | null;
		}
		// interface PageData {}
		// interface PageState {}
		// `ctx`/`caches`/`cf` come from adapter-cloudflare's ambient types; `env` is
		// typed here (the adapter intentionally leaves it to the app).
		interface Platform {
			env: {
				DB: D1Database;
				ARCHAI_API_KEY: string;
				UPLOADS_BUCKET: R2Bucket;
			};
		}
	}
}

export {};
