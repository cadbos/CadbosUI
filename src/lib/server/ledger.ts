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

// The one-per-account credit an operator appends after a welcome-bonus request;
// migrations/0027 makes a second entry for the same user impossible.
export const WELCOME_BONUS_REASON = 'welcome-bonus';

export function ledgerAmountSql(amount: number | SQL): SQL {
	return sql`CASE WHEN ${amount} = 0 THEN 0 WHEN ${amount} > 0 AND ${amount} * 100 <= 9007199254740991
		THEN CAST(MAX(1, ROUND(ROUND(${amount} * 100, 8))) AS INTEGER) ELSE NULL END`;
}

export function ledgerBalanceSql(userId: string | SQL, throughId?: SQL): SQL {
	return sql`(SELECT COALESCE(SUM(CASE WHEN entry_side = 'credit' THEN amount ELSE -amount END), 0) / 100.0
		FROM ledger_entries WHERE user_id = ${userId}${throughId ? sql` AND id <= ${throughId}` : sql``})`;
}
