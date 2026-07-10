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

import type { D1Database } from '@cloudflare/workers-types';
import { fromLedgerAmountUnits } from '$lib/server/ledger-units';

export async function getUserIdByPubkey(db: D1Database, pubkey: string): Promise<string | null> {
	const row = await db
		.prepare('SELECT id FROM users WHERE pubkey = ?')
		.bind(pubkey)
		.first<{ id: string }>();
	return row?.id ?? null;
}

export interface CreditAccess {
	balance: number;
	updatedAt: number;
	enabled: boolean;
}

interface CreditRow {
	balance: number;
	updated_at: number;
	enabled: number;
}

function toCreditAccess(row: CreditRow): CreditAccess {
	return {
		balance: fromLedgerAmountUnits(row.balance),
		updatedAt: row.updated_at,
		enabled: row.enabled === 1
	};
}

export async function getCredit(db: D1Database, userId: string): Promise<CreditAccess | null> {
	const row = await db
		.prepare(
			'SELECT balance.balance, balance.updated_at, access.enabled ' +
				'FROM generation_access access ' +
				'JOIN ledger_accounts account ON account.user_id = access.user_id ' +
				"AND account.asset = 'app_credit' " +
				'JOIN ledger_account_balances balance ON balance.account_id = account.id ' +
				'WHERE access.user_id = ?'
		)
		.bind(userId)
		.first<CreditRow>();
	return row ? toCreditAccess(row) : null;
}

export function hasGenerationAccess(credit: CreditAccess | null): credit is CreditAccess {
	return credit?.enabled === true;
}

export function hasSufficientCredit(credit: CreditAccess): boolean {
	return credit.balance > 0;
}

export type GenerationCheck =
	| { allowed: true; balance: number }
	| { allowed: false; reason: 'not_approved' | 'insufficient_credit' };

export async function assertGenerationAllowed(
	db: D1Database,
	userId: string
): Promise<GenerationCheck> {
	const credit = await getCredit(db, userId);
	if (!hasGenerationAccess(credit)) return { allowed: false, reason: 'not_approved' };
	if (!hasSufficientCredit(credit)) return { allowed: false, reason: 'insufficient_credit' };
	return { allowed: true, balance: credit.balance };
}
