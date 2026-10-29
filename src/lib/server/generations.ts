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

import { sql, type SQL } from 'drizzle-orm';
import {
	generationKinds,
	resourceRoles,
	type Balance,
	type CreditTransaction,
	type GenerationKind,
	type GenerationKindCount,
	type GenerationSessionRef,
	type RequestFormSnapshot,
	type ResourceFilter,
	type ResourceRole,
	type SceneFilterProject,
	type SceneView,
	type UsageGenerationRecord,
	type UsageTotals,
	type UserUsageRecord
} from '$lib/api/contract';
import { formSnapshotSchema } from '$lib/server/api';
import type { Database } from '$lib/server/db';
import { mediaLink } from '$lib/server/media-access';
import { ledgerAmountSql, ledgerBalanceSql } from '$lib/server/ledger';

function isGenerationKind(kind: string): kind is GenerationKind {
	return generationKinds.some((candidate) => candidate === kind);
}

export function generationKindForRow(id: string, kind: string): GenerationKind | null {
	if (isGenerationKind(kind)) return kind;
	console.warn(
		JSON.stringify({
			level: 'warn',
			area: 'generations',
			event: 'unknown_generation_kind',
			id,
			kind
		})
	);
	return null;
}

export interface GeneratedImage {
	id: string;
	userId: string;
	mediaId: number;
	sourceMediaId: number;
	filename: string;
	bucketName: string;
	kind: GenerationKind;
	createdAt: number;
}

export interface ResourceImage {
	mediaId: number;
	createdAt: number;
	roles: ResourceRole[];
}

export interface ResourceImagesPage {
	images: ResourceImage[];
	hasMore: boolean;
}

export interface Scene extends GeneratedImage {
	session: GenerationSessionRef | null;
	iteration: number | null;
	number: number;
	sourceGeneration: { id: string; kind: GenerationKind } | null;
}

export interface GeneratedImagesPage {
	images: Scene[];
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
	source_media_id: number;
	result_filename: string;
	result_bucket_name: string;
	kind: string;
	created_at: number;
}

function toGeneratedImage(row: GenerationRow): GeneratedImage | null {
	const kind = generationKindForRow(row.id, row.kind);
	if (kind === null) return null;
	return {
		id: row.id,
		userId: row.user_id,
		mediaId: row.result_media_id,
		sourceMediaId: row.source_media_id,
		filename: row.result_filename,
		bucketName: row.result_bucket_name,
		kind,
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
	resultMediaId: number;
	sourceMediaId: number;
	// Ownership must already be verified by the caller (projects.ts'
	// assertSessionOwnedByUser) before this is called — this function trusts it.
	sessionId: string;
	prompt: string;
	kind: GenerationKind;
	amount: number;
	archaiRenderSec: number;
	archaiDownloadSec: number;
	archaiReuploadSec: number;
	// The full form settings this call was submitted with (migrations/0018),
	// so the generation can later be reopened with them restored — undefined
	// for kinds with nothing to restore (e.g. upscale).
	formSnapshot?: RequestFormSnapshot;
	// The uploaded reference image the call used (migrations/0019) — a custom
	// style reference; undefined for a built-in preset and for kinds that
	// take no reference.
	referenceMediaId?: number;
	// The English translation a Create render sent archAI in place of
	// `prompt` (migrations/0026) — null when it sent `prompt` as written;
	// undefined for every other kind.
	translatedPrompt?: string | null;
}

// The stored generation's id alongside the caller's resulting balance — the
// id is what the client must use for this result, so anything that later
// refers back to it (a session fork point, a restore) finds the real row.
export interface RecordedGeneration extends Balance {
	id: string;
}

export async function recordGeneration(
	db: Database,
	userId: string,
	input: RecordGenerationInput
): Promise<RecordedGeneration> {
	const now = Date.now();
	const id = crypto.randomUUID();
	const [, , balanceRows] = await db.batch([
		db.run(
			sql`INSERT INTO ledger_entries (user_id, amount, entry_side, reason, created_at)
				SELECT user_id, ${ledgerAmountSql(input.amount)}, 'debit', 'generation-charge', ${now}
				FROM credits WHERE user_id = ${userId}`
		),
		db.run(
			sql`INSERT INTO generations
				(id, user_id, result_media_id, source_media_id, prompt, kind, ledger_entry_id, created_at, session_id,
				archai_render_sec, archai_download_sec, archai_reupload_sec, form_snapshot, reference_media_id, translated_prompt)
				SELECT ${id}, ${userId}, ${input.resultMediaId}, ${input.sourceMediaId}, ${input.prompt}, ${input.kind}, l.id, ${now}, ${input.sessionId},
				${input.archaiRenderSec}, ${input.archaiDownloadSec}, ${input.archaiReuploadSec}, ${input.formSnapshot ? JSON.stringify(input.formSnapshot) : null}, ${input.referenceMediaId ?? null}, ${input.translatedPrompt ?? null}
				FROM ledger_entries l WHERE l.id = last_insert_rowid() AND changes() = 1 AND l.user_id = ${userId} AND l.entry_side = 'debit'`
		),
		db.all<BalanceRow>(
			sql`SELECT ${ledgerBalanceSql(userId, sql`l.id`)} AS balance, l.created_at AS updated_at
				FROM generations g JOIN ledger_entries l ON l.id = g.ledger_entry_id WHERE g.id = ${id} AND g.user_id = ${userId}`
		)
	]);
	const row = balanceRows[0];
	if (!row) throw new Error('credit deduction failed: no credit row for user');

	return { id, ...toBalance(row) };
}

export async function recordPhotoProcessing(
	db: Database,
	userId: string,
	input: {
		resultMediaId: number;
		sourceMediaId: number;
		sessionId: string;
		formSnapshot: RequestFormSnapshot;
	}
): Promise<RecordedGeneration> {
	const id = crypto.randomUUID();
	const now = Date.now();
	const [, , rows] = await db.batch([
		db.run(
			sql`INSERT INTO ledger_entries (user_id, amount, entry_side, reason, created_at)
				VALUES (${userId}, 0, 'debit', 'generation-charge', ${now})`
		),
		db.run(
			sql`INSERT INTO generations
				(id, user_id, result_media_id, source_media_id, prompt, kind, ledger_entry_id, created_at, session_id,
				archai_render_sec, archai_download_sec, archai_reupload_sec, form_snapshot)
				SELECT ${id}, ${userId}, ${input.resultMediaId}, ${input.sourceMediaId}, 'photo processing', 'photo-processing', l.id,
				${now}, ${input.sessionId}, 0, 0, 0, ${JSON.stringify(input.formSnapshot)}
				FROM ledger_entries l WHERE l.id = last_insert_rowid() AND changes() = 1 AND l.user_id = ${userId} AND l.entry_side = 'debit'`
		),
		db.all<BalanceRow>(
			sql`SELECT ${ledgerBalanceSql(userId, sql`l.id`)} AS balance, l.created_at AS updated_at
				FROM generations g JOIN ledger_entries l ON l.id = g.ledger_entry_id WHERE g.id = ${id} AND g.user_id = ${userId}`
		)
	]);
	const row = rows[0];
	if (!row) throw new Error('Photo processing history insert returned no row');
	return { id, ...toBalance(row) };
}

export async function getGenerationFeedbackForUser(
	db: Database,
	userId: string,
	generationId: string
): Promise<{ rating: 'like' | 'dislike' | null; comment: string | null } | null> {
	const row = await db.get<{
		rating: 'like' | 'dislike' | null;
		comment: string | null;
	}>(sql`SELECT f.rating, f.comment
		FROM generations g LEFT JOIN generations_feedback f ON f.generation_id = g.id
		WHERE g.id = ${generationId} AND g.user_id = ${userId}`);
	return row ?? null;
}

export async function storeGenerationFeedback(
	db: Database,
	userId: string,
	generationId: string,
	rating: 'like' | 'dislike',
	comment: string | null
): Promise<'saved' | 'not_found' | 'conflict'> {
	const [, rows] = await db.batch([
		db.run(sql`INSERT INTO generations_feedback (generation_id, rating, comment)
			SELECT id, ${rating}, ${comment} FROM generations WHERE id = ${generationId} AND user_id = ${userId}
			ON CONFLICT(generation_id) DO NOTHING`),
		db.all<{
			rating: 'like' | 'dislike';
			comment: string | null;
		}>(sql`SELECT f.rating, f.comment FROM generations_feedback f
			JOIN generations g ON g.id = f.generation_id
			WHERE g.id = ${generationId} AND g.user_id = ${userId}`)
	]);
	const feedback = rows[0];
	if (!feedback) return 'not_found';
	return feedback.rating === rating && feedback.comment === comment ? 'saved' : 'conflict';
}

export async function getGeneratedImageForUser(
	db: Database,
	userId: string,
	id: string
): Promise<GeneratedImage | null> {
	const row = await db.get<GenerationRow>(
		sql`SELECT g.id, g.user_id, g.result_media_id, g.source_media_id, result_media.filename AS result_filename,
			result_bucket.name AS result_bucket_name,
			g.kind, g.created_at FROM generations g
			JOIN media result_media ON result_media.id = g.result_media_id
			JOIN buckets result_bucket ON result_bucket.id = result_media.bucket
			JOIN media source_media ON source_media.id = g.source_media_id
			JOIN buckets source_bucket ON source_bucket.id = source_media.bucket
			WHERE g.id = ${id} AND g.user_id = ${userId}`
	);
	return row ? toGeneratedImage(row) : null;
}

export interface GenerationDetail {
	id: string;
	sourceMediaId: number;
	resultMediaId: number;
	prompt: string;
	kind: GenerationKind;
	createdAt: number;
	amount: number;
	balanceAfter: number;
	formSnapshot: RequestFormSnapshot | null;
	session: GenerationSessionRef | null;
}

interface SessionRefColumns {
	session_id: string | null;
	session_title: string | null;
	project_id: string | null;
	project_title: string | null;
}

// A generation whose session or project has since been archived (or one
// recorded before sessions existed) has no session left to continue.
function sessionRefForRow(row: SessionRefColumns): GenerationSessionRef | null {
	return row.session_id !== null &&
		row.session_title !== null &&
		row.project_id !== null &&
		row.project_title !== null
		? {
				projectId: row.project_id,
				projectTitle: row.project_title,
				sessionId: row.session_id,
				sessionTitle: row.session_title
			}
		: null;
}

interface GenerationDetailRow extends SessionRefColumns {
	id: string;
	source_media_id: number;
	result_media_id: number;
	prompt: string;
	kind: string;
	created_at: number;
	amount: number;
	balance_after: number;
	form_snapshot: string | null;
}

// Re-validates the stored JSON against the same shape schema the write path
// enforces (formSnapshotSchema, $lib/server/api) rather than trusting it
// blindly — a row could in principle predate a later, stricter version of
// that shape. A row that fails degrades to `formSnapshot: null` (prompt-only
// restore) instead of failing the whole read.
export function parseStoredFormSnapshot(
	id: string,
	raw: string | null
): RequestFormSnapshot | null {
	if (!raw) return null;
	let parsedJson: unknown;
	try {
		parsedJson = JSON.parse(raw);
	} catch (error) {
		console.error(
			JSON.stringify({
				level: 'error',
				area: 'generations',
				event: 'form_snapshot_json_invalid',
				id,
				errorType: error instanceof Error ? error.name : 'unknown'
			})
		);
		return null;
	}
	const result = formSnapshotSchema.safeParse(parsedJson);
	if (!result.success) {
		console.error(
			JSON.stringify({
				level: 'error',
				area: 'generations',
				event: 'form_snapshot_shape_invalid',
				id
			})
		);
		return null;
	}
	return result.data;
}

// For the "restore this generation's settings" feature (migrations/0018) —
// unlike getGeneratedImageForUser (used for the history gallery/delete), this
// carries the full form snapshot, so it's only queried when a specific
// generation is opened, not for every row in a list.
export async function getGenerationDetailForUser(
	db: Database,
	userId: string,
	id: string
): Promise<GenerationDetail | null> {
	const row = await db.get<GenerationDetailRow>(
		sql`SELECT g.id, g.source_media_id, g.result_media_id, g.prompt, g.kind, g.created_at,
			${ledgerBalanceSql(sql`g.user_id`, sql`l.id`)} AS balance_after, l.amount / 100.0 AS amount, g.form_snapshot, ps.id AS session_id, ps.title AS session_title,
			p.id AS project_id, p.title AS project_title
			FROM generations g
			JOIN ledger_entries l ON l.id = g.ledger_entry_id AND l.user_id = g.user_id
			LEFT JOIN project_sessions ps ON ps.id = g.session_id AND ps.archived_at IS NULL
			LEFT JOIN projects p ON p.id = ps.project_id AND p.user_id = g.user_id
			AND p.archived_at IS NULL
			WHERE g.id = ${id} AND g.user_id = ${userId}`
	);
	if (!row) return null;
	const kind = generationKindForRow(row.id, row.kind);
	if (kind === null) return null;
	return {
		id: row.id,
		sourceMediaId: row.source_media_id,
		resultMediaId: row.result_media_id,
		prompt: row.prompt,
		kind,
		createdAt: row.created_at,
		amount: row.amount,
		balanceAfter: row.balance_after,
		formSnapshot: parseStoredFormSnapshot(row.id, row.form_snapshot),
		session: sessionRefForRow(row)
	};
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
				SELECT 1 FROM generations WHERE result_media_id = ${mediaId} OR source_media_id = ${mediaId} OR reference_media_id = ${mediaId}
				UNION ALL SELECT 1 FROM object_replacement_jobs WHERE scene_media_id = ${mediaId} OR reference_media_id = ${mediaId} OR output_media_id = ${mediaId}
				UNION ALL SELECT 1 FROM texture_replacement_jobs WHERE scene_media_id = ${mediaId} OR reference_media_id = ${mediaId} OR output_media_id = ${mediaId}
				UNION ALL SELECT 1 FROM light_settings_jobs WHERE scene_media_id = ${mediaId} OR output_media_id = ${mediaId}
				UNION ALL SELECT 1 FROM repaint_jobs WHERE scene_media_id = ${mediaId} OR output_media_id = ${mediaId}
			) RETURNING 1 AS deleted`
		)
	]);
	return {
		generationDeleted: generationRows.length === 1,
		mediaDeleted: mediaRows.length === 1
	};
}

// Rows with an unrecognized `kind` (generationKindForRow) are dropped after
// the fact, so a plain LIMIT/OFFSET window can come back short even though
// valid rows exist further out. This scans forward — growing the window each
// round trip — until enough valid rows are collected or the table runs out,
// so pagination is expressed in terms of valid rows, not raw ones.
async function collectValidRows<Row, T>(
	fetchRows: (limit: number, offset: number) => Promise<Row[]>,
	toDomain: (row: Row) => T | null,
	minValidCount: number
): Promise<{ items: T[]; exhausted: boolean }> {
	if (minValidCount <= 0) return { items: [], exhausted: true };
	const items: T[] = [];
	let rawOffset = 0;
	let chunkSize = minValidCount;
	for (;;) {
		const rows = await fetchRows(chunkSize, rawOffset);
		for (const row of rows) {
			const item = toDomain(row);
			if (item) items.push(item);
		}
		rawOffset += rows.length;
		if (items.length >= minValidCount || rows.length < chunkSize) {
			return { items, exhausted: rows.length < chunkSize };
		}
		chunkSize *= 2;
	}
}

export interface SceneFilter {
	view: SceneView;
	projectId: string | null;
	sessionId: string | null;
}

interface SceneRow extends GenerationRow, SessionRefColumns {
	iteration: number | null;
	number: number;
	source_generation_id: string | null;
	source_generation_kind: string | null;
}

function sourceGenerationForRow(row: SceneRow): Scene['sourceGeneration'] {
	if (!row.source_generation_id || !row.source_generation_kind) return null;
	const kind = generationKindForRow(row.source_generation_id, row.source_generation_kind);
	return kind ? { id: row.source_generation_id, kind } : null;
}

function toScene(row: SceneRow): Scene | null {
	const image = toGeneratedImage(row);
	return image
		? {
				...image,
				session: sessionRefForRow(row),
				iteration: row.iteration,
				number: row.number,
				sourceGeneration: sourceGenerationForRow(row)
			}
		: null;
}

// The live session/project a generation belongs to — the same archived-out
// joins getGenerationDetailForUser uses, so filtering by project or session
// only ever matches live ones.
const LIVE_SESSION_JOINS = sql`LEFT JOIN project_sessions ps ON ps.id = g.session_id AND ps.archived_at IS NULL
	LEFT JOIN projects p ON p.id = ps.project_id AND p.user_id = g.user_id AND p.archived_at IS NULL`;

// `milestones` ranks each live session's generations to pick its latest one
// (the milestone) and pairs it with the source of its earliest one. Only
// recognized kinds take part, so one unreadable row can't hide its session.
function sceneQuery(
	userId: string,
	filter: SceneFilter,
	limit: number,
	offset: number
): ReturnType<typeof sql> {
	const media = sql`JOIN media result_media ON result_media.id = s.result_media_id
		JOIN buckets result_bucket ON result_bucket.id = result_media.bucket
		JOIN media source_media ON source_media.id = s.source_media_id
		JOIN buckets source_bucket ON source_bucket.id = source_media.bucket`;
	const columns = sql`s.id, s.user_id, s.result_media_id, s.source_media_id,
		result_media.filename AS result_filename, result_bucket.name AS result_bucket_name,
		s.kind, s.created_at, s.session_id, s.session_title, s.project_id, s.project_title,
		s.iteration, s.number, source_generation.id AS source_generation_id,
		source_generation.kind AS source_generation_kind`;
	const sourceGenerationJoin = sql`LEFT JOIN generations source_generation ON source_generation.id = (
		SELECT produced.id FROM generations produced
		WHERE produced.user_id = s.user_id AND produced.result_media_id = s.source_media_id
		AND produced.id != s.id
		AND (produced.created_at, produced.id) < (
			SELECT earliest.created_at, earliest.id FROM generations earliest
			WHERE earliest.user_id = s.user_id AND earliest.source_media_id = s.source_media_id
			ORDER BY earliest.created_at, earliest.id LIMIT 1)
		ORDER BY produced.created_at DESC, produced.id DESC LIMIT 1)`;
	const sessionColumns = sql`ps.id AS session_id, ps.title AS session_title,
		p.id AS project_id, p.title AS project_title`;
	const conditions = sql`g.user_id = ${userId}
		AND (${filter.projectId} IS NULL OR p.id = ${filter.projectId})
		AND (${filter.sessionId} IS NULL OR ps.id = ${filter.sessionId})`;
	if (filter.view === 'iterations') {
		return sql`WITH s AS (
			SELECT g.id, g.user_id, g.result_media_id, g.source_media_id, g.kind, g.created_at,
			${sessionColumns}, CASE WHEN p.id IS NULL THEN NULL ELSE
			ROW_NUMBER() OVER (PARTITION BY g.session_id ORDER BY g.created_at, g.id) END AS iteration,
			ROW_NUMBER() OVER (ORDER BY g.created_at, g.id) AS number
			FROM generations g ${LIVE_SESSION_JOINS} WHERE ${conditions})
			SELECT ${columns} FROM s ${media} ${sourceGenerationJoin}
			ORDER BY s.created_at DESC, s.id DESC LIMIT ${limit} OFFSET ${offset}`;
	}
	return sql`WITH ranked AS (
		SELECT g.id, g.user_id, g.result_media_id, g.kind, g.created_at, ${sessionColumns},
		ROW_NUMBER() OVER (PARTITION BY g.session_id ORDER BY g.created_at DESC, g.id DESC) AS latest_rank,
		COUNT(*) OVER (PARTITION BY g.session_id) AS iteration,
		FIRST_VALUE(g.source_media_id) OVER (PARTITION BY g.session_id ORDER BY g.created_at, g.id) AS source_media_id
		FROM generations g ${LIVE_SESSION_JOINS} WHERE ${conditions} AND p.id IS NOT NULL
		AND g.kind IN (${sql.join(
			generationKinds.map((kind) => sql`${kind}`),
			sql`, `
		)})),
		s AS (SELECT ranked.*, ROW_NUMBER() OVER (ORDER BY created_at, id) AS number
		FROM ranked WHERE latest_rank = 1)
		SELECT ${columns} FROM s ${media} ${sourceGenerationJoin}
		ORDER BY s.created_at DESC, s.id DESC LIMIT ${limit} OFFSET ${offset}`;
}

export async function listGeneratedImages(
	db: Database,
	userId: string,
	filter: SceneFilter,
	offset: number,
	size: number
): Promise<GeneratedImagesPage> {
	const { items } = await collectValidRows(
		(limit, rawOffset) => db.all<SceneRow>(sceneQuery(userId, filter, limit, rawOffset)),
		toScene,
		offset + size + 1
	);
	return {
		images: items.slice(offset, offset + size),
		hasMore: items.length > offset + size
	};
}

interface SceneFilterSessionRow {
	project_id: string;
	project_title: string;
	session_id: string;
	session_title: string;
}

// Grouped by project in the order each project was last generated in, and
// each project's sessions likewise.
export async function listSceneFilterProjects(
	db: Database,
	userId: string
): Promise<SceneFilterProject[]> {
	const rows = await db.all<SceneFilterSessionRow>(
		sql`SELECT p.id AS project_id, p.title AS project_title, ps.id AS session_id,
			ps.title AS session_title, MAX(g.created_at) AS last_generated_at,
			MAX(MAX(g.created_at)) OVER (PARTITION BY p.id) AS project_last_generated_at
			FROM generations g
			JOIN project_sessions ps ON ps.id = g.session_id AND ps.archived_at IS NULL
			JOIN projects p ON p.id = ps.project_id AND p.user_id = g.user_id AND p.archived_at IS NULL
			WHERE g.user_id = ${userId} GROUP BY ps.id
			ORDER BY project_last_generated_at DESC, p.id, last_generated_at DESC, ps.id`
	);
	const projects: SceneFilterProject[] = [];
	for (const row of rows) {
		let project = projects.at(-1);
		if (project?.projectId !== row.project_id) {
			project = { projectId: row.project_id, projectTitle: row.project_title, sessions: [] };
			projects.push(project);
		}
		project.sessions.push({ sessionId: row.session_id, sessionTitle: row.session_title });
	}
	return projects;
}

// Dedup lookup for /api/uploads: reuse an already-stored object when this user
// has uploaded identical bytes before. Empty checksums never match.
export async function findGenerationSourceByHash(
	db: Database,
	userId: string,
	hash: string,
	uploadsBucketName: string
): Promise<number | null> {
	if (hash.length === 0) return null;
	const row = await db.get<{ id: number }>(
		sql`SELECT media.id FROM generations
			JOIN media ON media.id = generations.source_media_id
			JOIN buckets ON buckets.id = media.bucket
			WHERE generations.user_id = ${userId} AND media.checksum = ${hash} AND buckets.name = ${uploadsBucketName}
			ORDER BY generations.created_at DESC LIMIT 1`
	);
	return row?.id ?? null;
}

interface ResourceImageRow {
	media_id: number;
	created_at: number;
	roles: string;
}

// Which generations a usage figure counts: one user's (or everyone's) and,
// for a day's usage, only those created in [from, to).
export interface UsageRange {
	from: number;
	to: number;
}

interface UsageScope {
	userId?: string;
	range?: UsageRange;
}

function scopeCondition(scope: UsageScope, userColumn: SQL, createdColumn: SQL): SQL {
	const user = scope.userId === undefined ? sql`1 = 1` : sql`${userColumn} = ${scope.userId}`;
	const range = scope.range
		? sql`${createdColumn} >= ${scope.range.from} AND ${createdColumn} < ${scope.range.to}`
		: sql`1 = 1`;
	return sql`${user} AND ${range}`;
}

function sourceUses(scope: UsageScope = {}): SQL {
	return sql`SELECT used.user_id, used.media_id, used.created_at, 'source' AS role FROM (
		SELECT g.user_id, g.source_media_id AS media_id, MAX(g.created_at) AS created_at FROM generations g
		WHERE ${scopeCondition(scope, sql`g.user_id`, sql`g.created_at`)}
		GROUP BY g.user_id, g.source_media_id) used
		JOIN media source_media ON source_media.id = used.media_id
		WHERE source_media.checksum != ''
		AND NOT EXISTS (SELECT 1 FROM generations produced WHERE produced.result_media_id = used.media_id)`;
}

function referenceUses(scope: UsageScope = {}): SQL {
	return sql`SELECT g.user_id, g.reference_media_id AS media_id, g.created_at,
		CASE g.kind WHEN 'style-transfer' THEN 'style-reference'
		WHEN 'object-replacement' THEN 'object-reference'
		ELSE 'texture-reference' END AS role FROM generations g
		WHERE ${scopeCondition(scope, sql`g.user_id`, sql`g.created_at`)}
		AND g.reference_media_id IS NOT NULL
		AND g.kind IN ('style-transfer', 'object-replacement', 'texture-replacement')`;
}

function isResourceRole(role: string): role is ResourceRole {
	return (resourceRoles as readonly string[]).includes(role);
}

export async function listResourceImages(
	db: Database,
	userId: string,
	filter: ResourceFilter,
	offset: number,
	size: number
): Promise<ResourceImagesPage> {
	const uses =
		filter === 'sources'
			? sourceUses({ userId })
			: filter === 'references'
				? referenceUses({ userId })
				: sql`${sourceUses({ userId })} UNION ALL ${referenceUses({ userId })}`;
	const rows = await db.all<ResourceImageRow>(
		sql`SELECT media_id, MAX(created_at) AS created_at, group_concat(DISTINCT role) AS roles
			FROM (${uses}) GROUP BY media_id ORDER BY created_at DESC, media_id DESC
			LIMIT ${size + 1} OFFSET ${offset}`
	);
	return {
		images: rows.slice(0, size).map((row) => ({
			mediaId: row.media_id,
			createdAt: row.created_at,
			roles: row.roles.split(',').filter(isResourceRole)
		})),
		hasMore: rows.length > size
	};
}

// Every role an image has among the user's resources — empty when it isn't
// one of theirs at all, which the resource page treats as "not found" rather
// than revealing whether the image exists.
export async function getResourceRoles(
	db: Database,
	userId: string,
	mediaId: number
): Promise<ResourceRole[]> {
	const row = await db.get<{ roles: string | null }>(
		sql`SELECT group_concat(DISTINCT role) AS roles
			FROM (${sourceUses({ userId })} UNION ALL ${referenceUses({ userId })})
			WHERE media_id = ${mediaId}`
	);
	return row?.roles ? row.roles.split(',').filter(isResourceRole) : [];
}

export interface ResourceGeneration {
	id: string;
	kind: GenerationKind;
	createdAt: number;
	resultMediaId: number;
	// How this generation used the image — as its source, as its reference,
	// or (rarely) both.
	roles: ResourceRole[];
	session: GenerationSessionRef | null;
	// Whether restoring it can bring back the form it was submitted with:
	// false for generations recorded before form_snapshot existed
	// (migrations/0018) — reopening those would show the result but none of
	// the settings, references included, that produced it. An upscale has no
	// settings to begin with, so it always counts as saved.
	settingsSaved: boolean;
}

interface ResourceGenerationRow {
	id: string;
	kind: string;
	created_at: number;
	result_media_id: number;
	as_source: number;
	as_reference: number;
	has_snapshot: number;
	session_id: string | null;
	session_title: string | null;
	project_id: string | null;
	project_title: string | null;
}

const REFERENCE_ROLE_BY_KIND: Partial<Record<GenerationKind, ResourceRole>> = {
	'style-transfer': 'style-reference',
	'object-replacement': 'object-reference',
	'texture-replacement': 'texture-reference'
};

function toResourceGeneration(row: ResourceGenerationRow): ResourceGeneration | null {
	const kind = generationKindForRow(row.id, row.kind);
	if (kind === null) return null;
	const referenceRole = REFERENCE_ROLE_BY_KIND[kind];
	const roles: ResourceRole[] = [
		...(row.as_source ? (['source'] as const) : []),
		...(row.as_reference && referenceRole ? [referenceRole] : [])
	];
	return {
		id: row.id,
		kind,
		createdAt: row.created_at,
		resultMediaId: row.result_media_id,
		roles,
		settingsSaved: row.has_snapshot === 1 || kind === 'upscale',
		// Same rule as getGenerationDetailForUser: an archived session or
		// project leaves nothing to continue.
		session:
			row.session_id !== null &&
			row.session_title !== null &&
			row.project_id !== null &&
			row.project_title !== null
				? {
						projectId: row.project_id,
						projectTitle: row.project_title,
						sessionId: row.session_id,
						sessionTitle: row.session_title
					}
				: null
	};
}

// The user's generations an image took part in — as the photo they started
// from or as a reference — newest first, for the resource page.
export async function listResourceGenerations(
	db: Database,
	userId: string,
	mediaId: number,
	offset: number,
	size: number
): Promise<{ generations: ResourceGeneration[]; hasMore: boolean }> {
	const { items } = await collectValidRows(
		(limit, rawOffset) =>
			db.all<ResourceGenerationRow>(
				sql`SELECT g.id, g.kind, g.created_at, g.result_media_id,
					g.source_media_id = ${mediaId} AS as_source,
					COALESCE(g.reference_media_id = ${mediaId}, 0) AS as_reference,
					g.form_snapshot IS NOT NULL AS has_snapshot,
					ps.id AS session_id, ps.title AS session_title,
					p.id AS project_id, p.title AS project_title
					FROM generations g
					LEFT JOIN project_sessions ps ON ps.id = g.session_id AND ps.archived_at IS NULL
					LEFT JOIN projects p ON p.id = ps.project_id AND p.user_id = g.user_id
					AND p.archived_at IS NULL
					WHERE g.user_id = ${userId} AND (g.source_media_id = ${mediaId} OR g.reference_media_id = ${mediaId})
					ORDER BY g.created_at DESC, g.id DESC LIMIT ${limit} OFFSET ${rawOffset}`
			),
		toResourceGeneration,
		offset + size + 1
	);
	return {
		generations: items.slice(offset, offset + size),
		hasMore: items.length > offset + size
	};
}

interface UserUsageRow {
	pubkey: string;
	balance: number;
	total_deposit: number;
	last_deposit_at: number | null;
	project_count: number;
	session_count: number;
	generation_count: number;
	source_count: number;
	source_bytes: number | null;
	reference_count: number;
	reference_bytes: number | null;
	total_spend: number;
	latest_spend_at: number | null;
	first_sign_in_at: number | null;
	last_sign_in_at: number | null;
}

function toUserUsageRecord(row: UserUsageRow): UserUsageRecord {
	return {
		pubkey: row.pubkey,
		balance: row.balance,
		totalDeposit: row.total_deposit,
		lastDepositAt: row.last_deposit_at,
		projectCount: row.project_count,
		sessionCount: row.session_count,
		generationCount: row.generation_count,
		sourceCount: row.source_count,
		sourceBytes: row.source_bytes,
		referenceCount: row.reference_count,
		referenceBytes: row.reference_bytes,
		totalSpend: row.total_spend,
		latestSpendAt: row.latest_spend_at,
		firstSignInAt: row.first_sign_in_at,
		lastSignInAt: row.last_sign_in_at
	};
}

function resourcePairs(scope: UsageScope = {}): SQL {
	return sql`source_resources AS (
		SELECT DISTINCT user_id, media_id FROM (${sourceUses(scope)})
	), reference_resources AS (
		SELECT DISTINCT user_id, media_id FROM (${referenceUses(scope)})
	)`;
}

// One row per user of `scope`. With a range, every figure covers only that
// window, except the balance — that stays the running balance as of its end.
function userUsageQuery(scope: UsageScope): SQL {
	const ledgerScope = scopeCondition({ userId: scope.userId }, sql`user_id`, sql`created_at`);
	const ledgerUntil = scope.range ? sql`AND created_at < ${scope.range.to}` : sql``;
	const ledgerSince = scope.range ? sql`AND created_at >= ${scope.range.from}` : sql``;
	// Sessions are deleted on sign-out, so sign-ins are read from the login
	// challenges, each consumed exactly once by a successful verify.
	const signInUser =
		scope.userId === undefined
			? sql``
			: sql`AND pubkey = (SELECT pubkey FROM users WHERE id = ${scope.userId})`;
	const signInRange = scope.range
		? sql`AND used_at >= ${scope.range.from} AND used_at < ${scope.range.to}`
		: sql``;
	return sql`WITH ${resourcePairs(scope)}
		SELECT u.pubkey, COALESCE(l.balance, 0) AS balance, COALESCE(l.total_deposit, 0) AS total_deposit, l.last_deposit_at,
		COALESCE(pr.project_count, 0) AS project_count,
		COALESCE(ps.session_count, 0) AS session_count,
		COALESCE(g.generation_count, 0) AS generation_count,
		COALESCE(sources.source_count, 0) AS source_count, sources.source_bytes,
		COALESCE(refs.reference_count, 0) AS reference_count, refs.reference_bytes,
		COALESCE(l.total_spend, 0) AS total_spend, l.latest_spend_at,
		a.first_sign_in_at, a.last_sign_in_at
		FROM users u
		LEFT JOIN (SELECT user_id,
			SUM(CASE WHEN entry_side = 'credit' THEN amount ELSE -amount END) / 100.0 AS balance,
			SUM(CASE WHEN entry_side = 'credit' AND reason IS NOT 'historical-reconciliation' ${ledgerSince} THEN amount ELSE 0 END) / 100.0 AS total_deposit,
			MAX(CASE WHEN entry_side = 'credit' AND reason IS NOT 'historical-reconciliation' ${ledgerSince} THEN created_at END) AS last_deposit_at,
			SUM(CASE WHEN entry_side = 'debit' AND reason = 'generation-charge' ${ledgerSince} THEN amount ELSE 0 END) / 100.0 AS total_spend,
			MAX(CASE WHEN entry_side = 'debit' AND reason = 'generation-charge' ${ledgerSince} THEN created_at END) AS latest_spend_at
			FROM ledger_entries WHERE ${ledgerScope} ${ledgerUntil} GROUP BY user_id) l ON l.user_id = u.id
		LEFT JOIN (SELECT user_id, COUNT(*) AS project_count FROM projects
		WHERE ${scopeCondition(scope, sql`user_id`, sql`created_at`)} GROUP BY user_id) pr
		ON pr.user_id = u.id
		LEFT JOIN (SELECT p.user_id, COUNT(*) AS session_count FROM project_sessions s
		JOIN projects p ON p.id = s.project_id
		WHERE ${scopeCondition(scope, sql`p.user_id`, sql`s.created_at`)} GROUP BY p.user_id) ps
		ON ps.user_id = u.id
		LEFT JOIN (SELECT user_id, COUNT(*) AS generation_count FROM generations
		WHERE ${scopeCondition(scope, sql`user_id`, sql`created_at`)} GROUP BY user_id) g
		ON g.user_id = u.id
		LEFT JOIN (SELECT s.user_id, COUNT(*) AS source_count, SUM(m.size) AS source_bytes
		FROM source_resources s JOIN media m ON m.id = s.media_id
		GROUP BY s.user_id) sources ON sources.user_id = u.id
		LEFT JOIN (SELECT r.user_id, COUNT(*) AS reference_count, SUM(m.size) AS reference_bytes
		FROM reference_resources r JOIN media m ON m.id = r.media_id GROUP BY r.user_id) refs
		ON refs.user_id = u.id
		LEFT JOIN (SELECT pubkey, MIN(used_at) AS first_sign_in_at, MAX(used_at) AS last_sign_in_at
		FROM auth_challenges WHERE used_at IS NOT NULL ${signInUser} ${signInRange} GROUP BY pubkey) a
		ON a.pubkey = u.pubkey
		WHERE ${scopeCondition({ userId: scope.userId }, sql`u.id`, sql`u.created_at`)}`;
}

export async function listUserUsage(
	db: Database,
	offset: number,
	size: number
): Promise<UserUsagePage> {
	const rows = await db.all<UserUsageRow>(
		sql`${userUsageQuery({})} ORDER BY u.created_at DESC, u.id DESC LIMIT ${size + 1} OFFSET ${offset}`
	);
	return {
		users: rows.slice(0, size).map(toUserUsageRecord),
		hasMore: rows.length > size
	};
}

export async function getUserUsage(
	db: Database,
	userId: string,
	range?: UsageRange
): Promise<UserUsageRecord | null> {
	const row = await db.get<UserUsageRow>(userUsageQuery({ userId, range }));
	return row ? toUserUsageRecord(row) : null;
}

// Unrecognized kinds are left out, as everywhere else generations are listed.
export async function listUserGenerationKinds(
	db: Database,
	userId: string,
	range?: UsageRange
): Promise<GenerationKindCount[]> {
	const rows = await db.all<{ kind: GenerationKind; count: number }>(
		sql`SELECT g.kind, COUNT(*) AS count FROM generations g
			WHERE ${scopeCondition({ userId, range }, sql`g.user_id`, sql`g.created_at`)}
			AND g.kind IN (${sql.join(
				generationKinds.map((kind) => sql`${kind}`),
				sql`, `
			)})
			GROUP BY g.kind ORDER BY count DESC, g.kind`
	);
	return rows.map((row) => ({ kind: row.kind, count: row.count }));
}

interface UsageGenerationRow {
	id: string;
	kind: string;
	created_at: number;
	prompt: string;
	source_bucket_name: string;
	source_filename: string;
	result_bucket_name: string;
	result_filename: string;
	reference_bucket_name: string | null;
	reference_filename: string | null;
}

function toUsageGeneration(row: UsageGenerationRow): UsageGenerationRecord | null {
	const kind = generationKindForRow(row.id, row.kind);
	if (kind === null) return null;
	return {
		id: row.id,
		kind,
		createdAt: row.created_at,
		prompt: row.prompt,
		source: mediaLink(row.source_bucket_name, row.source_filename),
		result: mediaLink(row.result_bucket_name, row.result_filename),
		reference:
			row.reference_bucket_name !== null && row.reference_filename !== null
				? mediaLink(row.reference_bucket_name, row.reference_filename)
				: null
	};
}

// The last generation of a page; the next page starts right after it, so a
// generation made or deleted meanwhile neither repeats nor skips a row.
export interface UsageGenerationCursor {
	createdAt: number;
	id: string;
}

export async function listUserGenerations(
	db: Database,
	userId: string,
	range: UsageRange,
	after: UsageGenerationCursor | null,
	size: number,
	// Only generations of this kind; every recognized kind when omitted.
	kind?: GenerationKind
): Promise<{ generations: UsageGenerationRecord[]; next: UsageGenerationCursor | null }> {
	// Unrecognized kinds are left out in SQL, as in listUserGenerationKinds, so
	// every row of the page is one the response lists.
	const kinds = kind === undefined ? generationKinds : [kind];
	const afterCursor =
		after === null
			? sql``
			: sql`AND (g.created_at < ${after.createdAt}
				OR (g.created_at = ${after.createdAt} AND g.id < ${after.id}))`;
	const rows = await db.all<UsageGenerationRow>(
		sql`SELECT g.id, g.kind, g.created_at, g.prompt,
			source_bucket.name AS source_bucket_name, source_media.filename AS source_filename,
			result_bucket.name AS result_bucket_name, result_media.filename AS result_filename,
			reference_bucket.name AS reference_bucket_name,
			reference_media.filename AS reference_filename
			FROM generations g
			JOIN media source_media ON source_media.id = g.source_media_id
			JOIN buckets source_bucket ON source_bucket.id = source_media.bucket
			JOIN media result_media ON result_media.id = g.result_media_id
			JOIN buckets result_bucket ON result_bucket.id = result_media.bucket
			LEFT JOIN media reference_media ON reference_media.id = g.reference_media_id
			LEFT JOIN buckets reference_bucket ON reference_bucket.id = reference_media.bucket
			WHERE ${scopeCondition({ userId, range }, sql`g.user_id`, sql`g.created_at`)}
			AND g.kind IN (${sql.join(
				kinds.map((candidate) => sql`${candidate}`),
				sql`, `
			)})
			${afterCursor}
			ORDER BY g.created_at DESC, g.id DESC LIMIT ${size + 1}`
	);
	const page = rows.slice(0, size);
	const last = page.at(-1);
	return {
		generations: page.map(toUsageGeneration).filter((generation) => generation !== null),
		next:
			rows.length > size && last !== undefined ? { createdAt: last.created_at, id: last.id } : null
	};
}

interface UsageTotalsRow {
	user_count: number;
	project_count: number;
	session_count: number;
	generation_count: number;
	source_count: number;
	source_bytes: number | null;
	reference_count: number;
	reference_bytes: number | null;
	total_spend: number;
	total_deposit: number;
}

// Platform-wide counterpart of listUserUsage: every figure follows the same
// per-user rules, so each total equals the sum of its column in the table.
export async function getUsageTotals(db: Database): Promise<UsageTotals> {
	const row = await db.get<UsageTotalsRow>(
		sql`WITH ${resourcePairs()}
			SELECT (SELECT COUNT(*) FROM users) AS user_count,
			(SELECT COUNT(*) FROM projects) AS project_count,
			(SELECT COUNT(*) FROM project_sessions) AS session_count,
			(SELECT COUNT(*) FROM generations) AS generation_count,
			(SELECT COUNT(*) FROM source_resources) AS source_count,
			(SELECT SUM(m.size) FROM source_resources s
			JOIN media m ON m.id = s.media_id) AS source_bytes,
			(SELECT COUNT(*) FROM reference_resources) AS reference_count,
			(SELECT SUM(m.size) FROM reference_resources r
			JOIN media m ON m.id = r.media_id) AS reference_bytes,
			(SELECT COALESCE(SUM(amount), 0) / 100.0 FROM ledger_entries WHERE entry_side = 'debit' AND reason = 'generation-charge') AS total_spend,
			(SELECT COALESCE(SUM(amount), 0) / 100.0 FROM ledger_entries WHERE entry_side = 'credit' AND reason IS NOT 'historical-reconciliation') AS total_deposit`
	);
	if (!row) throw new Error('usage totals query returned no row');
	return {
		userCount: row.user_count,
		projectCount: row.project_count,
		sessionCount: row.session_count,
		generationCount: row.generation_count,
		sourceCount: row.source_count,
		sourceBytes: row.source_bytes,
		referenceCount: row.reference_count,
		referenceBytes: row.reference_bytes,
		totalSpend: row.total_spend,
		totalDeposit: row.total_deposit
	};
}

interface CreditTransactionRow {
	id: string;
	generation_id: string | null;
	amount: number;
	balance_after: number;
	kind: string | null;
	created_at: number;
	comfyui_upload_queue_sec: number;
	comfyui_queue_wait_sec: number;
	comfyui_execution_sec: number;
	comfyui_download_sec: number;
	comfyui_reupload_sec: number;
	archai_render_sec: number;
	archai_download_sec: number;
	archai_reupload_sec: number;
	session_id: string | null;
	project_id: string | null;
}

function toCreditTransaction(row: CreditTransactionRow): CreditTransaction {
	const kind =
		row.kind === null || row.generation_id === null
			? null
			: generationKindForRow(row.generation_id, row.kind);
	return {
		id: row.id,
		generationId: row.generation_id,
		amount: row.amount,
		balanceAfter: row.balance_after,
		kind,
		createdAt: row.created_at,
		comfyuiUploadQueueSec: row.comfyui_upload_queue_sec,
		comfyuiQueueWaitSec: row.comfyui_queue_wait_sec,
		comfyuiExecutionSec: row.comfyui_execution_sec,
		comfyuiDownloadSec: row.comfyui_download_sec,
		comfyuiReuploadSec: row.comfyui_reupload_sec,
		archaiRenderSec: row.archai_render_sec,
		archaiDownloadSec: row.archai_download_sec,
		archaiReuploadSec: row.archai_reupload_sec,
		sessionId: row.session_id,
		projectId: row.project_id
	};
}

export async function listCreditHistory(
	db: Database,
	userId: string,
	limit = 50
): Promise<CreditTransaction[]> {
	const rows = await db.all<CreditTransactionRow>(
		sql`WITH entries AS (
			SELECT id, user_id, amount, entry_side, reason, created_at,
				SUM(CASE WHEN entry_side = 'credit' THEN amount ELSE -amount END)
					OVER (ORDER BY id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) / 100.0 AS balance_after
			FROM ledger_entries WHERE user_id = ${userId}
        ) SELECT CAST(l.id AS TEXT) AS id, g.id AS generation_id, l.amount / 100.0 AS amount, l.balance_after, g.kind, l.created_at,
			COALESCE(g.comfyui_upload_queue_sec, 0) AS comfyui_upload_queue_sec,
			COALESCE(g.comfyui_queue_wait_sec, 0) AS comfyui_queue_wait_sec,
			COALESCE(g.comfyui_execution_sec, 0) AS comfyui_execution_sec,
			COALESCE(g.comfyui_download_sec, 0) AS comfyui_download_sec,
			COALESCE(g.comfyui_reupload_sec, 0) AS comfyui_reupload_sec,
			COALESCE(g.archai_render_sec, 0) AS archai_render_sec,
			COALESCE(g.archai_download_sec, 0) AS archai_download_sec,
			COALESCE(g.archai_reupload_sec, 0) AS archai_reupload_sec,
			g.session_id, ps.project_id FROM entries l
			LEFT JOIN generations g ON g.ledger_entry_id = l.id AND g.user_id = l.user_id
			LEFT JOIN project_sessions ps ON ps.id = g.session_id
			WHERE l.entry_side = 'debit' AND l.reason = 'generation-charge'
			ORDER BY l.created_at DESC, l.id DESC LIMIT ${limit}`
	);
	return rows.map(toCreditTransaction);
}
