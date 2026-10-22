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

export function quoteRubAmount(
	usdCents: number,
	rate: number
): { amountMinor: number; rubPerUsd: string } {
	if (!Number.isSafeInteger(usdCents) || usdCents <= 0) throw new Error('Invalid USD cents');
	if (!Number.isFinite(rate) || rate <= 0) throw new Error('Invalid USD/RUB rate');
	const [mantissa, exponent = '0'] = String(rate).split('e');
	const [whole, fraction = ''] = mantissa.split('.');
	const scale = fraction.length - Number(exponent);
	const digits = whole + fraction;
	const numerator = BigInt(digits) * (scale < 0 ? 10n ** BigInt(-scale) : 1n);
	const denominator = scale > 0 ? 10n ** BigInt(scale) : 1n;
	const product = BigInt(usdCents) * numerator;
	const rounded = (product * 2n + denominator) / (2n * denominator);
	if (rounded <= 0n || rounded > BigInt(Number.MAX_SAFE_INTEGER))
		throw new RangeError('RUB quote is outside payable limits');
	const expanded = scale <= 0 ? numerator.toString() : digits.padStart(scale + 1, '0');
	const decimal = scale <= 0 ? expanded : `${expanded.slice(0, -scale)}.${expanded.slice(-scale)}`;
	const rubPerUsd = decimal.includes('.') ? decimal.replace(/0+$/, '').replace(/\.$/, '') : decimal;
	return { amountMinor: Number(rounded), rubPerUsd };
}
