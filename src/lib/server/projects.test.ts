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

import { beforeEach, describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { makeD1 } from './testing/d1-shim';
import {
	archiveProject,
	archiveSession,
	assertSessionOwnedByUser,
	createProject,
	createSession,
	forkSession,
	getProjectDetail,
	getProjectDetailByShareToken,
	issueShareToken,
	listProjects,
	renameProject,
	renameSession,
	revokeActiveShareToken
} from './projects';

function seedUser(db: D1Database, id: string, pubkey: string): void {
	db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind(id, pubkey, Date.now())
		.run();
}

function seedGeneration(
	db: D1Database,
	id: string,
	userId: string,
	sessionId: string,
	createdAt: number
): void {
	db.prepare(
		'INSERT INTO generations ' +
			'(id, user_id, url, source_url, prompt, kind, amount, balance_after, created_at, session_id) ' +
			"VALUES (?, ?, ?, 'https://cdn.example.test/source.jpg', 'cozy', 'render', 1, 10, ?, ?)"
	)
		.bind(id, userId, `https://cdn.example.test/${id}.webp`, createdAt, sessionId)
		.run();
}

describe('projects repository', () => {
	let db: D1Database;

	beforeEach(() => {
		db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');
		seedUser(db, 'user-2', 'pubkey-2');
	});

	it("lists only the caller's own projects", async () => {
		const first = await createProject(db, 'user-1', 'Living room');
		const second = await createProject(db, 'user-1', 'Kitchen');
		await createProject(db, 'user-2', "Someone else's project");

		const page = await listProjects(db, 'user-1', 0, 10);
		expect(new Set(page.projects.map((project) => project.id))).toEqual(
			new Set([first.id, second.id])
		);
		expect(page.hasMore).toBe(false);
	});

	it('paginates with hasMore', async () => {
		for (let i = 0; i < 3; i += 1) {
			await createProject(db, 'user-1', `Project ${i}`);
		}

		const page = await listProjects(db, 'user-1', 0, 2);
		expect(page.projects).toHaveLength(2);
		expect(page.hasMore).toBe(true);
	});

	it('renames only when owned, returns null otherwise', async () => {
		const project = await createProject(db, 'user-1', 'Living room');

		const renamed = await renameProject(db, 'user-1', project.id, 'New title');
		expect(renamed?.title).toBe('New title');

		const rejected = await renameProject(db, 'user-2', project.id, 'Hijacked');
		expect(rejected).toBeNull();
	});

	it('returns project detail with sessions and their generations, null when not owned', async () => {
		const project = await createProject(db, 'user-1', 'Living room');
		const session = await createSession(db, 'user-1', project.id, 'Main thread');
		expect(session).not.toBeNull();
		seedGeneration(db, 'gen-1', 'user-1', session!.id, Date.now());

		const detail = await getProjectDetail(db, 'user-1', project.id);
		expect(detail?.sessions).toHaveLength(1);
		expect(detail?.sessions[0]?.generations.map((generation) => generation.id)).toEqual(['gen-1']);
		// Needed to reconstruct a past generation's cost/balance when the
		// workspace opens it from an expenses-page click (see
		// workspace-tabs.svelte.ts's initializeGenerationPreview).
		expect(detail?.sessions[0]?.generations[0]).toEqual(
			expect.objectContaining({ amount: 1, balanceAfter: 10 })
		);

		const denied = await getProjectDetail(db, 'user-2', project.id);
		expect(denied).toBeNull();
	});

	it('attaches generations correctly for a project past the D1 100-param IN-clause limit', async () => {
		const project = await createProject(db, 'user-1', 'Living room');
		const sessionIds: string[] = [];
		for (let i = 0; i < 150; i++) {
			const session = await createSession(db, 'user-1', project.id, `Session ${i}`);
			expect(session).not.toBeNull();
			sessionIds.push(session!.id);
			seedGeneration(db, `gen-${i}`, 'user-1', session!.id, Date.now());
		}

		const detail = await getProjectDetail(db, 'user-1', project.id);
		expect(detail?.sessions).toHaveLength(150);
		for (const session of detail!.sessions) {
			const index = sessionIds.indexOf(session.id);
			expect(session.generations.map((generation) => generation.id)).toEqual([`gen-${index}`]);
		}
	});

	it('does not create a session in a project the caller does not own', async () => {
		const project = await createProject(db, 'user-1', 'Living room');

		const session = await createSession(db, 'user-2', project.id, 'Hijacked');
		expect(session).toBeNull();
	});

	it('forks a new session with lineage, and rejects a generation that is not the parent’s own', async () => {
		const project = await createProject(db, 'user-1', 'Living room');
		const parent = await createSession(db, 'user-1', project.id, 'Main thread');
		seedGeneration(db, 'gen-1', 'user-1', parent!.id, Date.now());

		const forked = await forkSession(db, 'user-1', parent!.id, 'gen-1', 'Style B');
		expect(forked?.parentSessionId).toBe(parent!.id);
		expect(forked?.forkedFromGenerationId).toBe('gen-1');

		const otherProject = await createProject(db, 'user-1', 'Bedroom');
		const otherSession = await createSession(db, 'user-1', otherProject.id, 'Other thread');
		seedGeneration(db, 'gen-2', 'user-1', otherSession!.id, Date.now());

		const mismatched = await forkSession(db, 'user-1', parent!.id, 'gen-2', 'Bad fork');
		expect(mismatched).toBeNull();

		const notOwned = await forkSession(db, 'user-2', parent!.id, 'gen-1', 'Stolen fork');
		expect(notOwned).toBeNull();
	});

	it('issues a share token, auto-revokes the prior one, and never distinguishes revoked from nonexistent', async () => {
		const project = await createProject(db, 'user-1', 'Living room');

		const firstToken = await issueShareToken(db, 'user-1', project.id);
		expect(firstToken).not.toBeNull();
		expect(await getProjectDetailByShareToken(db, firstToken!)).not.toBeNull();

		const secondToken = await issueShareToken(db, 'user-1', project.id);
		expect(secondToken).not.toBe(firstToken);
		expect(await getProjectDetailByShareToken(db, firstToken!)).toBeNull();
		expect(await getProjectDetailByShareToken(db, secondToken!)).not.toBeNull();

		expect(await getProjectDetailByShareToken(db, 'never-issued')).toBeNull();
		expect(await issueShareToken(db, 'user-2', project.id)).toBeNull();
	});

	it('revoke is idempotent and ownership-checked', async () => {
		const project = await createProject(db, 'user-1', 'Living room');
		const token = await issueShareToken(db, 'user-1', project.id);

		const stolenRevoke = await revokeActiveShareToken(db, 'user-2', project.id);
		expect(stolenRevoke).toBe(false);
		expect(await getProjectDetailByShareToken(db, token!)).not.toBeNull();

		const firstRevoke = await revokeActiveShareToken(db, 'user-1', project.id);
		expect(firstRevoke).toBe(true);
		expect(await getProjectDetailByShareToken(db, token!)).toBeNull();

		const secondRevoke = await revokeActiveShareToken(db, 'user-1', project.id);
		expect(secondRevoke).toBe(false);
	});

	it('assertSessionOwnedByUser — the IDOR guard every generation route calls — rejects a foreign or unknown session', async () => {
		const project = await createProject(db, 'user-1', 'Living room');
		const session = await createSession(db, 'user-1', project.id, 'Main thread');

		expect(await assertSessionOwnedByUser(db, 'user-1', session!.id)).toBe(true);
		expect(await assertSessionOwnedByUser(db, 'user-2', session!.id)).toBe(false);
		expect(await assertSessionOwnedByUser(db, 'user-1', 'never-issued-session-id')).toBe(false);
	});

	it('exposes a project detail by valid share token, and nothing for revoked/unknown tokens', async () => {
		const project = await createProject(db, 'user-1', 'Living room');
		const session = await createSession(db, 'user-1', project.id, 'Main thread');
		seedGeneration(db, 'gen-1', 'user-1', session!.id, Date.now());
		const token = await issueShareToken(db, 'user-1', project.id);

		const detail = await getProjectDetailByShareToken(db, token!);
		expect(detail?.id).toBe(project.id);
		expect(detail?.sessions[0]?.generations.map((generation) => generation.id)).toEqual(['gen-1']);

		expect(await getProjectDetailByShareToken(db, 'never-issued')).toBeNull();

		await revokeActiveShareToken(db, 'user-1', project.id);
		expect(await getProjectDetailByShareToken(db, token!)).toBeNull();
	});

	it('project detail reports whether an active share link exists, without ever exposing the token', async () => {
		const project = await createProject(db, 'user-1', 'Living room');

		const beforeShare = await getProjectDetail(db, 'user-1', project.id);
		expect(beforeShare?.shareActive).toBe(false);

		const token = await issueShareToken(db, 'user-1', project.id);
		const afterShare = await getProjectDetail(db, 'user-1', project.id);
		expect(afterShare?.shareActive).toBe(true);
		expect(JSON.stringify(afterShare)).not.toContain(token);

		await revokeActiveShareToken(db, 'user-1', project.id);
		const afterRevoke = await getProjectDetail(db, 'user-1', project.id);
		expect(afterRevoke?.shareActive).toBe(false);
	});

	it('renames a session only when owned and not archived', async () => {
		const project = await createProject(db, 'user-1', 'Living room');
		const session = await createSession(db, 'user-1', project.id, 'Main thread');

		const renamed = await renameSession(db, 'user-1', session!.id, 'Cozy corner');
		expect(renamed?.title).toBe('Cozy corner');

		expect(await renameSession(db, 'user-2', session!.id, 'Hijacked')).toBeNull();
	});

	it('archives a project — hides it from listing/detail/share, keeps generations intact, idempotent', async () => {
		const project = await createProject(db, 'user-1', 'Living room');
		const session = await createSession(db, 'user-1', project.id, 'Main thread');
		seedGeneration(db, 'gen-1', 'user-1', session!.id, Date.now());
		const token = await issueShareToken(db, 'user-1', project.id);

		expect(await archiveProject(db, 'user-2', project.id)).toBe(false);
		expect(await archiveProject(db, 'user-1', project.id)).toBe(true);

		expect(await getProjectDetail(db, 'user-1', project.id)).toBeNull();
		expect((await listProjects(db, 'user-1', 0, 10)).projects).toHaveLength(0);
		expect(await getProjectDetailByShareToken(db, token!)).toBeNull();
		expect(await assertSessionOwnedByUser(db, 'user-1', session!.id)).toBe(false);
		expect(await createSession(db, 'user-1', project.id, 'New thread')).toBeNull();

		const generation = await db
			.prepare('SELECT id FROM generations WHERE id = ?')
			.bind('gen-1')
			.first();
		expect(generation).not.toBeNull();

		expect(await archiveProject(db, 'user-1', project.id)).toBe(false);
	});

	it('archives a session — hides it from the project detail, keeps its generations, idempotent', async () => {
		const project = await createProject(db, 'user-1', 'Living room');
		const session = await createSession(db, 'user-1', project.id, 'Main thread');
		seedGeneration(db, 'gen-1', 'user-1', session!.id, Date.now());

		expect(await archiveSession(db, 'user-2', session!.id)).toBe(false);
		expect(await archiveSession(db, 'user-1', session!.id)).toBe(true);

		const detail = await getProjectDetail(db, 'user-1', project.id);
		expect(detail?.sessions).toHaveLength(0);
		expect(await assertSessionOwnedByUser(db, 'user-1', session!.id)).toBe(false);

		const generation = await db
			.prepare('SELECT id FROM generations WHERE id = ?')
			.bind('gen-1')
			.first();
		expect(generation).not.toBeNull();

		expect(await archiveSession(db, 'user-1', session!.id)).toBe(false);
	});
});
