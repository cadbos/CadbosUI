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

import jwt from 'jsonwebtoken';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFeaturebaseJwt } from './featurebase';

const pubkey = 'a'.repeat(64);

afterEach(() => {
	vi.restoreAllMocks();
});

describe('createFeaturebaseJwt', () => {
	it('signs the Nostr pubkey as the Featurebase user ID with HS256', () => {
		const token = createFeaturebaseJwt({ pubkey }, 'featurebase-secret');
		expect(token).not.toBeNull();

		const decoded = jwt.verify(token!, 'featurebase-secret', {
			algorithms: ['HS256'],
			complete: true
		});
		expect(decoded.header.alg).toBe('HS256');
		expect(decoded.payload).toEqual({ userId: pubkey, iat: expect.any(Number) });
	});

	it.each([undefined, '', '   '])('returns null for an unconfigured secret', (secret) => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});

		expect(createFeaturebaseJwt({ pubkey }, secret)).toBeNull();
		expect(error).toHaveBeenCalledWith(
			'Featurebase user identification disabled: FEATUREBASE_JWT_SECRET is not configured'
		);
	});
});
