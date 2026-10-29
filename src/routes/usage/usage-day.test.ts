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
import { localDateKey, localDay, userUsageHref } from './usage-day';

describe('localDateKey', () => {
	it('formats the local calendar day', () => {
		expect(localDateKey(new Date(2026, 0, 2, 23, 59).getTime())).toBe('2026-01-02');
	});
});

describe('localDay', () => {
	it('spans the local day', () => {
		expect(localDay('2026-03-09')).toEqual({
			date: '2026-03-09',
			from: new Date(2026, 2, 9).getTime(),
			to: new Date(2026, 2, 10).getTime()
		});
	});

	it.each(['2026-02-30', '2026-13-01', '2026-1-1', 'yesterday', ''])('rejects %s', (value) => {
		expect(localDay(value)).toBeNull();
	});
});

describe('userUsageHref', () => {
	it('links to the user page with and without a day', () => {
		expect(userUsageHref('npub1abc')).toBe('/usage/by-user?npub=npub1abc');
		expect(userUsageHref('npub1abc', '2026-01-02')).toBe(
			'/usage/by-user?npub=npub1abc&date=2026-01-02'
		);
	});
});
