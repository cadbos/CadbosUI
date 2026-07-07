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
import { formatCredit } from './utils';

it('rounds binary floating-point noise to two decimals', () => {
	expect(formatCredit(4.9399999999999995)).toBe('4.94');
});

it('pads whole numbers to two decimals', () => {
	expect(formatCredit(48)).toBe('48.00');
});

it('keeps exact two-decimal values unchanged', () => {
	expect(formatCredit(2.5)).toBe('2.50');
});
