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
import { formatAmountInput, formatMinorAmount, parseAmountMinor } from './payment-amount';

describe('parseAmountMinor', () => {
	it.each([
		['10', 1000],
		['10.5', 1050],
		['10,05', 1005],
		[' 0.01 ', 1],
		['1234.56', 123456]
	])('parses %j as %i minor units', (input, expected) => {
		expect(parseAmountMinor(input)).toBe(expected);
	});

	it.each(['', '0', '0.00', '-5', '1.234', '1e3', '12a', '.5', '5.', '1 000', '90071992547409.92'])(
		'rejects %j',
		(input) => {
			expect(parseAmountMinor(input)).toBeNull();
		}
	);
});

describe('formatAmountInput', () => {
	it.each([
		[1000, '10'],
		[1050, '10.50'],
		[1005, '10.05'],
		[1, '0.01']
	])('formats %i as %j', (amountMinor, expected) => {
		expect(formatAmountInput(amountMinor)).toBe(expected);
	});
});

describe('formatMinorAmount', () => {
	it.each([
		[1000, 'USD', '$ 10.00'],
		[5, 'USD', '$ 0.05'],
		[123456789, 'RUB', '₽ 1,234,567.89'],
		[82500, 'RUB', '₽ 825.00'],
		[-250, 'USD', '$ -2.50'],
		[0, 'USD', '$ 0.00'],
		[1500, 'BTC', 'BTC 15.00']
	])('formats %i %s as %j', (amountMinor, currency, expected) => {
		expect(formatMinorAmount(amountMinor, currency)).toBe(expected);
	});
});
