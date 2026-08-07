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

export const LEDGER_AMOUNT_SCALE = 100;

export function toLedgerAmountUnits(amount: number): number {
	if (!Number.isFinite(amount)) throw new Error('ledger amount must be finite');
	const units = Math.round(amount * LEDGER_AMOUNT_SCALE);
	if (!Number.isSafeInteger(units)) throw new Error('ledger amount exceeds safe integer range');
	if (amount !== 0 && units === 0) throw new Error('ledger amount is below unit precision');
	return units;
}

export function fromLedgerAmountUnits(units: number): number {
	if (!Number.isSafeInteger(units)) throw new Error('ledger units must be a safe integer');
	return units / LEDGER_AMOUNT_SCALE;
}
