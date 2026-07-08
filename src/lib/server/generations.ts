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

// One row per paid render/edit in the generic generations ledger, plus one
// image-specific details row for the resulting image and source image. Both are
// written atomically with the credit deduction.

import type { D1Database } from '@cloudflare/workers-types';
import type { Balance, CreditTransaction } from '$lib/api/contract';

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

interface BalanceRow {
	balance: number;
	updated_at: number;
}

function toBalance(row: BalanceRow): Balance {
	return { balance: row.balance, updatedAt: row.updated_at };
}

export interface RecordGenerationInput {
	url: string;
	sourceUrl: string;
	prompt: string;
	kind: CreditTransaction['kind'];
	amount: number;
}

// Deducts the real cost archAI charged (not a fixed fee) and records the
// resulting image/prompt against it in one D1 batch (a single transaction),
// so a failure between the two can never leave the ledger and the image
// history out of sync. Called exactly once, only after a confirmed
// successful archAI response — the caller must never call this before the
// call, or on failure.
//
// The balance check in the route happens before the (slow) archAI call, not
// atomically with this deduction — two concurrent requests for the same
// account can each pass that check and both land here, taking balance below
// zero. Left unguarded on purpose: the ledger must reflect what archAI
// actually charged, so silently refusing to record a real, already-paid
// deduction here would make the spend history wrong. For a small number of
// manually-approved accounts this is an accepted soft cap, not a hard one.
//
// The insert reads `balance` back from `credits` itself (rather than the
// UPDATE's RETURNING value) because batched statements can't pass results to
// each other — only to the caller, after the whole batch has committed.
export async function recordGeneration(
	db: D1Database,
	userId: string,
	input: RecordGenerationInput
): Promise<Balance> {
	const now = Date.now();
	const generationId = crypto.randomUUID();
	const [updateResult] = await db.batch<BalanceRow>([
		db
			.prepare(
				'UPDATE credits SET balance = balance - ?, updated_at = ? WHERE user_id = ? ' +
					'RETURNING balance, updated_at'
			)
			.bind(input.amount, now, userId),
		db
			.prepare(
				'INSERT INTO generations ' +
					'(id, user_id, prompt, kind, amount, balance_after, created_at) ' +
					'SELECT ?, ?, ?, ?, ?, balance, ? FROM credits WHERE user_id = ?'
			)
			.bind(generationId, userId, input.prompt, input.kind, input.amount, now, userId),
		db
			.prepare(
				'INSERT INTO image_generations_details (id, generation_id, output_url, input_url) ' +
					'SELECT ?, id, ?, ? FROM generations WHERE id = ?'
			)
			.bind(generationId, input.url, input.sourceUrl, generationId)
	]);
	const row = updateResult.results[0];
	if (!row) throw new Error('credit deduction failed: no credit row for user');

	return toBalance(row);
}

export async function getGeneratedImageForUser(
	db: D1Database,
	userId: string,
	id: string
): Promise<GeneratedImage | null> {
	const row = await db
		.prepare(
			'SELECT g.id, g.user_id, d.output_url AS url, g.created_at ' +
				'FROM generations g ' +
				'JOIN image_generations_details d ON d.generation_id = g.id ' +
				'WHERE g.id = ? AND g.user_id = ?'
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
			'DELETE FROM generations WHERE id = ? AND user_id = ? ' +
				'AND EXISTS (SELECT 1 FROM image_generations_details WHERE generation_id = generations.id)'
		)
		.bind(id, userId)
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
			'SELECT g.id, g.user_id, d.output_url AS url, g.created_at ' +
				'FROM generations g ' +
				'JOIN image_generations_details d ON d.generation_id = g.id ' +
				'WHERE g.user_id = ? ORDER BY g.created_at DESC, g.id DESC LIMIT ? OFFSET ?'
		)
		.bind(userId, size + 1, offset)
		.all<GenerationRow>();
	const rows = result.results ?? [];
	return {
		images: rows.slice(0, size).map(toGeneratedImage),
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
		amount: row.amount,
		balanceAfter: row.balance_after,
		kind: row.kind as CreditTransaction['kind'],
		createdAt: row.created_at
	};
}

export async function listCreditHistory(
	db: D1Database,
	userId: string,
	limit = 50
): Promise<CreditTransaction[]> {
	// rowid as a tiebreaker: two deductions within the same millisecond would
	// otherwise sort arbitrarily on created_at alone.
	const { results } = await db
		.prepare(
			'SELECT id, amount, balance_after, kind, created_at FROM generations ' +
				'WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?'
		)
		.bind(userId, limit)
		.all<CreditTransactionRow>();
	return (results ?? []).map(toCreditTransaction);
}
