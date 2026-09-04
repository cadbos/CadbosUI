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

// One row per paid generation (migrations/0006): the resulting image, the
// source image and prompt it was generated from, and the credit ledger entry
// for that call — all written atomically, so there's no way for the image
// record and the deduction to fall out of sync with each other.

import { sql } from 'drizzle-orm';
import {
	generationKinds,
	type Balance,
	type CreditTransaction,
	type GenerationKind,
	type UserUsageRecord
} from '$lib/api/contract';
import { getOrCreateMedia, mediaUrl } from '$lib/server/media';
import type { Database } from '$lib/server/db';

function isGenerationKind(kind: string): kind is GenerationKind {
	return generationKinds.some((candidate) => candidate === kind);
}

export function generationKindForRow(id: string, kind: string): GenerationKind {
	if (isGenerationKind(kind)) return kind;
	throw new Error(`generation ${id} has invalid kind`);
}

export interface GeneratedImage {
	id: string;
	userId: string;
	mediaId: number;
	filename: string;
	bucketName: string;
	url: string;
	sourceUrl: string;
	kind: GenerationKind;
	createdAt: number;
}

export interface ResourceImage {
	sourceUrl: string;
	createdAt: number;
}

export interface ResourceImagesPage {
	images: ResourceImage[];
	hasMore: boolean;
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
	result_media_id: number;
	result_filename: string;
	result_bucket_name: string;
	result_bucket_url: string;
	source_filename: string;
	source_bucket_url: string;
	kind: string;
	created_at: number;
}

function toGeneratedImage(row: GenerationRow): GeneratedImage {
	return {
		id: row.id,
		userId: row.user_id,
		mediaId: row.result_media_id,
		filename: row.result_filename,
		bucketName: row.result_bucket_name,
		url: mediaUrl(row.result_bucket_url, row.result_filename),
		sourceUrl: mediaUrl(row.source_bucket_url, row.source_filename),
		kind: generationKindForRow(row.id, row.kind),
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
	resultHash: string;
	sourceUrl: string;
	// Ownership must already be verified by the caller (projects.ts'
	// assertSessionOwnedByUser) before this is called — this function trusts it.
	sessionId: string;
	// SHA-256 hex digest of the source image's bytes, or '' when the source is
	// a previous render/edit result rather than a fresh upload (e.g. edit,
	// upscale, or a style-transfer/object-replacement/texture-replacement call
	// whose source mode is 'current-result') — nothing was uploaded in this
	// call to dedup against. See findGenerationSourceByHash.
	sourceHash: string;
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
	db: Database,
	userId: string,
	input: RecordGenerationInput
): Promise<Balance> {
	const now = Date.now();
	const [resultMedia, sourceMedia] = await Promise.all([
		getOrCreateMedia(db, input.url, input.resultHash),
		getOrCreateMedia(db, input.sourceUrl, input.sourceHash)
	]);
	const [updateRows] = await db.batch([
		db.all<BalanceRow>(
			sql`UPDATE credits SET balance = balance - ${input.amount}, updated_at = ${now} WHERE user_id = ${userId}
				RETURNING balance, updated_at`
		),
		db.run(
			sql`INSERT INTO generations
				(id, user_id, result_media_id, source_media_id, prompt, kind, amount, balance_after, created_at, session_id)
				SELECT ${crypto.randomUUID()}, ${userId}, ${resultMedia.id}, ${sourceMedia.id}, ${input.prompt}, ${input.kind}, ${input.amount}, balance, ${now}, ${input.sessionId}
				FROM credits WHERE user_id = ${userId}`
		)
	]);
	const row = updateRows[0];
	if (!row) throw new Error('credit deduction failed: no credit row for user');

	return toBalance(row);
}

export async function getGeneratedImageForUser(
	db: Database,
	userId: string,
	id: string
): Promise<GeneratedImage | null> {
	const row = await db.get<GenerationRow>(
		sql`SELECT g.id, g.user_id, g.result_media_id, result_media.filename AS result_filename,
			result_bucket.name AS result_bucket_name, result_bucket.url AS result_bucket_url,
			source_media.filename AS source_filename, source_bucket.url AS source_bucket_url,
			g.kind, g.created_at FROM generations g
			JOIN media result_media ON result_media.id = g.result_media_id
			JOIN buckets result_bucket ON result_bucket.id = result_media.bucket
			JOIN media source_media ON source_media.id = g.source_media_id
			JOIN buckets source_bucket ON source_bucket.id = source_media.bucket
			WHERE g.id = ${id} AND g.user_id = ${userId}`
	);
	return row ? toGeneratedImage(row) : null;
}

export async function deleteGeneratedImage(
	db: Database,
	userId: string,
	id: string,
	mediaId: number
): Promise<{ generationDeleted: boolean; mediaDeleted: boolean }> {
	const [generationRows, mediaRows] = await db.batch([
		db.all<{ deleted: number }>(
			sql`DELETE FROM generations WHERE id = ${id} AND user_id = ${userId} AND result_media_id = ${mediaId}
				RETURNING 1 AS deleted`
		),
		db.all<{ deleted: number }>(
			sql`DELETE FROM media WHERE id = ${mediaId} AND changes() = 1 AND NOT EXISTS (
				SELECT 1 FROM generations WHERE result_media_id = ${mediaId} OR source_media_id = ${mediaId}
				UNION ALL SELECT 1 FROM object_replacement_jobs WHERE scene_media_id = ${mediaId} OR reference_media_id = ${mediaId} OR output_media_id = ${mediaId}
				UNION ALL SELECT 1 FROM texture_replacement_jobs WHERE scene_media_id = ${mediaId} OR reference_media_id = ${mediaId} OR output_media_id = ${mediaId}
				UNION ALL SELECT 1 FROM light_settings_jobs WHERE scene_media_id = ${mediaId} OR output_media_id = ${mediaId}
			) RETURNING 1 AS deleted`
		)
	]);
	return {
		generationDeleted: generationRows.length === 1,
		mediaDeleted: mediaRows.length === 1
	};
}

export async function listGeneratedImages(
	db: Database,
	userId: string,
	offset: number,
	size: number
): Promise<GeneratedImagesPage> {
	const rows = await db.all<GenerationRow>(
		sql`SELECT g.id, g.user_id, g.result_media_id, result_media.filename AS result_filename,
			result_bucket.name AS result_bucket_name, result_bucket.url AS result_bucket_url,
			source_media.filename AS source_filename, source_bucket.url AS source_bucket_url,
			g.kind, g.created_at FROM generations g
			JOIN media result_media ON result_media.id = g.result_media_id
			JOIN buckets result_bucket ON result_bucket.id = result_media.bucket
			JOIN media source_media ON source_media.id = g.source_media_id
			JOIN buckets source_bucket ON source_bucket.id = source_media.bucket
			WHERE g.user_id = ${userId} ORDER BY g.created_at DESC, g.id DESC LIMIT ${size + 1} OFFSET ${offset}`
	);
	return {
		images: rows.slice(0, size).map(toGeneratedImage),
		hasMore: rows.length > size
	};
}

// Dedup lookup for /api/uploads: reuse an already-stored object when this user
// has uploaded identical bytes before. Empty checksums never match.
export async function findGenerationSourceByHash(
	db: Database,
	userId: string,
	hash: string
): Promise<string | null> {
	if (hash.length === 0) return null;
	const row = await db.get<{ filename: string; bucket_url: string }>(
		sql`SELECT media.filename, buckets.url AS bucket_url FROM generations
			JOIN media ON media.id = generations.source_media_id
			JOIN buckets ON buckets.id = media.bucket
			WHERE generations.user_id = ${userId} AND media.checksum = ${hash} AND buckets.name = 'cadbos-uploads'
			ORDER BY generations.created_at DESC LIMIT 1`
	);
	return row ? mediaUrl(row.bucket_url, row.filename) : null;
}

interface ResourceImageRow {
	filename: string;
	bucket_url: string;
	created_at: number;
}

// Gallery of source photos the user uploaded: non-empty checksums identify
// uploads, while excluding generated outputs removes current-result sources.
export async function listDistinctSourceImages(
	db: Database,
	userId: string,
	offset: number,
	size: number
): Promise<ResourceImagesPage> {
	const rows = await db.all<ResourceImageRow>(
		sql`SELECT source_media.filename, source_bucket.url AS bucket_url,
			MAX(g.created_at) AS created_at FROM generations g
			JOIN media source_media ON source_media.id = g.source_media_id
			JOIN buckets source_bucket ON source_bucket.id = source_media.bucket
			WHERE g.user_id = ${userId} AND source_media.checksum != ''
			AND NOT EXISTS (SELECT 1 FROM generations produced WHERE produced.result_media_id = g.source_media_id)
			GROUP BY g.source_media_id, source_media.filename, source_bucket.url
			ORDER BY created_at DESC, source_media.filename DESC LIMIT ${size + 1} OFFSET ${offset}`
	);
	return {
		images: rows.slice(0, size).map((row) => ({
			sourceUrl: mediaUrl(row.bucket_url, row.filename),
			createdAt: row.created_at
		})),
		hasMore: rows.length > size
	};
}

interface UserUsageRow {
	pubkey: string;
	balance: number;
	generation_count: number;
	total_spend: number;
	latest_spend_at: number | null;
}

function toUserUsageRecord(row: UserUsageRow): UserUsageRecord {
	return {
		pubkey: row.pubkey,
		balance: row.balance,
		totalDeposit: 0,
		lastDepositAt: null,
		generationCount: row.generation_count,
		totalSpend: row.total_spend,
		latestSpendAt: row.latest_spend_at
	};
}

export async function listUserUsage(
	db: Database,
	offset: number,
	size: number
): Promise<UserUsagePage> {
	const rows = await db.all<UserUsageRow>(
		sql`SELECT u.pubkey, COALESCE(c.balance, 0) AS balance,
			COUNT(g.id) AS generation_count, COALESCE(SUM(g.amount), 0) AS total_spend,
			MAX(g.created_at) AS latest_spend_at FROM users u
			LEFT JOIN credits c ON c.user_id = u.id
			LEFT JOIN generations g ON g.user_id = u.id
			GROUP BY u.id, u.pubkey, u.created_at, c.balance
			ORDER BY u.created_at DESC, u.id DESC LIMIT ${size + 1} OFFSET ${offset}`
	);
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
	session_id: string | null;
	project_id: string | null;
}

function toCreditTransaction(row: CreditTransactionRow): CreditTransaction {
	return {
		id: row.id,
		amount: row.amount,
		balanceAfter: row.balance_after,
		kind: generationKindForRow(row.id, row.kind),
		createdAt: row.created_at,
		sessionId: row.session_id,
		projectId: row.project_id
	};
}

export async function listCreditHistory(
	db: Database,
	userId: string,
	limit = 50
): Promise<CreditTransaction[]> {
	// rowid as a tiebreaker: two deductions within the same millisecond would
	// otherwise sort arbitrarily on created_at alone. LEFT JOIN (not INNER):
	// generations.session_id is nullable at the DB level (migrations/0011), so
	// a row without one must still appear in the history, just without a
	// session/project to link it to.
	const rows = await db.all<CreditTransactionRow>(
		sql`SELECT g.id, g.amount, g.balance_after, g.kind, g.created_at,
			g.session_id, ps.project_id FROM generations g
			LEFT JOIN project_sessions ps ON ps.id = g.session_id
			WHERE g.user_id = ${userId} ORDER BY g.created_at DESC, g.rowid DESC LIMIT ${limit}`
	);
	return rows.map(toCreditTransaction);
}
