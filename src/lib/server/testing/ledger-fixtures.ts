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

import { sql } from 'drizzle-orm';
import type { Database } from '$lib/server/db';

export async function seedCredit(
	db: Database,
	userId: string,
	balance: number,
	enabled: 0 | 1 = 1,
	createdAt = 1
): Promise<void> {
	await db.run(sql`INSERT INTO credits (user_id, enabled) VALUES (${userId}, ${enabled})`);
	if (balance !== 0) {
		await db.run(
			sql`INSERT INTO ledger_entries (user_id, amount, entry_side, reason, created_at)
				VALUES (${userId}, ${Math.round(Math.abs(balance) * 100)}, ${balance > 0 ? 'credit' : 'debit'}, 'opening-balance', ${createdAt})`
		);
	}
}
