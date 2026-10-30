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

import { sql, type SQL } from 'drizzle-orm';
import type { Database } from '$lib/server/db';

export class TestDepositLimitError extends Error {
	constructor() {
		super('Test deposit limit exceeded');
		this.name = 'TestDepositLimitError';
	}
}

export function getTestDepositLimit(platform: App.Platform | undefined): number | null {
	const value = platform?.env.ROBOKASSA_TEST_DEPOSIT_LIMIT_CENTS;
	if (value === undefined) return null;
	if (!/^\d+$/.test(value) || value.trim() !== value || !Number.isSafeInteger(Number(value))) {
		throw new Error('ROBOKASSA_TEST_DEPOSIT_LIMIT_CENTS must be a nonnegative safe integer');
	}
	return Number(value);
}

export function testDepositAllowed(userId: string, amountMinor: number, limit: number): SQL {
	return sql`(SELECT COALESCE(SUM(l.amount), 0) FROM ledger_entries l
		JOIN invoices funded ON funded.ledger_entry_id = l.id
		WHERE l.user_id = ${userId} AND l.entry_side = 'credit'
		AND funded.payment_processor = 'robokassa') <= ${limit - amountMinor}`;
}

export async function requireTestDepositAllowed(
	db: Database,
	userId: string,
	amountMinor: number,
	limit: number | null
): Promise<void> {
	if (limit === null) return;
	const result = await db.get<{ allowed: number }>(
		sql`SELECT ${testDepositAllowed(userId, amountMinor, limit)} AS allowed`
	);
	if (!result) throw new Error('Robokassa test deposit allowance could not be read');
	if (result.allowed !== 1) throw new TestDepositLimitError();
}
