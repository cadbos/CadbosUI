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

import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseRetryAfter } from './job-polling';

afterEach(() => {
	vi.restoreAllMocks();
});

describe('job polling delay', () => {
	it('uses two seconds when Retry-After is absent', () => {
		expect(parseRetryAfter(new Headers())).toBe(2_000);
		expect(parseRetryAfter(new Headers({ 'content-type': 'application/json' }))).toBe(2_000);
	});

	it.each(['', ' ', 'invalid', 'NaN', 'Infinity', '1e309', '1e308'])(
		'uses two seconds for an invalid header value %j',
		(value) => {
			expect(parseRetryAfter(new Headers({ 'retry-after': value }))).toBe(2_000);
		}
	);

	it.each([
		['1', 1_000],
		['2', 2_000],
		['60', 60_000],
		['2147483', 2_147_483_000]
	] as const)('uses %s seconds from the header', (value, expected) => {
		expect(parseRetryAfter(new Headers({ 'retry-after': value }))).toBe(expected);
	});

	it('preserves the minimum delay and prevents timer overflow', () => {
		expect(parseRetryAfter(new Headers({ 'retry-after': '0' }))).toBe(1_000);
		expect(parseRetryAfter(new Headers({ 'retry-after': '-1' }))).toBe(1_000);
		expect(parseRetryAfter(new Headers({ 'retry-after': '2147484' }))).toBe(2_147_483_647);
	});

	it('reads the header case-insensitively and leaves the Headers object unchanged', () => {
		const headers = new Headers({ 'Retry-After': '60', 'content-type': 'application/json' });
		expect(parseRetryAfter(headers)).toBe(60_000);
		expect(headers.get('Retry-After')).toBe('60');
		expect(headers.get('content-type')).toBe('application/json');
	});

	it('honors HTTP dates including delays longer than thirty seconds', () => {
		const now = Date.UTC(2026, 9, 26);
		vi.spyOn(Date, 'now').mockReturnValue(now);
		expect(
			parseRetryAfter(new Headers({ 'retry-after': new Date(now + 60_000).toUTCString() }))
		).toBe(60_000);
		expect(
			parseRetryAfter(new Headers({ 'retry-after': new Date(now - 60_000).toUTCString() }))
		).toBe(1_000);
	});
});
