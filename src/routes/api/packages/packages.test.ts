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

import { describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import type { PackagesResponse, SessionUser } from '$lib/api/contract';
import { makeD1 } from '$lib/server/testing/d1-shim';

const { GET } = await import('./+server');

type PackagesEvent = Parameters<typeof GET>[0];

function call(user: SessionUser | null, platform: App.Platform): ReturnType<typeof GET> {
	return GET({ locals: { user }, platform } as PackagesEvent);
}

function seedPackage(
	db: D1Database,
	id: string,
	usdAmount: number,
	creditsAwarded: number,
	archaiTokensAwarded: number,
	enabled = 1
): void {
	db.prepare(
		'INSERT INTO packages (id, usd_amount, credits_awarded, archai_tokens_awarded, enabled, created_at) ' +
			'VALUES (?, ?, ?, ?, ?, ?)'
	)
		.bind(id, usdAmount, creditsAwarded, archaiTokensAwarded, enabled, Date.now())
		.run();
}

describe('GET /api/packages', () => {
	it('rejects unauthenticated requests', async () => {
		const response = await call(null, { env: { DB: makeD1() } } as App.Platform);
		expect(response.status).toBe(401);
	});

	it('returns only enabled packages, without the internal archai_tokens_awarded field', async () => {
		const db = makeD1();
		seedPackage(db, 'pkg-1', 1, 3, 3);
		seedPackage(db, 'pkg-5', 5, 15, 15);
		seedPackage(db, 'pkg-disabled', 3, 9, 9, 0);

		const response = await call({ pubkey: 'a'.repeat(64) }, { env: { DB: db } } as App.Platform);

		expect(response.status).toBe(200);
		const result = (await response.json()) as PackagesResponse;
		expect(result).toEqual({
			packages: [
				{ id: 'pkg-1', usdAmount: 1, creditsAwarded: 3 },
				{ id: 'pkg-5', usdAmount: 5, creditsAwarded: 15 }
			]
		});
	});
});
