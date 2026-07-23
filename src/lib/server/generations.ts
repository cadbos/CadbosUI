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

export interface CreateGenerationOperationInput {
	sourceUrl: string;
	prompt: string;
	kind: CreditTransaction['kind'];
}

interface GenerationOperationRow {
	id: string;
	user_id: string;
	input_url: string;
	prompt: string;
	kind: CreditTransaction['kind'];
	cost_units: number | null;
	output_url: string | null;
	balance_after_units: number | null;
	status: 'pending' | 'confirmed' | 'completed' | 'failed';
	created_at: number;
	confirmed_at: number | null;
	completed_at: number | null;
	failed_at: number | null;
}

export interface GenerationOperation {
	id: string;
	userId: string;
	sourceUrl: string;
	prompt: string;
	kind: CreditTransaction['kind'];
	cost: number | null;
	outputUrl: string | null;
	balanceAfter: number | null;
	status: GenerationOperationRow['status'];
	createdAt: number;
	confirmedAt: number | null;
	completedAt: number | null;
	failedAt: number | null;
}

export interface CompletedGenerationOperation extends GenerationOperation {
	cost: number;
	outputUrl: string;
	balanceAfter: number;
	status: 'completed';
	confirmedAt: number;
	completedAt: number;
}

function toGenerationOperation(row: GenerationOperationRow): GenerationOperation {
	return {
		id: row.id,
		userId: row.user_id,
		sourceUrl: row.input_url,
		prompt: row.prompt,
		kind: row.kind,
		cost: row.cost_units === null ? null : fromLedgerAmountUnits(row.cost_units),
		outputUrl: row.output_url,
		balanceAfter:
			row.balance_after_units === null ? null : fromLedgerAmountUnits(row.balance_after_units),
		status: row.status,
		createdAt: row.created_at,
		confirmedAt: row.confirmed_at,
		completedAt: row.completed_at,
		failedAt: row.failed_at
	};
}

function toCompletedGenerationOperation(
	row: GenerationOperationRow
): CompletedGenerationOperation | null {
	const operation = toGenerationOperation(row);
	if (
		operation.status !== 'completed' ||
		operation.cost === null ||
		operation.outputUrl === null ||
		operation.balanceAfter === null ||
		operation.confirmedAt === null ||
		operation.completedAt === null
	) {
		return null;
	}
	return operation as CompletedGenerationOperation;
}

async function readGenerationOperationRow(
	db: D1Database,
	userId: string,
	operationId: string
): Promise<GenerationOperationRow | null> {
	return db
		.prepare('SELECT * FROM generation_operations WHERE id = ? AND user_id = ?')
		.bind(operationId, userId)
		.first<GenerationOperationRow>();
}

export async function getGenerationOperation(
	db: D1Database,
	userId: string,
	operationId: string
): Promise<GenerationOperation | null> {
	const row = await readGenerationOperationRow(db, userId, operationId);
	return row ? toGenerationOperation(row) : null;
}

export async function createGenerationOperation(
	db: D1Database,
	userId: string,
	input: CreateGenerationOperationInput
): Promise<string> {
	const operationId = crypto.randomUUID();
	const createdAt = Date.now();
	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			await db
				.prepare(
					'INSERT INTO generation_operations ' +
						'(id, user_id, input_url, prompt, kind, status, created_at) ' +
						"VALUES (?, ?, ?, ?, ?, 'pending', ?)"
				)
				.bind(operationId, userId, input.sourceUrl, input.prompt, input.kind, createdAt)
				.run();
			return operationId;
		} catch (error) {
			const stored = await readGenerationOperationRow(db, userId, operationId).catch(() => null);
			if (stored?.status === 'pending') return operationId;
			if (attempt === 1) throw error;
		}
	}
	throw new Error('generation operation could not be created');
}

export async function failGenerationOperation(
	db: D1Database,
	userId: string,
	operationId: string
): Promise<void> {
	await db
		.prepare(
			"UPDATE generation_operations SET status = 'failed', failed_at = ? " +
				"WHERE id = ? AND user_id = ? AND status = 'pending'"
		)
		.bind(Date.now(), operationId, userId)
		.run();
	const stored = await readGenerationOperationRow(db, userId, operationId);
	if (stored?.status !== 'failed') {
		throw new Error('generation operation could not be marked failed');
	}
}

export async function confirmGenerationOperation(
	db: D1Database,
	userId: string,
	operationId: string,
	result: { outputUrl: string; cost: number }
): Promise<void> {
	if (!Number.isFinite(result.cost) || result.cost < 0) {
		throw new Error('generation cost must be a finite non-negative number');
	}
	const costUnits = toLedgerAmountUnits(result.cost);
	const confirmedAt = Date.now();
	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			await db
				.prepare(
					"UPDATE generation_operations SET status = 'confirmed', cost_units = ?, " +
						'output_url = ?, confirmed_at = ? ' +
						"WHERE id = ? AND user_id = ? AND status = 'pending'"
				)
				.bind(costUnits, result.outputUrl, confirmedAt, operationId, userId)
				.run();
		} catch (error) {
			const stored = await readGenerationOperationRow(db, userId, operationId).catch(() => null);
			if (
				(stored?.status === 'confirmed' || stored?.status === 'completed') &&
				stored.cost_units === costUnits &&
				stored.output_url === result.outputUrl
			) {
				return;
			}
			if (attempt === 1) throw error;
			continue;
		}

		const stored = await readGenerationOperationRow(db, userId, operationId);
		if (
			(stored?.status === 'confirmed' || stored?.status === 'completed') &&
			stored.cost_units === costUnits &&
			stored.output_url === result.outputUrl
		) {
			return;
		}
		throw new Error('generation operation confirmation was not persisted');
	}
}

async function finalizeGenerationOperationOnce(
	db: D1Database,
	row: GenerationOperationRow
): Promise<CompletedGenerationOperation> {
	if (
		row.status !== 'confirmed' ||
		row.cost_units === null ||
		row.output_url === null ||
		row.confirmed_at === null
	) {
		throw new Error('only a confirmed generation operation can be finalized');
	}

	const transactionId = `generation:${row.id}`;
	const completedAt = Date.now();
	const statements: D1PreparedStatement[] = [
		db
			.prepare(
				'INSERT INTO ledger_transactions (id, occurred_at) SELECT ?, ? ' +
					"WHERE EXISTS (SELECT 1 FROM ledger_accounts WHERE user_id = ? AND asset = 'app_credit') " +
					"AND EXISTS (SELECT 1 FROM ledger_accounts WHERE user_id IS NULL AND asset = 'archai_token')"
			)
			.bind(transactionId, row.confirmed_at, row.user_id)
	];

	if (row.cost_units > 0) {
		statements.push(
			db
				.prepare(
					'INSERT INTO ledger_entries (transaction_id, account_id, amount) ' +
						'VALUES (?, (SELECT account.id FROM ledger_accounts account ' +
						'JOIN ledger_account_balances balance ON balance.account_id = account.id ' +
						"WHERE account.user_id = ? AND account.asset = 'app_credit' " +
						'AND balance.balance >= ?), ?)'
				)
				.bind(transactionId, row.user_id, row.cost_units, -row.cost_units),
			db
				.prepare(
					'INSERT INTO ledger_entries (transaction_id, account_id, amount) ' +
						"VALUES (?, (SELECT id FROM ledger_accounts WHERE user_id IS NULL AND asset = 'archai_token'), ?)"
				)
				.bind(transactionId, -row.cost_units)
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
			.bind(row.id, row.user_id, row.prompt, row.kind, transactionId, row.created_at),
		db
			.prepare(
				'INSERT INTO image_generation_details (generation_id, output_url, input_url) ' +
					'VALUES (?, ?, ?)'
			)
			.bind(row.id, row.output_url, row.input_url),
		db
			.prepare(
				"UPDATE generation_operations SET status = 'completed', completed_at = ?, " +
					'balance_after_units = (SELECT balance.balance FROM ledger_accounts account ' +
					'JOIN ledger_account_balances balance ON balance.account_id = account.id ' +
					"WHERE account.user_id = ? AND account.asset = 'app_credit') " +
					"WHERE id = ? AND user_id = ? AND status = 'confirmed'"
			)
			.bind(completedAt, row.user_id, row.id, row.user_id),
		db
			.prepare('SELECT * FROM generation_operations WHERE id = ? AND user_id = ?')
			.bind(row.id, row.user_id)
	);

	const results = await db.batch<GenerationOperationRow>(statements);
	const completed = results.at(-1)?.results[0];
	const operation = completed ? toCompletedGenerationOperation(completed) : null;
	if (!operation) throw new Error('generation operation finalization did not complete');
	return operation;
}

export async function finalizeGenerationOperation(
	db: D1Database,
	userId: string,
	operationId: string
): Promise<CompletedGenerationOperation> {
	for (let attempt = 0; attempt < 2; attempt += 1) {
		const row = await readGenerationOperationRow(db, userId, operationId);
		if (!row) throw new Error('generation operation not found');
		const completed = toCompletedGenerationOperation(row);
		if (completed) return completed;
		if (row.status !== 'confirmed') {
			throw new Error('only a confirmed generation operation can be finalized');
		}

		try {
			return await finalizeGenerationOperationOnce(db, row);
		} catch (error) {
			const stored = await readGenerationOperationRow(db, userId, operationId).catch(() => null);
			const recovered = stored ? toCompletedGenerationOperation(stored) : null;
			if (recovered) return recovered;
			if (attempt === 1 || stored?.status !== 'confirmed') throw error;
		}
	}
	throw new Error('generation operation finalization failed');
}

export async function reconcileGenerationOperations(
	db: D1Database,
	userId: string
): Promise<CompletedGenerationOperation[]> {
	const result = await db
		.prepare(
			"SELECT id FROM generation_operations WHERE user_id = ? AND status = 'confirmed' " +
				'ORDER BY confirmed_at, id'
		)
		.bind(userId)
		.all<{ id: string }>();
	const completed: CompletedGenerationOperation[] = [];
	for (const row of result.results ?? []) {
		completed.push(await finalizeGenerationOperation(db, userId, row.id));
	}
	return completed;
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
		totalDeposit: fromLedgerAmountUnits(row.total_deposit),
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
				'SELECT deposit.user_id, SUM(entry.amount) AS total_deposit, ' +
				'MAX(deposit.paid_at) AS last_deposit_at FROM deposits deposit ' +
				'JOIN ledger_entries entry ON entry.transaction_id = deposit.ledger_transaction_id ' +
				'JOIN ledger_accounts account ON account.id = entry.account_id ' +
				"AND account.asset = 'app_credit' AND account.user_id = deposit.user_id " +
				"WHERE deposit.status = 'paid' GROUP BY deposit.user_id" +
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
