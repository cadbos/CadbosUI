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

import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import type { CreditTransaction, UserUsageRecord } from '$lib/api/contract';
import { fromLedgerAmountUnits, toLedgerAmountUnits } from '$lib/server/ledger-units';

export interface GeneratedImage {
	id: string;
	userId: string;
	url: string;
	createdAt: number;
}

export interface GeneratedImagesPage {
	images: GeneratedImage[];
	hasMore: boolean;
}

export interface UserUsagePage {
	users: UserUsageRecord[];
	hasMore: boolean;
}

interface GenerationRow {
	id: string;
	user_id: string;
	url: string;
	created_at: number;
}

function toGeneratedImage(row: GenerationRow): GeneratedImage {
	return {
		id: row.id,
		userId: row.user_id,
		url: row.url,
		createdAt: row.created_at
	};
}

interface AccountBalanceRow {
	balance: number;
	updated_at: number;
}

export interface AccountBalance {
	balance: number;
	updatedAt: number;
}

function toAccountBalance(row: AccountBalanceRow): AccountBalance {
	return { balance: fromLedgerAmountUnits(row.balance), updatedAt: row.updated_at };
}

export interface RecordGenerationInput {
	url: string;
	sourceUrl: string;
	prompt: string;
	kind: CreditTransaction['kind'];
	amount: number;
}

export async function recordGeneration(
	db: D1Database,
	userId: string,
	input: RecordGenerationInput
): Promise<AccountBalance> {
	if (!Number.isFinite(input.amount) || input.amount < 0) {
		throw new Error('generation cost must be a finite non-negative number');
	}
	const amountUnits = toLedgerAmountUnits(input.amount);

	const generationId = crypto.randomUUID();
	const transactionId = `generation:${generationId}`;
	const now = Date.now();
	const statements: D1PreparedStatement[] = [
		db
			.prepare(
				'INSERT INTO ledger_transactions (id, occurred_at) SELECT ?, ? ' +
					"WHERE EXISTS (SELECT 1 FROM ledger_accounts WHERE user_id = ? AND asset = 'app_credit') " +
					"AND EXISTS (SELECT 1 FROM ledger_accounts WHERE user_id IS NULL AND asset = 'archai_token')"
			)
			.bind(transactionId, now, userId)
	];

	if (amountUnits > 0) {
		statements.push(
			db
				.prepare(
					'INSERT INTO ledger_entries (transaction_id, account_id, amount) ' +
						'VALUES (?, (SELECT account.id FROM ledger_accounts account ' +
						'JOIN ledger_account_balances balance ON balance.account_id = account.id ' +
						"WHERE account.user_id = ? AND account.asset = 'app_credit' " +
						'AND balance.balance >= ?), ?)'
				)
				.bind(transactionId, userId, amountUnits, -amountUnits),
			db
				.prepare(
					'INSERT INTO ledger_entries (transaction_id, account_id, amount) ' +
						"VALUES (?, (SELECT id FROM ledger_accounts WHERE user_id IS NULL AND asset = 'archai_token'), ?)"
				)
				.bind(transactionId, -amountUnits)
		);
	}

	statements.push(
		db.prepare('UPDATE ledger_transactions SET finalized = 1 WHERE id = ?').bind(transactionId),
		db
			.prepare(
				'INSERT INTO generations ' +
					'(id, user_id, prompt, kind, ledger_transaction_id, created_at) ' +
					'VALUES (?, ?, ?, ?, ?, ?)'
			)
			.bind(generationId, userId, input.prompt, input.kind, transactionId, now),
		db
			.prepare(
				'INSERT INTO image_generation_details (generation_id, output_url, input_url) ' +
					'VALUES (?, ?, ?)'
			)
			.bind(generationId, input.url, input.sourceUrl),
		db
			.prepare(
				'SELECT balance.balance, balance.updated_at FROM ledger_accounts account ' +
					'JOIN ledger_account_balances balance ON balance.account_id = account.id ' +
					"WHERE account.user_id = ? AND account.asset = 'app_credit'"
			)
			.bind(userId)
	);

	const results = await db.batch<AccountBalanceRow>(statements);
	const row = results.at(-1)?.results[0];
	if (!row) throw new Error('credit deduction failed: no app credit ledger account for user');
	return toAccountBalance(row);
}

export async function getGeneratedImageForUser(
	db: D1Database,
	userId: string,
	id: string
): Promise<GeneratedImage | null> {
	const row = await db
		.prepare(
			'SELECT generation.id, generation.user_id, detail.output_url AS url, generation.created_at ' +
				'FROM generations generation ' +
				'JOIN image_generation_details detail ON detail.generation_id = generation.id ' +
				'WHERE generation.id = ? AND generation.user_id = ?'
		)
		.bind(id, userId)
		.first<GenerationRow>();
	return row ? toGeneratedImage(row) : null;
}

export async function deleteGeneratedImage(
	db: D1Database,
	userId: string,
	id: string
): Promise<boolean> {
	const result = await db
		.prepare(
			'DELETE FROM image_generation_details WHERE generation_id = ? ' +
				'AND EXISTS (SELECT 1 FROM generations WHERE id = ? AND user_id = ?)'
		)
		.bind(id, id, userId)
		.run();
	return result.meta.changes === 1;
}

export async function listGeneratedImages(
	db: D1Database,
	userId: string,
	offset: number,
	size: number
): Promise<GeneratedImagesPage> {
	const result = await db
		.prepare(
			'SELECT generation.id, generation.user_id, detail.output_url AS url, generation.created_at ' +
				'FROM generations generation ' +
				'JOIN image_generation_details detail ON detail.generation_id = generation.id ' +
				'WHERE generation.user_id = ? ' +
				'ORDER BY generation.created_at DESC, generation.id DESC LIMIT ? OFFSET ?'
		)
		.bind(userId, size + 1, offset)
		.all<GenerationRow>();
	const rows = result.results ?? [];
	return {
		images: rows.slice(0, size).map(toGeneratedImage),
		hasMore: rows.length > size
	};
}

interface UserUsageRow {
	pubkey: string;
	balance: number;
	total_deposit: number;
	last_deposit_at: number | null;
	generation_count: number;
	total_spend: number;
	latest_spend_at: number | null;
}

function toUserUsageRecord(row: UserUsageRow): UserUsageRecord {
	return {
		pubkey: row.pubkey,
		balance: fromLedgerAmountUnits(row.balance),
		totalDeposit: row.total_deposit,
		lastDepositAt: row.last_deposit_at,
		generationCount: row.generation_count,
		totalSpend: fromLedgerAmountUnits(row.total_spend),
		latestSpendAt: row.latest_spend_at
	};
}

export async function listUserUsage(
	db: D1Database,
	offset: number,
	size: number
): Promise<UserUsagePage> {
	const result = await db
		.prepare(
			'WITH credit_accounts AS (' +
				'SELECT account.user_id, account.id AS account_id, balance.balance ' +
				'FROM ledger_accounts account ' +
				'JOIN ledger_account_balances balance ON balance.account_id = account.id ' +
				"WHERE account.asset = 'app_credit'" +
				'), generation_usage AS (' +
				'SELECT generation.user_id, COUNT(generation.id) AS generation_count, ' +
				'COALESCE(SUM(CASE WHEN entry.amount < 0 THEN -entry.amount ELSE 0 END), 0) AS total_spend, ' +
				'MAX(CASE WHEN entry.amount < 0 THEN generation.created_at END) AS latest_spend_at ' +
				'FROM generations generation ' +
				'LEFT JOIN ledger_entries entry ON entry.transaction_id = generation.ledger_transaction_id ' +
				"AND entry.account_id = (SELECT id FROM ledger_accounts WHERE asset = 'archai_token' AND user_id IS NULL) " +
				'GROUP BY generation.user_id' +
				'), deposit_usage AS (' +
				'SELECT user_id, SUM(credits_awarded) AS total_deposit, MAX(paid_at) AS last_deposit_at ' +
				"FROM deposits WHERE status = 'paid' GROUP BY user_id" +
				') SELECT user.pubkey, COALESCE(account.balance, 0) AS balance, ' +
				'COALESCE(deposit.total_deposit, 0) AS total_deposit, deposit.last_deposit_at, ' +
				'COALESCE(generation.generation_count, 0) AS generation_count, ' +
				'COALESCE(generation.total_spend, 0) AS total_spend, generation.latest_spend_at ' +
				'FROM users user LEFT JOIN credit_accounts account ON account.user_id = user.id ' +
				'LEFT JOIN generation_usage generation ON generation.user_id = user.id ' +
				'LEFT JOIN deposit_usage deposit ON deposit.user_id = user.id ' +
				'ORDER BY user.created_at DESC, user.id DESC LIMIT ? OFFSET ?'
		)
		.bind(size + 1, offset)
		.all<UserUsageRow>();
	const rows = result.results ?? [];
	return {
		users: rows.slice(0, size).map(toUserUsageRecord),
		hasMore: rows.length > size
	};
}

interface CreditTransactionRow {
	id: string;
	amount: number;
	balance_after: number;
	kind: string;
	created_at: number;
}

function toCreditTransaction(row: CreditTransactionRow): CreditTransaction {
	return {
		id: row.id,
		amount: fromLedgerAmountUnits(row.amount),
		balanceAfter: fromLedgerAmountUnits(row.balance_after),
		kind: row.kind as CreditTransaction['kind'],
		createdAt: row.created_at
	};
}

export async function listCreditHistory(
	db: D1Database,
	userId: string,
	limit = 50
): Promise<CreditTransaction[]> {
	const { results } = await db
		.prepare(
			'WITH account_history AS (' +
				'SELECT ledger_transaction.id AS transaction_id, ledger_transaction.occurred_at, ' +
				'ledger_transaction.rowid AS transaction_order, entry.amount, ' +
				'SUM(entry.amount) OVER (ORDER BY ledger_transaction.occurred_at, ledger_transaction.rowid ' +
				'ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS balance_after ' +
				'FROM ledger_entries entry ' +
				'JOIN ledger_transactions ledger_transaction ON ledger_transaction.id = entry.transaction_id ' +
				'JOIN ledger_accounts account ON account.id = entry.account_id ' +
				"WHERE account.user_id = ? AND account.asset = 'app_credit'" +
				') SELECT generation.id, -history.amount AS amount, history.balance_after, ' +
				'generation.kind, history.occurred_at AS created_at FROM account_history history ' +
				'JOIN generations generation ON generation.ledger_transaction_id = history.transaction_id ' +
				'WHERE history.amount < 0 ORDER BY history.occurred_at DESC, history.transaction_order DESC ' +
				'LIMIT ?'
		)
		.bind(userId, limit)
		.all<CreditTransactionRow>();
	return (results ?? []).map(toCreditTransaction);
}
