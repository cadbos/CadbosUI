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

import type { D1Database } from '@cloudflare/workers-types';
import type { GenerationKind } from '$lib/api/contract';
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
	url: string;
	source_url: string;
	kind: string;
	created_at: number;
	amount: number;
	balance_after: number;
}

function toSessionGeneration(row: SessionGenerationRow): SessionGeneration {
	return {
		id: row.id,
		url: row.url,
		sourceUrl: row.source_url,
		kind: generationKindForRow(row.id, row.kind),
		createdAt: row.created_at,
		amount: row.amount,
		balanceAfter: row.balance_after
	};
}

export async function createProject(
	db: D1Database,
	userId: string,
	title: string
): Promise<Project> {
	const now = Date.now();
	const id = crypto.randomUUID();
	await db
		.prepare(
			'INSERT INTO projects (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
		)
		.bind(id, userId, title, now, now)
		.run();
	return { id, userId, title, createdAt: now, updatedAt: now };
}

export async function listProjects(
	db: D1Database,
	userId: string,
	offset: number,
	size: number
): Promise<ProjectsPage> {
	const result = await db
		.prepare(
			'SELECT id, user_id, title, created_at, updated_at FROM projects ' +
				'WHERE user_id = ? AND archived_at IS NULL ORDER BY updated_at ASC, id ASC LIMIT ? OFFSET ?'
		)
		.bind(userId, size + 1, offset)
		.all<ProjectRow>();
	const rows = result.results ?? [];
	return {
		projects: rows.slice(0, size).map(toProject),
		hasMore: rows.length > size
	};
}

export async function renameProject(
	db: D1Database,
	userId: string,
	projectId: string,
	title: string
): Promise<Project | null> {
	const row = await db
		.prepare(
			'UPDATE projects SET title = ?, updated_at = ? ' +
				'WHERE id = ? AND user_id = ? AND archived_at IS NULL ' +
				'RETURNING id, user_id, title, created_at, updated_at'
		)
		.bind(title, Date.now(), projectId, userId)
		.first<ProjectRow>();
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
	db: D1Database,
	userId: string,
	projectId: string
): Promise<boolean> {
	const result = await db
		.prepare(
			'UPDATE projects SET archived_at = ? WHERE id = ? AND user_id = ? AND archived_at IS NULL'
		)
		.bind(Date.now(), projectId, userId)
		.run();
	return result.meta.changes === 1;
}

// Shared by getProjectDetail and getProjectDetailByShareToken — both need the
// same project's full session grid once ownership/token has already been
// resolved to a project row. Archived sessions are excluded the same way
// archived projects are excluded upstream — "deleted" from every view.
async function loadProjectDetail(db: D1Database, projectRow: ProjectRow): Promise<ProjectDetail> {
	const [sessionResult, shareResult] = await Promise.all([
		db
			.prepare(
				'SELECT id, project_id, title, parent_session_id, forked_from_generation_id, created_at, updated_at ' +
					'FROM project_sessions WHERE project_id = ? AND archived_at IS NULL ' +
					'ORDER BY updated_at ASC, id ASC'
			)
			.bind(projectRow.id)
			.all<ProjectSessionRow>(),
		db
			.prepare('SELECT 1 FROM project_shares WHERE project_id = ? AND revoked_at IS NULL')
			.bind(projectRow.id)
			.first()
	]);
	const sessionRows = sessionResult.results ?? [];

	// D1 caps bound parameters at 100 per query, so a project with a deep
	// session history is queried in chunks rather than one IN (...) with an
	// unbounded number of placeholders.
	const D1_MAX_BOUND_PARAMS = 100;
	const generationsBySession = new Map<string, SessionGeneration[]>();
	for (let offset = 0; offset < sessionRows.length; offset += D1_MAX_BOUND_PARAMS) {
		const chunk = sessionRows.slice(offset, offset + D1_MAX_BOUND_PARAMS);
		const placeholders = chunk.map(() => '?').join(', ');
		const generationRows =
			(
				await db
					.prepare(
						`SELECT id, session_id, url, source_url, kind, created_at, amount, balance_after ` +
							`FROM generations WHERE session_id IN (${placeholders}) ` +
							`ORDER BY created_at DESC, id DESC`
					)
					.bind(...chunk.map((session) => session.id))
					.all<SessionGenerationRow & { session_id: string }>()
			).results ?? [];
		for (const row of generationRows) {
			const bucket = generationsBySession.get(row.session_id) ?? [];
			bucket.push(toSessionGeneration(row));
			generationsBySession.set(row.session_id, bucket);
		}
	}

	return {
		...toProject(projectRow),
		shareActive: shareResult !== null,
		sessions: sessionRows.map((row) => ({
			...toProjectSession(row),
			generations: generationsBySession.get(row.id) ?? []
		}))
	};
}

// Null when the project doesn't exist, isn't owned by userId, or is archived —
// callers must not distinguish those cases in what they expose to the client.
export async function getProjectDetail(
	db: D1Database,
	userId: string,
	projectId: string
): Promise<ProjectDetail | null> {
	const projectRow = await db
		.prepare(
			'SELECT id, user_id, title, created_at, updated_at FROM projects ' +
				'WHERE id = ? AND user_id = ? AND archived_at IS NULL'
		)
		.bind(projectId, userId)
		.first<ProjectRow>();
	if (!projectRow) return null;

	return loadProjectDetail(db, projectRow);
}

// The public, unauthenticated share viewer's only lookup. Null when the token
// never existed, was revoked, or its project was archived — same
// no-enumeration-signal rule throughout: callers must not distinguish those.
export async function getProjectDetailByShareToken(
	db: D1Database,
	token: string
): Promise<ProjectDetail | null> {
	const projectRow = await db
		.prepare(
			'SELECT p.id, p.user_id, p.title, p.created_at, p.updated_at FROM project_shares ps ' +
				'JOIN projects p ON p.id = ps.project_id ' +
				'WHERE ps.token = ? AND ps.revoked_at IS NULL AND p.archived_at IS NULL'
		)
		.bind(token)
		.first<ProjectRow>();
	if (!projectRow) return null;

	return loadProjectDetail(db, projectRow);
}

// The IDOR guard every generation-writing route must call before attaching a
// generation/job to a client-supplied sessionId — a client can never make a
// generation land in a session it doesn't own. An archived session or project
// fails this the same as a foreign one — "deleted" means no new generations
// either, not just hidden from the list.
export async function assertSessionOwnedByUser(
	db: D1Database,
	userId: string,
	sessionId: string
): Promise<boolean> {
	const row = await db
		.prepare(
			'SELECT 1 FROM project_sessions ps JOIN projects p ON p.id = ps.project_id ' +
				'WHERE ps.id = ? AND p.user_id = ? AND ps.archived_at IS NULL AND p.archived_at IS NULL'
		)
		.bind(sessionId, userId)
		.first();
	return row !== null;
}

// Plain "new branch" — no fork lineage. Null when projectId isn't owned by userId
// or is archived.
export async function createSession(
	db: D1Database,
	userId: string,
	projectId: string,
	title: string
): Promise<ProjectSession | null> {
	const owned = await db
		.prepare('SELECT 1 FROM projects WHERE id = ? AND user_id = ? AND archived_at IS NULL')
		.bind(projectId, userId)
		.first();
	if (!owned) return null;

	const now = Date.now();
	const id = crypto.randomUUID();
	await db.batch([
		db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').bind(now, projectId),
		db
			.prepare(
				'INSERT INTO project_sessions (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
			)
			.bind(id, projectId, title, now, now)
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
	db: D1Database,
	userId: string,
	sessionId: string,
	title: string
): Promise<ProjectSession | null> {
	const row = await db
		.prepare(
			'UPDATE project_sessions SET title = ?, updated_at = ? ' +
				'WHERE id = ? AND archived_at IS NULL ' +
				'AND EXISTS (SELECT 1 FROM projects WHERE id = project_sessions.project_id ' +
				'AND user_id = ? AND archived_at IS NULL) ' +
				'RETURNING id, project_id, title, parent_session_id, forked_from_generation_id, created_at, updated_at'
		)
		.bind(title, Date.now(), sessionId, userId)
		.first<ProjectSessionRow>();
	return row ? toProjectSession(row) : null;
}

// Soft delete, same shape as archiveProject: hides the session from the project
// page without touching its generations. Same repeat-call behavior too —
// see archiveProject's own comment.
export async function archiveSession(
	db: D1Database,
	userId: string,
	sessionId: string
): Promise<boolean> {
	const result = await db
		.prepare(
			'UPDATE project_sessions SET archived_at = ? ' +
				'WHERE id = ? AND archived_at IS NULL ' +
				'AND EXISTS (SELECT 1 FROM projects WHERE id = project_sessions.project_id ' +
				'AND user_id = ? AND archived_at IS NULL)'
		)
		.bind(Date.now(), sessionId, userId)
		.run();
	return result.meta.changes === 1;
}

// Style-transfer's fork: branches a new session off parentSessionId at the exact
// point forkedFromGenerationId. Both the parent session and the forked-from
// generation must belong to userId's project and to each other (the generation
// must actually be a row of that session) — null on any mismatch, so a client can
// never fork into someone else's project by guessing ids.
export async function forkSession(
	db: D1Database,
	userId: string,
	parentSessionId: string,
	forkedFromGenerationId: string,
	title: string
): Promise<ProjectSession | null> {
	const parent = await db
		.prepare(
			'SELECT ps.project_id AS project_id FROM project_sessions ps ' +
				'JOIN projects p ON p.id = ps.project_id ' +
				'WHERE ps.id = ? AND p.user_id = ? AND ps.archived_at IS NULL AND p.archived_at IS NULL'
		)
		.bind(parentSessionId, userId)
		.first<{ project_id: string }>();
	if (!parent) return null;

	const generationBelongsToParent = await db
		.prepare('SELECT 1 FROM generations WHERE id = ? AND session_id = ?')
		.bind(forkedFromGenerationId, parentSessionId)
		.first();
	if (!generationBelongsToParent) return null;

	const now = Date.now();
	const id = crypto.randomUUID();
	await db.batch([
		db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').bind(now, parent.project_id),
		db
			.prepare(
				'INSERT INTO project_sessions ' +
					'(id, project_id, title, parent_session_id, forked_from_generation_id, created_at, updated_at) ' +
					'VALUES (?, ?, ?, ?, ?, ?, ?)'
			)
			.bind(id, parent.project_id, title, parentSessionId, forkedFromGenerationId, now, now)
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
	db: D1Database,
	userId: string,
	projectId: string
): Promise<string | null> {
	const owned = await db
		.prepare('SELECT 1 FROM projects WHERE id = ? AND user_id = ? AND archived_at IS NULL')
		.bind(projectId, userId)
		.first();
	if (!owned) return null;

	const now = Date.now();
	const token = randomToken();
	await db.batch([
		db
			.prepare(
				'UPDATE project_shares SET revoked_at = ? WHERE project_id = ? AND revoked_at IS NULL'
			)
			.bind(now, projectId),
		db
			.prepare('INSERT INTO project_shares (token, project_id, created_at) VALUES (?, ?, ?)')
			.bind(token, projectId, now)
	]);
	return token;
}

// Re-exposes whichever share token is currently active for the project, for
// the owner only — lets the project page recover its existing link after a
// reload instead of only offering "create new" (which would silently
// invalidate a link the owner already handed out). Null when the project
// isn't owned by userId or has no active link.
export async function getActiveShareToken(
	db: D1Database,
	userId: string,
	projectId: string
): Promise<string | null> {
	const row = await db
		.prepare(
			'SELECT ps.token FROM project_shares ps ' +
				'JOIN projects p ON p.id = ps.project_id ' +
				'WHERE ps.project_id = ? AND ps.revoked_at IS NULL ' +
				'AND p.user_id = ? AND p.archived_at IS NULL'
		)
		.bind(projectId, userId)
		.first<{ token: string }>();
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
	db: D1Database,
	userId: string,
	projectId: string
): Promise<boolean> {
	const result = await db
		.prepare(
			'UPDATE project_shares SET revoked_at = ? ' +
				'WHERE project_id = ? AND revoked_at IS NULL ' +
				'AND EXISTS (SELECT 1 FROM projects WHERE id = project_shares.project_id AND user_id = ?)'
		)
		.bind(Date.now(), projectId, userId)
		.run();
	return result.meta.changes === 1;
}
