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

import type { D1Database } from '@cloudflare/workers-types';
import { describe, expect, it } from 'vitest';
import type { PackageRecord, SessionUser } from '$lib/api/contract';
import { makeD1 } from '$lib/server/testing/d1-shim';
import { GET } from './+server';

type PackagesEvent = Parameters<typeof GET>[0];

function call(user: SessionUser | null, db: D1Database): ReturnType<typeof GET> {
	return GET({ locals: { user }, platform: { env: { DB: db } } } as PackagesEvent);
}

describe('GET /api/packages', () => {
	it('requires authentication', async () => {
		const response = await call(null, makeD1());

		expect(response.status).toBe(401);
	});

	it('returns only enabled public package fields', async () => {
		const db = makeD1();
		db.prepare(
			'INSERT INTO packages (id, usd_amount_cents, credits_awarded_units, archai_tokens_awarded_units, enabled, created_at) ' +
				'VALUES (?, ?, ?, ?, ?, ?)'
		)
			.bind('pkg-disabled', 400, 1_200, 1_200, 0, Date.now())
			.run();

		const response = await call({ pubkey: 'pubkey-1' }, db);
		const result = (await response.json()) as { packages: PackageRecord[] };

		expect(response.status).toBe(200);
		expect(result).toEqual({
			packages: [
				{ id: 'pkg-1', usdAmount: 1, creditsAwarded: 3 },
				{ id: 'pkg-3', usdAmount: 3, creditsAwarded: 9 },
				{ id: 'pkg-5', usdAmount: 5, creditsAwarded: 15 }
			]
		});
	});
});
