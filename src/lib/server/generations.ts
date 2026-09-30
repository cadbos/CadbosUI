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

import type { D1Database } from '@cloudflare/workers-types';
import {
	generationKinds,
	resourceRoles,
	type Balance,
	type CreditTransaction,
	type GenerationKind,
	type GenerationSessionRef,
	type RequestFormSnapshot,
	type ResourceFilter,
	type ResourceRole,
	type SceneFilterProject,
	type SceneView,
	type UsageTotals,
	type UserUsageRecord
} from '$lib/api/contract';
import { formSnapshotSchema } from '$lib/server/api';

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
	kind: CreditTransaction['kind'];
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
}

// The stored generation's id alongside the caller's resulting balance — the
// id is what the client must use for this result, so anything that later
// refers back to it (a session fork point, a restore) finds the real row.
export interface RecordedGeneration extends Balance {
	id: string;
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
): Promise<RecordedGeneration> {
	const now = Date.now();
	const id = crypto.randomUUID();
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
					'(id, user_id, result_media_id, source_media_id, prompt, kind, amount, balance_after, created_at, session_id, ' +
					'archai_render_sec, archai_download_sec, archai_reupload_sec, form_snapshot, reference_media_id) ' +
					'SELECT ?, ?, ?, ?, ?, ?, ?, balance, ?, ?, ?, ?, ?, ?, ? FROM credits WHERE user_id = ?'
			)
			.bind(
				id,
				userId,
				input.resultMediaId,
				input.sourceMediaId,
				input.prompt,
				input.kind,
				input.amount,
				now,
				input.sessionId,
				input.archaiRenderSec,
				input.archaiDownloadSec,
				input.archaiReuploadSec,
				input.formSnapshot ? JSON.stringify(input.formSnapshot) : null,
				input.referenceMediaId ?? null,
				userId
			)
	]);
	const row = updateResult.results[0];
	if (!row) throw new Error('credit deduction failed: no credit row for user');

	return { id, ...toBalance(row) };
}

export async function getGeneratedImageForUser(
	db: D1Database,
	userId: string,
	id: string
): Promise<GeneratedImage | null> {
	const row = await db
		.prepare(
			'SELECT g.id, g.user_id, g.result_media_id, g.source_media_id, result_media.filename AS result_filename, ' +
				'result_bucket.name AS result_bucket_name, ' +
				'g.kind, g.created_at FROM generations g ' +
				'JOIN media result_media ON result_media.id = g.result_media_id ' +
				'JOIN buckets result_bucket ON result_bucket.id = result_media.bucket ' +
				'JOIN media source_media ON source_media.id = g.source_media_id ' +
				'JOIN buckets source_bucket ON source_bucket.id = source_media.bucket ' +
				'WHERE g.id = ? AND g.user_id = ?'
		)
		.bind(id, userId)
		.first<GenerationRow>();
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
	db: D1Database,
	userId: string,
	id: string
): Promise<GenerationDetail | null> {
	const row = await db
		.prepare(
			'SELECT g.id, g.source_media_id, g.result_media_id, g.prompt, g.kind, g.created_at, ' +
				'g.amount, g.balance_after, g.form_snapshot, ps.id AS session_id, ps.title AS session_title, ' +
				'p.id AS project_id, p.title AS project_title ' +
				'FROM generations g ' +
				'LEFT JOIN project_sessions ps ON ps.id = g.session_id AND ps.archived_at IS NULL ' +
				'LEFT JOIN projects p ON p.id = ps.project_id AND p.user_id = g.user_id ' +
				'AND p.archived_at IS NULL ' +
				'WHERE g.id = ? AND g.user_id = ?'
		)
		.bind(id, userId)
		.first<GenerationDetailRow>();
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
	db: D1Database,
	userId: string,
	id: string,
	mediaId: number
): Promise<{ generationDeleted: boolean; mediaDeleted: boolean }> {
	const [generationResult, mediaResult] = await db.batch<{ deleted: number }>([
		db
			.prepare(
				'DELETE FROM generations WHERE id = ? AND user_id = ? AND result_media_id = ? RETURNING 1 AS deleted'
			)
			.bind(id, userId, mediaId),
		db
			.prepare(
				'DELETE FROM media WHERE id = ? AND changes() = 1 AND NOT EXISTS (' +
					'SELECT 1 FROM generations WHERE result_media_id = ? OR source_media_id = ? OR reference_media_id = ? ' +
					'UNION ALL SELECT 1 FROM object_replacement_jobs WHERE scene_media_id = ? OR reference_media_id = ? OR output_media_id = ? ' +
					'UNION ALL SELECT 1 FROM texture_replacement_jobs WHERE scene_media_id = ? OR reference_media_id = ? OR output_media_id = ? ' +
					'UNION ALL SELECT 1 FROM light_settings_jobs WHERE scene_media_id = ? OR output_media_id = ?' +
					') RETURNING 1 AS deleted'
			)
			.bind(
				mediaId,
				mediaId,
				mediaId,
				mediaId,
				mediaId,
				mediaId,
				mediaId,
				mediaId,
				mediaId,
				mediaId,
				mediaId,
				mediaId
			)
	]);
	return {
		generationDeleted: generationResult.results.length === 1,
		mediaDeleted: mediaResult.results.length === 1
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
}

function toScene(row: SceneRow): Scene | null {
	const image = toGeneratedImage(row);
	return image
		? { ...image, session: sessionRefForRow(row), iteration: row.iteration, number: row.number }
		: null;
}

// The live session/project a generation belongs to — the same archived-out
// joins getGenerationDetailForUser uses, so filtering by project or session
// only ever matches live ones.
const LIVE_SESSION_JOINS =
	'LEFT JOIN project_sessions ps ON ps.id = g.session_id AND ps.archived_at IS NULL ' +
	'LEFT JOIN projects p ON p.id = ps.project_id AND p.user_id = g.user_id AND p.archived_at IS NULL ';

const SCENE_FILTER_CONDITIONS =
	'g.user_id = ? AND (? IS NULL OR p.id = ?) AND (? IS NULL OR ps.id = ?)';

function sceneFilterBindings(userId: string, filter: SceneFilter): (string | null)[] {
	return [userId, filter.projectId, filter.projectId, filter.sessionId, filter.sessionId];
}

// `milestones` ranks each live session's generations to pick its latest one
// (the milestone) and pairs it with the source of its earliest one. Only
// recognized kinds take part, so one unreadable row can't hide its session.
function sceneQuery(filter: SceneFilter): string {
	const media =
		'JOIN media result_media ON result_media.id = s.result_media_id ' +
		'JOIN buckets result_bucket ON result_bucket.id = result_media.bucket ' +
		'JOIN media source_media ON source_media.id = s.source_media_id ' +
		'JOIN buckets source_bucket ON source_bucket.id = source_media.bucket ';
	const columns =
		's.id, s.user_id, s.result_media_id, s.source_media_id, result_media.filename AS result_filename, ' +
		'result_bucket.name AS result_bucket_name, s.kind, s.created_at, ' +
		's.session_id, s.session_title, s.project_id, s.project_title, s.iteration, s.number ';
	const sessionColumns =
		'ps.id AS session_id, ps.title AS session_title, p.id AS project_id, p.title AS project_title';
	if (filter.view === 'iterations') {
		return (
			'WITH s AS (SELECT g.id, g.user_id, g.result_media_id, g.source_media_id, g.kind, g.created_at, ' +
			`${sessionColumns}, CASE WHEN p.id IS NULL THEN NULL ELSE ` +
			'ROW_NUMBER() OVER (PARTITION BY g.session_id ORDER BY g.created_at, g.id) END AS iteration, ' +
			'ROW_NUMBER() OVER (ORDER BY g.created_at, g.id) AS number ' +
			`FROM generations g ${LIVE_SESSION_JOINS}WHERE ${SCENE_FILTER_CONDITIONS}) ` +
			`SELECT ${columns}FROM s ${media}ORDER BY s.created_at DESC, s.id DESC LIMIT ? OFFSET ?`
		);
	}
	return (
		'WITH ranked AS (SELECT g.id, g.user_id, g.result_media_id, g.kind, g.created_at, ' +
		`${sessionColumns}, ` +
		'ROW_NUMBER() OVER (PARTITION BY g.session_id ORDER BY g.created_at DESC, g.id DESC) AS latest_rank, ' +
		'COUNT(*) OVER (PARTITION BY g.session_id) AS iteration, ' +
		'FIRST_VALUE(g.source_media_id) OVER (PARTITION BY g.session_id ORDER BY g.created_at, g.id) ' +
		`AS source_media_id FROM generations g ${LIVE_SESSION_JOINS}` +
		`WHERE ${SCENE_FILTER_CONDITIONS} AND p.id IS NOT NULL ` +
		`AND g.kind IN (${generationKinds.map(() => '?').join(', ')})), ` +
		's AS (SELECT ranked.*, ROW_NUMBER() OVER (ORDER BY created_at, id) AS number ' +
		'FROM ranked WHERE latest_rank = 1) ' +
		`SELECT ${columns}FROM s ${media}ORDER BY s.created_at DESC, s.id DESC LIMIT ? OFFSET ?`
	);
}

export async function listGeneratedImages(
	db: D1Database,
	userId: string,
	filter: SceneFilter,
	offset: number,
	size: number
): Promise<GeneratedImagesPage> {
	const bindings =
		filter.view === 'iterations'
			? sceneFilterBindings(userId, filter)
			: [...sceneFilterBindings(userId, filter), ...generationKinds];
	const query = sceneQuery(filter);
	const { items } = await collectValidRows(
		async (limit, rawOffset) => {
			const result = await db
				.prepare(query)
				.bind(...bindings, limit, rawOffset)
				.all<SceneRow>();
			return result.results ?? [];
		},
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
	db: D1Database,
	userId: string
): Promise<SceneFilterProject[]> {
	const result = await db
		.prepare(
			'SELECT p.id AS project_id, p.title AS project_title, ps.id AS session_id, ' +
				'ps.title AS session_title, MAX(g.created_at) AS last_generated_at, ' +
				'MAX(MAX(g.created_at)) OVER (PARTITION BY p.id) AS project_last_generated_at ' +
				'FROM generations g ' +
				'JOIN project_sessions ps ON ps.id = g.session_id AND ps.archived_at IS NULL ' +
				'JOIN projects p ON p.id = ps.project_id AND p.user_id = g.user_id AND p.archived_at IS NULL ' +
				'WHERE g.user_id = ? GROUP BY ps.id ' +
				'ORDER BY project_last_generated_at DESC, p.id, last_generated_at DESC, ps.id'
		)
		.bind(userId)
		.all<SceneFilterSessionRow>();
	const projects: SceneFilterProject[] = [];
	for (const row of result.results ?? []) {
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
	db: D1Database,
	userId: string,
	hash: string,
	uploadsBucketName: string
): Promise<number | null> {
	if (hash.length === 0) return null;
	const row = await db
		.prepare(
			'SELECT media.id FROM generations ' +
				'JOIN media ON media.id = generations.source_media_id ' +
				'JOIN buckets ON buckets.id = media.bucket ' +
				'WHERE generations.user_id = ? AND media.checksum = ? AND buckets.name = ? ' +
				'ORDER BY generations.created_at DESC LIMIT 1'
		)
		.bind(userId, hash, uploadsBucketName)
		.first<{ id: number }>();
	return row?.id ?? null;
}

interface ResourceImageRow {
	media_id: number;
	created_at: number;
	roles: string;
}

// Source photos the user uploaded: a non-empty checksum identifies an
// upload, and excluding generated outputs drops sources that were a
// previous generation's own result. Both tests depend only on the media, so
// the generations are collapsed to one row per source first and each image is
// checked once, however many generations reused it.
const SOURCE_USES =
	"SELECT used.media_id, used.created_at, 'source' AS role FROM (" +
	'SELECT g.source_media_id AS media_id, MAX(g.created_at) AS created_at FROM generations g ' +
	'WHERE g.user_id = ? GROUP BY g.source_media_id) used ' +
	'JOIN media source_media ON source_media.id = used.media_id ' +
	"WHERE source_media.checksum != '' " +
	'AND NOT EXISTS (SELECT 1 FROM generations produced ' +
	'WHERE produced.result_media_id = used.media_id)';

// Reference images a generation was made with (migrations/0019), labelled
// by the tool that took them.
const REFERENCE_USES =
	'SELECT g.reference_media_id AS media_id, g.created_at, ' +
	"CASE g.kind WHEN 'style-transfer' THEN 'style-reference' " +
	"WHEN 'object-replacement' THEN 'object-reference' " +
	"ELSE 'texture-reference' END AS role FROM generations g " +
	'WHERE g.user_id = ? AND g.reference_media_id IS NOT NULL ' +
	"AND g.kind IN ('style-transfer', 'object-replacement', 'texture-replacement')";

function isResourceRole(role: string): role is ResourceRole {
	return (resourceRoles as readonly string[]).includes(role);
}

// The Resources gallery: every image the user uploaded and generated with,
// newest use first. An image used several times — or in several roles —
// is one card, dated by its latest use and carrying every role it had, so
// it shows up under each filter it belongs to.
export async function listResourceImages(
	db: D1Database,
	userId: string,
	filter: ResourceFilter,
	offset: number,
	size: number
): Promise<ResourceImagesPage> {
	const uses =
		filter === 'sources'
			? [SOURCE_USES]
			: filter === 'references'
				? [REFERENCE_USES]
				: [SOURCE_USES, REFERENCE_USES];
	const result = await db
		.prepare(
			'SELECT media_id, MAX(created_at) AS created_at, group_concat(DISTINCT role) AS roles ' +
				`FROM (${uses.join(' UNION ALL ')}) ` +
				'GROUP BY media_id ORDER BY created_at DESC, media_id DESC LIMIT ? OFFSET ?'
		)
		.bind(...uses.map(() => userId), size + 1, offset)
		.all<ResourceImageRow>();
	const rows = result.results ?? [];
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
	db: D1Database,
	userId: string,
	mediaId: number
): Promise<ResourceRole[]> {
	const row = await db
		.prepare(
			'SELECT group_concat(DISTINCT role) AS roles ' +
				`FROM (${SOURCE_USES} UNION ALL ${REFERENCE_USES}) WHERE media_id = ?`
		)
		.bind(userId, userId, mediaId)
		.first<{ roles: string | null }>();
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
	db: D1Database,
	userId: string,
	mediaId: number,
	offset: number,
	size: number
): Promise<{ generations: ResourceGeneration[]; hasMore: boolean }> {
	const { items } = await collectValidRows(
		async (limit, rawOffset) => {
			const result = await db
				.prepare(
					'SELECT g.id, g.kind, g.created_at, g.result_media_id, ' +
						'g.source_media_id = ? AS as_source, ' +
						'COALESCE(g.reference_media_id = ?, 0) AS as_reference, ' +
						'g.form_snapshot IS NOT NULL AS has_snapshot, ' +
						'ps.id AS session_id, ps.title AS session_title, ' +
						'p.id AS project_id, p.title AS project_title ' +
						'FROM generations g ' +
						'LEFT JOIN project_sessions ps ON ps.id = g.session_id AND ps.archived_at IS NULL ' +
						'LEFT JOIN projects p ON p.id = ps.project_id AND p.user_id = g.user_id ' +
						'AND p.archived_at IS NULL ' +
						'WHERE g.user_id = ? AND (g.source_media_id = ? OR g.reference_media_id = ?) ' +
						'ORDER BY g.created_at DESC, g.id DESC LIMIT ? OFFSET ?'
				)
				.bind(mediaId, mediaId, userId, mediaId, mediaId, limit, rawOffset)
				.all<ResourceGenerationRow>();
			return result.results ?? [];
		},
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
	project_count: number;
	session_count: number;
	generation_count: number;
	source_count: number;
	source_bytes: number | null;
	reference_count: number;
	reference_bytes: number | null;
	total_spend: number;
	latest_spend_at: number | null;
}

function toUserUsageRecord(row: UserUsageRow): UserUsageRecord {
	return {
		pubkey: row.pubkey,
		balance: row.balance,
		totalDeposit: 0,
		lastDepositAt: null,
		projectCount: row.project_count,
		sessionCount: row.session_count,
		generationCount: row.generation_count,
		sourceCount: row.source_count,
		sourceBytes: row.source_bytes,
		referenceCount: row.reference_count,
		referenceBytes: row.reference_bytes,
		totalSpend: row.total_spend,
		latestSpendAt: row.latest_spend_at
	};
}

// Each count is pre-aggregated per user in its own subquery, then LEFT JOINed
// onto `users` one-row-per-user — never a single flat multi-table LEFT JOIN,
// which would fan out across projects/sessions/generations/reference jobs and
// corrupt every COUNT/SUM here. `sourceCount` counts each distinct
// generations.source_media_id once per user, however many generations reused
// it. `referenceCount` counts each distinct (user, media) pair of
// reference_media_id across
// object_replacement_jobs, texture_replacement_jobs and generations
// (style-transfer references, migration 0019).
// `sourceBytes`/`referenceBytes` are storage totals: each distinct media counts
// once however often it is reused, and media whose size is unknown (NULL, rows
// from before sizes were recorded) contribute nothing. A user with no known
// size at all gets NULL rather than 0, so unknown is never shown as empty.
const REFERENCE_PAIRS_SQL =
	'SELECT user_id, reference_media_id FROM object_replacement_jobs ' +
	'UNION SELECT user_id, reference_media_id FROM texture_replacement_jobs ' +
	'UNION SELECT user_id, reference_media_id FROM generations WHERE reference_media_id IS NOT NULL';

export async function listUserUsage(
	db: D1Database,
	offset: number,
	size: number
): Promise<UserUsagePage> {
	const result = await db
		.prepare(
			'SELECT u.pubkey, COALESCE(c.balance, 0) AS balance, ' +
				'COALESCE(pr.project_count, 0) AS project_count, ' +
				'COALESCE(ps.session_count, 0) AS session_count, ' +
				'COALESCE(g.generation_count, 0) AS generation_count, ' +
				'COALESCE(g.source_count, 0) AS source_count, sb.source_bytes, ' +
				'COALESCE(refs.reference_count, 0) AS reference_count, refs.reference_bytes, ' +
				'COALESCE(g.total_spend, 0) AS total_spend, g.latest_spend_at ' +
				'FROM users u ' +
				'LEFT JOIN credits c ON c.user_id = u.id ' +
				'LEFT JOIN (SELECT user_id, COUNT(*) AS project_count FROM projects GROUP BY user_id) pr ' +
				'ON pr.user_id = u.id ' +
				'LEFT JOIN (SELECT p.user_id, COUNT(*) AS session_count FROM project_sessions s ' +
				'JOIN projects p ON p.id = s.project_id GROUP BY p.user_id) ps ON ps.user_id = u.id ' +
				'LEFT JOIN (SELECT user_id, COUNT(*) AS generation_count, ' +
				'COUNT(DISTINCT source_media_id) AS source_count, COALESCE(SUM(amount), 0) AS total_spend, ' +
				'MAX(created_at) AS latest_spend_at FROM generations GROUP BY user_id) g ' +
				'ON g.user_id = u.id ' +
				'LEFT JOIN (SELECT s.user_id, SUM(m.size) AS source_bytes FROM ' +
				'(SELECT DISTINCT user_id, source_media_id FROM generations) s ' +
				'JOIN media m ON m.id = s.source_media_id GROUP BY s.user_id) sb ON sb.user_id = u.id ' +
				'LEFT JOIN (SELECT r.user_id, COUNT(*) AS reference_count, SUM(m.size) AS reference_bytes FROM (' +
				REFERENCE_PAIRS_SQL +
				') r JOIN media m ON m.id = r.reference_media_id GROUP BY r.user_id) refs ' +
				'ON refs.user_id = u.id ' +
				'ORDER BY u.created_at DESC, u.id DESC LIMIT ? OFFSET ?'
		)
		.bind(size + 1, offset)
		.all<UserUsageRow>();
	const rows = result.results ?? [];
	return {
		users: rows.slice(0, size).map(toUserUsageRecord),
		hasMore: rows.length > size
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
}

// Platform-wide counterpart of listUserUsage: every figure follows the same
// per-user rules, so each total equals the sum of its column in the table.
export async function getUsageTotals(db: D1Database): Promise<UsageTotals> {
	const row = await db
		.prepare(
			'SELECT (SELECT COUNT(*) FROM users) AS user_count, ' +
				'(SELECT COUNT(*) FROM projects) AS project_count, ' +
				'(SELECT COUNT(*) FROM project_sessions) AS session_count, ' +
				'(SELECT COUNT(*) FROM generations) AS generation_count, ' +
				'(SELECT COUNT(*) FROM (SELECT DISTINCT user_id, source_media_id FROM generations ' +
				'WHERE user_id IS NOT NULL AND source_media_id IS NOT NULL)) AS source_count, ' +
				'(SELECT SUM(m.size) FROM (SELECT DISTINCT user_id, source_media_id FROM generations) s ' +
				'JOIN media m ON m.id = s.source_media_id) AS source_bytes, ' +
				'(SELECT COUNT(*) FROM (' +
				REFERENCE_PAIRS_SQL +
				') r JOIN media m ON m.id = r.reference_media_id) AS reference_count, ' +
				'(SELECT SUM(m.size) FROM (' +
				REFERENCE_PAIRS_SQL +
				') r JOIN media m ON m.id = r.reference_media_id) AS reference_bytes, ' +
				'(SELECT COALESCE(SUM(amount), 0) FROM generations) AS total_spend'
		)
		.first<UsageTotalsRow>();
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
		totalSpend: row.total_spend
	};
}

interface CreditTransactionRow {
	id: string;
	amount: number;
	balance_after: number;
	kind: string;
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

function toCreditTransaction(row: CreditTransactionRow): CreditTransaction | null {
	const kind = generationKindForRow(row.id, row.kind);
	if (kind === null) return null;
	return {
		id: row.id,
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
	db: D1Database,
	userId: string,
	limit = 50
): Promise<CreditTransaction[]> {
	// rowid as a tiebreaker: two deductions within the same millisecond would
	// otherwise sort arbitrarily on created_at alone. LEFT JOIN (not INNER):
	// generations.session_id is nullable at the DB level (migrations/0011), so
	// a row without one must still appear in the history, just without a
	// session/project to link it to.
	const { items } = await collectValidRows(
		async (chunkLimit, rawOffset) => {
			const { results } = await db
				.prepare(
					'SELECT g.id, g.amount, g.balance_after, g.kind, g.created_at, ' +
						'g.comfyui_upload_queue_sec, g.comfyui_queue_wait_sec, g.comfyui_execution_sec, ' +
						'g.comfyui_download_sec, g.comfyui_reupload_sec, ' +
						'g.archai_render_sec, g.archai_download_sec, g.archai_reupload_sec, ' +
						'g.session_id, ps.project_id FROM generations g ' +
						'LEFT JOIN project_sessions ps ON ps.id = g.session_id ' +
						'WHERE g.user_id = ? ORDER BY g.created_at DESC, g.rowid DESC LIMIT ? OFFSET ?'
				)
				.bind(userId, chunkLimit, rawOffset)
				.all<CreditTransactionRow>();
			return results ?? [];
		},
		toCreditTransaction,
		limit
	);
	return items.slice(0, limit);
}
