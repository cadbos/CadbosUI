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
import type { PackagesResponse, SessionUser } from '$lib/api/contract';
import { makeD1 } from '$lib/server/testing/d1-shim';

const { GET } = await import('./+server');

type PackagesEvent = Parameters<typeof GET>[0];

function call(user: SessionUser | null, platform: App.Platform): ReturnType<typeof GET> {
	return GET({ locals: { user }, platform } as PackagesEvent);
}

describe('GET /api/packages', () => {
	it('rejects unauthenticated requests', async () => {
		const response = await call(null, { env: { DB: makeD1() } } as App.Platform);
		expect(response.status).toBe(401);
	});

	it('returns only enabled packages, without the internal archai_tokens_awarded field', async () => {
		const db = makeD1();
		db.prepare(
			'INSERT INTO packages (id, usd_amount, credits_awarded, archai_tokens_awarded, enabled, created_at) ' +
				'VALUES (?, ?, ?, ?, ?, ?)'
		)
			.bind('pkg-disabled', 4, 12, 12, 0, Date.now())
			.run();

		const response = await call({ pubkey: 'a'.repeat(64) }, { env: { DB: db } } as App.Platform);

		expect(response.status).toBe(200);
		const result = (await response.json()) as PackagesResponse;
		expect(result).toEqual({
			packages: [
				{ id: 'pkg-1', usdAmount: 1, creditsAwarded: 3 },
				{ id: 'pkg-3', usdAmount: 3, creditsAwarded: 9 },
				{ id: 'pkg-5', usdAmount: 5, creditsAwarded: 15 }
			]
		});
	});
});
