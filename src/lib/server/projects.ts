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

// Project -> ProjectSession -> Generation repository (migrations/0011): a project
// groups a user's source photos/rooms, a session is one generation thread within a
// project (forked by style-transfer, continued in place by everything else). The
// table is named `project_sessions`, not `sessions` — that name is already taken by
// the auth session table (migrations/0001_auth.sql).
//
// Every function here takes the acting user's id and checks ownership itself
// (never trusts a caller-supplied project/session id on its own) — per
// cadbos-security, authorization for a specific resource belongs at the data
// layer, not the route.

import { sql } from 'drizzle-orm';
import type { GenerationKind } from '$lib/api/contract';
import type { Database } from '$lib/server/db';
import { mediaUrl } from '$lib/server/media';
import { randomToken } from './auth/session';
import { generationKindForRow } from './generations';

export interface Project {
	id: string;
	userId: string;
	title: string;
	createdAt: number;
	updatedAt: number;
}

export interface ProjectsPage {
	projects: Project[];
	hasMore: boolean;
}

export interface ProjectSession {
	id: string;
	projectId: string;
	title: string;
	parentSessionId: string | null;
	forkedFromGenerationId: string | null;
	createdAt: number;
	updatedAt: number;
}

export interface SessionGeneration {
	id: string;
	url: string;
	sourceUrl: string;
	kind: GenerationKind;
	createdAt: number;
	amount: number;
	balanceAfter: number;
}

export interface ProjectSessionDetail extends ProjectSession {
	generations: SessionGeneration[];
}

export interface ProjectDetail extends Project {
	sessions: ProjectSessionDetail[];
	// Whether the project currently has an active (non-revoked) share link —
	// never the token itself, which is only ever returned once, at issuance
	// (issueShareToken). Lets the project page show share status on reload
	// without being able to re-display a token it never stored.
	shareActive: boolean;
}

interface ProjectRow {
	id: string;
	user_id: string;
	title: string;
	created_at: number;
	updated_at: number;
}

function toProject(row: ProjectRow): Project {
	return {
		id: row.id,
		userId: row.user_id,
		title: row.title,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

interface ProjectSessionRow {
	id: string;
	project_id: string;
	title: string;
	parent_session_id: string | null;
	forked_from_generation_id: string | null;
	created_at: number;
	updated_at: number;
}

function toProjectSession(row: ProjectSessionRow): ProjectSession {
	return {
		id: row.id,
		projectId: row.project_id,
		title: row.title,
		parentSessionId: row.parent_session_id,
		forkedFromGenerationId: row.forked_from_generation_id,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

interface SessionGenerationRow {
	id: string;
	result_filename: string;
	result_bucket_url: string;
	source_filename: string;
	source_bucket_url: string;
	kind: string;
	created_at: number;
	amount: number;
	balance_after: number;
}

function toSessionGeneration(row: SessionGenerationRow): SessionGeneration {
	return {
		id: row.id,
		url: mediaUrl(row.result_bucket_url, row.result_filename),
		sourceUrl: mediaUrl(row.source_bucket_url, row.source_filename),
		kind: generationKindForRow(row.id, row.kind),
		createdAt: row.created_at,
		amount: row.amount,
		balanceAfter: row.balance_after
	};
}

export async function createProject(db: Database, userId: string, title: string): Promise<Project> {
	const now = Date.now();
	const id = crypto.randomUUID();
	await db.run(
		sql`INSERT INTO projects (id, user_id, title, created_at, updated_at) VALUES (${id}, ${userId}, ${title}, ${now}, ${now})`
	);
	return { id, userId, title, createdAt: now, updatedAt: now };
}

export async function listProjects(
	db: Database,
	userId: string,
	offset: number,
	size: number
): Promise<ProjectsPage> {
	const rows = await db.all<ProjectRow>(
		sql`SELECT id, user_id, title, created_at, updated_at FROM projects
			WHERE user_id = ${userId} AND archived_at IS NULL ORDER BY updated_at ASC, id ASC LIMIT ${size + 1} OFFSET ${offset}`
	);
	return {
		projects: rows.slice(0, size).map(toProject),
		hasMore: rows.length > size
	};
}

export async function renameProject(
	db: Database,
	userId: string,
	projectId: string,
	title: string
): Promise<Project | null> {
	const row = await db.get<ProjectRow>(
		sql`UPDATE projects SET title = ${title}, updated_at = ${Date.now()}
			WHERE id = ${projectId} AND user_id = ${userId} AND archived_at IS NULL
			RETURNING id, user_id, title, created_at, updated_at`
	);
	return row ? toProject(row) : null;
}

// Soft delete: hides the project from listProjects/getProjectDetail and stops its
// share link from resolving (loadProjectDetail/getProjectDetailByShareToken both
// filter on archived_at), but keeps every row underneath intact — generations are
// real billed history, never destroyed by tidying up a project list. No restore UI
// in v1 (see migrations/0012_project_archive.sql). Safe to call again on an
// already-archived or foreign project — never throws, just reports whether *this*
// call changed anything (result.meta.changes). That return value isn't itself
// idempotent (true, then false on repeats) — the DELETE route turns a false into
// a 404, so repeating the call isn't idempotent from the client's own view either.
export async function archiveProject(
	db: Database,
	userId: string,
	projectId: string
): Promise<boolean> {
	const result = await db.run(
		sql`UPDATE projects SET archived_at = ${Date.now()} WHERE id = ${projectId} AND user_id = ${userId} AND archived_at IS NULL`
	);
	return result.meta.changes === 1;
}

// Shared by getProjectDetail and getProjectDetailByShareToken — both need the
// same project's full session grid once ownership/token has already been
// resolved to a project row. Archived sessions are excluded the same way
// archived projects are excluded upstream — "deleted" from every view.
async function loadProjectDetail(db: Database, projectRow: ProjectRow): Promise<ProjectDetail> {
	const [sessionRows, shareResult] = await Promise.all([
		db.all<ProjectSessionRow>(
			sql`SELECT id, project_id, title, parent_session_id, forked_from_generation_id, created_at, updated_at
				FROM project_sessions WHERE project_id = ${projectRow.id} AND archived_at IS NULL
				ORDER BY updated_at ASC, id ASC`
		),
		db.get(
			sql`SELECT 1 FROM project_shares WHERE project_id = ${projectRow.id} AND revoked_at IS NULL`
		)
	]);

	// D1 caps bound parameters at 100 per query, so a project with a deep
	// session history is queried in chunks rather than one IN (...) with an
	// unbounded number of placeholders.
	const D1_MAX_BOUND_PARAMS = 100;
	const generationsBySession = new Map<string, SessionGeneration[]>();
	for (let offset = 0; offset < sessionRows.length; offset += D1_MAX_BOUND_PARAMS) {
		const chunk = sessionRows.slice(offset, offset + D1_MAX_BOUND_PARAMS);
		const sessionIds = sql.join(
			chunk.map((session) => sql`${session.id}`),
			sql`, `
		);
		const generationRows = await db.all<SessionGenerationRow & { session_id: string }>(
			sql`SELECT g.id, g.session_id, result_media.filename AS result_filename,
				result_bucket.url AS result_bucket_url, source_media.filename AS source_filename,
				source_bucket.url AS source_bucket_url, g.kind, g.created_at, g.amount, g.balance_after
				FROM generations g JOIN media result_media ON result_media.id = g.result_media_id
				JOIN buckets result_bucket ON result_bucket.id = result_media.bucket
				JOIN media source_media ON source_media.id = g.source_media_id
				JOIN buckets source_bucket ON source_bucket.id = source_media.bucket
				WHERE g.session_id IN (${sessionIds}) ORDER BY g.created_at DESC, g.id DESC`
		);
		for (const row of generationRows) {
			const bucket = generationsBySession.get(row.session_id) ?? [];
			bucket.push(toSessionGeneration(row));
			generationsBySession.set(row.session_id, bucket);
		}
	}

	return {
		...toProject(projectRow),
		shareActive: shareResult !== undefined,
		sessions: sessionRows.map((row) => ({
			...toProjectSession(row),
			generations: generationsBySession.get(row.id) ?? []
		}))
	};
}

// Null when the project doesn't exist, isn't owned by userId, or is archived —
// callers must not distinguish those cases in what they expose to the client.
export async function getProjectDetail(
	db: Database,
	userId: string,
	projectId: string
): Promise<ProjectDetail | null> {
	const projectRow = await db.get<ProjectRow>(
		sql`SELECT id, user_id, title, created_at, updated_at FROM projects
			WHERE id = ${projectId} AND user_id = ${userId} AND archived_at IS NULL`
	);
	if (!projectRow) return null;

	return loadProjectDetail(db, projectRow);
}

// The public, unauthenticated share viewer's only lookup. Null when the token
// never existed, was revoked, or its project was archived — same
// no-enumeration-signal rule throughout: callers must not distinguish those.
export async function getProjectDetailByShareToken(
	db: Database,
	token: string
): Promise<ProjectDetail | null> {
	const projectRow = await db.get<ProjectRow>(
		sql`SELECT p.id, p.user_id, p.title, p.created_at, p.updated_at FROM project_shares ps
			JOIN projects p ON p.id = ps.project_id
			WHERE ps.token = ${token} AND ps.revoked_at IS NULL AND p.archived_at IS NULL`
	);
	if (!projectRow) return null;

	return loadProjectDetail(db, projectRow);
}

// The IDOR guard every generation-writing route must call before attaching a
// generation/job to a client-supplied sessionId — a client can never make a
// generation land in a session it doesn't own. An archived session or project
// fails this the same as a foreign one — "deleted" means no new generations
// either, not just hidden from the list.
export async function assertSessionOwnedByUser(
	db: Database,
	userId: string,
	sessionId: string
): Promise<boolean> {
	const row = await db.get(
		sql`SELECT 1 FROM project_sessions ps JOIN projects p ON p.id = ps.project_id
			WHERE ps.id = ${sessionId} AND p.user_id = ${userId} AND ps.archived_at IS NULL AND p.archived_at IS NULL`
	);
	return row !== undefined;
}

// Plain "new branch" — no fork lineage. Null when projectId isn't owned by userId
// or is archived.
export async function createSession(
	db: Database,
	userId: string,
	projectId: string,
	title: string
): Promise<ProjectSession | null> {
	const owned = await db.get(
		sql`SELECT 1 FROM projects WHERE id = ${projectId} AND user_id = ${userId} AND archived_at IS NULL`
	);
	if (!owned) return null;

	const now = Date.now();
	const id = crypto.randomUUID();
	await db.batch([
		db.run(sql`UPDATE projects SET updated_at = ${now} WHERE id = ${projectId}`),
		db.run(
			sql`INSERT INTO project_sessions (id, project_id, title, created_at, updated_at) VALUES (${id}, ${projectId}, ${title}, ${now}, ${now})`
		)
	]);
	return {
		id,
		projectId,
		title,
		parentSessionId: null,
		forkedFromGenerationId: null,
		createdAt: now,
		updatedAt: now
	};
}

// Renames only when owned and not archived. Null otherwise.
export async function renameSession(
	db: Database,
	userId: string,
	sessionId: string,
	title: string
): Promise<ProjectSession | null> {
	const row = await db.get<ProjectSessionRow>(
		sql`UPDATE project_sessions SET title = ${title}, updated_at = ${Date.now()}
			WHERE id = ${sessionId} AND archived_at IS NULL
			AND EXISTS (SELECT 1 FROM projects WHERE id = project_sessions.project_id
			AND user_id = ${userId} AND archived_at IS NULL)
			RETURNING id, project_id, title, parent_session_id, forked_from_generation_id, created_at, updated_at`
	);
	return row ? toProjectSession(row) : null;
}

// Soft delete, same shape as archiveProject: hides the session from the project
// page without touching its generations. Same repeat-call behavior too —
// see archiveProject's own comment.
export async function archiveSession(
	db: Database,
	userId: string,
	sessionId: string
): Promise<boolean> {
	const result = await db.run(
		sql`UPDATE project_sessions SET archived_at = ${Date.now()}
			WHERE id = ${sessionId} AND archived_at IS NULL
			AND EXISTS (SELECT 1 FROM projects WHERE id = project_sessions.project_id
			AND user_id = ${userId} AND archived_at IS NULL)`
	);
	return result.meta.changes === 1;
}

// Style-transfer's fork: branches a new session off parentSessionId at the exact
// point forkedFromGenerationId. Both the parent session and the forked-from
// generation must belong to userId's project and to each other (the generation
// must actually be a row of that session) — null on any mismatch, so a client can
// never fork into someone else's project by guessing ids.
export async function forkSession(
	db: Database,
	userId: string,
	parentSessionId: string,
	forkedFromGenerationId: string,
	title: string
): Promise<ProjectSession | null> {
	const parent = await db.get<{ project_id: string }>(
		sql`SELECT ps.project_id AS project_id FROM project_sessions ps
			JOIN projects p ON p.id = ps.project_id
			WHERE ps.id = ${parentSessionId} AND p.user_id = ${userId} AND ps.archived_at IS NULL AND p.archived_at IS NULL`
	);
	if (!parent) return null;

	const generationBelongsToParent = await db.get(
		sql`SELECT 1 FROM generations WHERE id = ${forkedFromGenerationId} AND session_id = ${parentSessionId}`
	);
	if (!generationBelongsToParent) return null;

	const now = Date.now();
	const id = crypto.randomUUID();
	await db.batch([
		db.run(sql`UPDATE projects SET updated_at = ${now} WHERE id = ${parent.project_id}`),
		db.run(
			sql`INSERT INTO project_sessions
				(id, project_id, title, parent_session_id, forked_from_generation_id, created_at, updated_at)
				VALUES (${id}, ${parent.project_id}, ${title}, ${parentSessionId}, ${forkedFromGenerationId}, ${now}, ${now})`
		)
	]);
	return {
		id,
		projectId: parent.project_id,
		title,
		parentSessionId,
		forkedFromGenerationId,
		createdAt: now,
		updatedAt: now
	};
}

// Issuing a new link auto-revokes the project's prior active one — one active
// share link per project at a time. Null when projectId isn't owned by userId.
export async function issueShareToken(
	db: Database,
	userId: string,
	projectId: string
): Promise<string | null> {
	const owned = await db.get(
		sql`SELECT 1 FROM projects WHERE id = ${projectId} AND user_id = ${userId} AND archived_at IS NULL`
	);
	if (!owned) return null;

	const now = Date.now();
	const token = randomToken();
	await db.batch([
		db.run(
			sql`UPDATE project_shares SET revoked_at = ${now} WHERE project_id = ${projectId} AND revoked_at IS NULL`
		),
		db.run(
			sql`INSERT INTO project_shares (token, project_id, created_at) VALUES (${token}, ${projectId}, ${now})`
		)
	]);
	return token;
}

// Re-exposes whichever share token is currently active for the project, for
// the owner only — lets the project page recover its existing link after a
// reload instead of only offering "create new" (which would silently
// invalidate a link the owner already handed out). Null when the project
// isn't owned by userId or has no active link.
export async function getActiveShareToken(
	db: Database,
	userId: string,
	projectId: string
): Promise<string | null> {
	const row = await db.get<{ token: string }>(
		sql`SELECT ps.token FROM project_shares ps
			JOIN projects p ON p.id = ps.project_id
			WHERE ps.project_id = ${projectId} AND ps.revoked_at IS NULL
			AND p.user_id = ${userId} AND p.archived_at IS NULL`
	);
	return row?.token ?? null;
}

// Revokes whichever share token is currently active for the project — the
// caller never needs to pass the token value itself, just the project id
// (see getActiveShareToken for recovering the value instead). Ownership and
// revocation happen in the same statement (an EXISTS subquery against
// projects) so there's no window between checking ownership and revoking.
// Safe to call again with no active token to revoke — never throws, just
// returns whether this call itself changed anything (true, then false on
// repeats); the DELETE route turns a false into a 404, same as archiveProject.
export async function revokeActiveShareToken(
	db: Database,
	userId: string,
	projectId: string
): Promise<boolean> {
	const result = await db.run(
		sql`UPDATE project_shares SET revoked_at = ${Date.now()}
			WHERE project_id = ${projectId} AND revoked_at IS NULL
			AND EXISTS (SELECT 1 FROM projects WHERE id = project_shares.project_id AND user_id = ${userId})`
	);
	return result.meta.changes === 1;
}
