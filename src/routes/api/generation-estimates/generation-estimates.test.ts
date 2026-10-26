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
import type { SessionUser } from '$lib/api/contract';
import { makeD1 } from '$lib/server/testing/d1-shim';
import { GET } from './+server';

type EstimatesEvent = Parameters<typeof GET>[0];

function call(user: SessionUser | null, db: D1Database): ReturnType<typeof GET> {
	return GET({
		platform: { env: { DB: db } } as App.Platform,
		locals: { sessionLookupUnavailable: false, user }
	} as EstimatesEvent);
}

describe('GET /api/generation-estimates', () => {
	it('requires authentication', async () => {
		const response = await call(null, makeD1());

		expect(response.status).toBe(401);
	});

	it('returns the estimates as a privately cacheable response', async () => {
		const response = await call({ pubkey: 'pubkey-1' }, makeD1());

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('private, max-age=300');
		expect(await response.json()).toEqual({ estimates: [] });
	});
});
