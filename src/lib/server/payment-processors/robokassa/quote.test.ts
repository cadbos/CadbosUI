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

import { expect, it } from 'vitest';
import { quoteRubAmount } from './quote';
it.each<[number, number, number, string]>([
	[100, 82, 8200, '82'],
	[100, 82.51, 8251, '82.51'],
	[1, 82.5, 83, '82.5'],
	[1, 82.49, 82, '82.49'],
	[1, 1e3, 1000, '1000'],
	[10000000, 1e-7, 1, '0.0000001'],
	[1, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, String(Number.MAX_SAFE_INTEGER)],
	[1, 0.5, 1, '0.5']
])('converts %s cents at %s exactly', (cents, rate, amountMinor, rubPerUsd) => {
	expect(quoteRubAmount(cents, rate)).toEqual({ amountMinor, rubPerUsd });
});
it.each([
	[1, 0.49999999999999994],
	[1, 1e-7],
	[1, 1e21],
	[Number.MAX_SAFE_INTEGER, 82.5],
	[0, 82.5],
	[1.5, 82.5],
	[1, 0],
	[1, Infinity],
	[1, NaN]
])('rejects unpayable %s at %s', (cents, rate) => {
	expect(() => quoteRubAmount(cents, rate)).toThrow();
});
