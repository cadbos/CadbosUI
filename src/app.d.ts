/*
 * Copyright (c) 2026 Cadbos company. All rights reserved.
 *
 * SPDX-License-Identifier: LicenseRef-Cadbos-BSL-1.1
 *
 * Cadbos Interior Design AI is licensed under the Business Source License 1.1.
 * Access is limited to automated analysis tools for analysis of this repository.
 * This code is not open for contribution or usage except under a separate
 * written agreement with Cadbos company.
 *
 * Commercial use in Interior Design & AEC Generative AI Services is prohibited
 * before the Change Date. See LICENSE for complete terms.
 */

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
				UPLOADS_PUBLIC_URL?: string;
				// Comma-separated Nostr pubkeys (hex) subject to the local metered
				// credit limit (billing.ts) — everyone else keeps the unlimited,
				// archAI-is-the-only-gate behavior. Not a secret; swap accounts by
				// redeploying this var, no code change needed.
				METERED_DESIGNER_PUBKEYS?: string;
				ADMIN_PUBKEYS?: string;
				PUBKEY_VIEWER?: string;
			};
		}
	}
}

export {};
