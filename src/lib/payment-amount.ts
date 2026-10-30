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

const CURRENCY_SYMBOLS: Record<string, string> = { USD: '$', RUB: '₽' };

export function parseAmountMinor(input: string): number | null {
	const value = input.trim().replace(',', '.');
	if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
	const [whole, fraction = ''] = value.split('.');
	const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
	return minor > 0n && minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null;
}

export function formatAmountInput(amountMinor: number): string {
	const whole = Math.trunc(amountMinor / 100);
	const fraction = amountMinor % 100;
	return fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(2, '0')}`;
}

export function formatMinorAmount(amountMinor: number, currency: string): string {
	const digits = String(Math.abs(amountMinor)).padStart(3, '0');
	const whole = digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
	const sign = amountMinor < 0 ? '-' : '';
	return `${CURRENCY_SYMBOLS[currency] ?? currency} ${sign}${whole}.${digits.slice(-2)}`;
}
