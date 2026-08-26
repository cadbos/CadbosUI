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

import { describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import type {
	CreateSessionResponse,
	ForkSessionResponse,
	ProjectDetailResponse,
	ProjectRecord,
	ProjectsResponse,
	RenameSessionResponse,
	ShareTokenResponse
} from '$lib/api/contract';
import { getProjectDetailByShareToken } from '$lib/server/projects';
import { makeD1 } from '$lib/server/testing/d1-shim';
import { seedGeneration as seedGenerationFixture } from '$lib/server/testing/generation-fixtures';

const { GET: listProjects, POST: createProject } = await import('./+server');
const {
	GET: getProject,
	PATCH: renameProject,
	DELETE: deleteProject
} = await import('./[id]/+server');
const { POST: createSession } = await import('./[id]/sessions/+server');
const { PATCH: renameSession, DELETE: deleteSession } =
	await import('./[id]/sessions/[sessionId]/+server');
const { POST: forkSession } = await import('./[id]/sessions/[sessionId]/fork/+server');
const {
	GET: getShare,
	POST: issueShare,
	DELETE: revokeShare
} = await import('./[id]/share/+server');

function seedUser(db: D1Database, id: string, pubkey: string): void {
	db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind(id, pubkey, Date.now())
		.run();
}

function seedGeneration(db: D1Database, id: string, sessionId: string, userId: string): void {
	seedGenerationFixture(db, {
		id,
		userId,
		url: 'https://cdn.example.test/out.webp',
		sourceUrl: 'https://cdn.example.test/room.jpg',
		createdAt: Date.now(),
		sessionId
	});
}

function platform(db: D1Database): App.Platform {
	return { env: { DB: db } } as unknown as App.Platform;
}

const owner = { pubkey: 'pubkey-1' };
const intruder = { pubkey: 'pubkey-2' };

async function seedTwoUsers(db: D1Database): Promise<void> {
	seedUser(db, 'user-1', owner.pubkey);
	seedUser(db, 'user-2', intruder.pubkey);
}

describe('POST /api/projects', () => {
	it('rejects unauthenticated requests', async () => {
		const response = await createProject({
			request: new Request('https://cadbos.example/api/projects', {
				method: 'POST',
				body: JSON.stringify({ title: 'Living room' })
			}),
			platform: platform(makeD1()),
			locals: { user: null }
		} as Parameters<typeof createProject>[0]);
		expect(response.status).toBe(401);
	});

	it('creates a project owned by the authenticated user', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', owner.pubkey);

		const response = await createProject({
			request: new Request('https://cadbos.example/api/projects', {
				method: 'POST',
				body: JSON.stringify({ title: 'Living room' })
			}),
			platform: platform(db),
			locals: { user: owner }
		} as Parameters<typeof createProject>[0]);

		expect(response.status).toBe(201);
		const project = (await response.json()) as ProjectRecord;
		expect(project.title).toBe('Living room');

		const row = await db
			.prepare('SELECT user_id FROM projects WHERE id = ?')
			.bind(project.id)
			.first<{ user_id: string }>();
		expect(row?.user_id).toBe('user-1');
	});
});

describe('GET /api/projects', () => {
	it("lists only the caller's own projects, paginated", async () => {
		const db = makeD1();
		await seedTwoUsers(db);
		for (let i = 0; i < 3; i += 1) {
			await createProject({
				request: new Request('https://cadbos.example/api/projects', {
					method: 'POST',
					body: JSON.stringify({ title: `Project ${i}` })
				}),
				platform: platform(db),
				locals: { user: owner }
			} as Parameters<typeof createProject>[0]);
		}
		await createProject({
			request: new Request('https://cadbos.example/api/projects', {
				method: 'POST',
				body: JSON.stringify({ title: "Intruder's project" })
			}),
			platform: platform(db),
			locals: { user: intruder }
		} as Parameters<typeof createProject>[0]);

		const response = await listProjects({
			url: new URL('https://cadbos.example/api/projects?offset=0&size=2'),
			platform: platform(db),
			locals: { user: owner }
		} as Parameters<typeof listProjects>[0]);

		expect(response.status).toBe(200);
		const result = (await response.json()) as ProjectsResponse;
		expect(result.projects).toHaveLength(2);
		expect(result.pagination).toEqual({ offset: 0, size: 2, hasMore: true });
	});
});

describe('GET /api/projects/[id]', () => {
	it('returns sessions and their generations, 404 for another user', async () => {
		const db = makeD1();
		await seedTwoUsers(db);
		const createResponse = await createProject({
			request: new Request('https://cadbos.example/api/projects', {
				method: 'POST',
				body: JSON.stringify({ title: 'Living room' })
			}),
			platform: platform(db),
			locals: { user: owner }
		} as Parameters<typeof createProject>[0]);
		const project = (await createResponse.json()) as ProjectRecord;

		const sessionResponse = await createSession({
			request: new Request('https://cadbos.example/api/projects/x/sessions', {
				method: 'POST',
				body: JSON.stringify({ title: 'Main thread' })
			}),
			params: { id: project.id },
			platform: platform(db),
			locals: { user: owner }
		} as Parameters<typeof createSession>[0]);
		const session = (await sessionResponse.json()) as CreateSessionResponse;
		seedGeneration(db, '00000000-0000-4000-8000-000000000101', session.id, 'user-1');

		const detailResponse = await getProject({
			params: { id: project.id },
			platform: platform(db),
			locals: { user: owner }
		} as Parameters<typeof getProject>[0]);
		expect(detailResponse.status).toBe(200);
		const detail = (await detailResponse.json()) as ProjectDetailResponse;
		expect(detail.sessions).toHaveLength(1);
		expect(detail.shareActive).toBe(false);
		expect(detail.sessions[0]?.generations.map((generation) => generation.id)).toEqual([
			'00000000-0000-4000-8000-000000000101'
		]);

		const denied = await getProject({
			params: { id: project.id },
			platform: platform(db),
			locals: { user: intruder }
		} as Parameters<typeof getProject>[0]);
		expect(denied.status).toBe(404);
	});
});

describe('PATCH /api/projects/[id]', () => {
	it('renames only when owned', async () => {
		const db = makeD1();
		await seedTwoUsers(db);
		const createResponse = await createProject({
			request: new Request('https://cadbos.example/api/projects', {
				method: 'POST',
				body: JSON.stringify({ title: 'Living room' })
			}),
			platform: platform(db),
			locals: { user: owner }
		} as Parameters<typeof createProject>[0]);
		const project = (await createResponse.json()) as ProjectRecord;

		const denied = await renameProject({
			request: new Request('https://cadbos.example/api/projects/x', {
				method: 'PATCH',
				body: JSON.stringify({ title: 'Hijacked' })
			}),
			params: { id: project.id },
			platform: platform(db),
			locals: { user: intruder }
		} as Parameters<typeof renameProject>[0]);
		expect(denied.status).toBe(404);

		const renamed = await renameProject({
			request: new Request('https://cadbos.example/api/projects/x', {
				method: 'PATCH',
				body: JSON.stringify({ title: 'New title' })
			}),
			params: { id: project.id },
			platform: platform(db),
			locals: { user: owner }
		} as Parameters<typeof renameProject>[0]);
		expect(renamed.status).toBe(200);
		expect(((await renamed.json()) as ProjectRecord).title).toBe('New title');
	});
});

describe('POST /api/projects/[id]/sessions', () => {
	it('rejects creating a session in a project the caller does not own', async () => {
		const db = makeD1();
		await seedTwoUsers(db);
		const createResponse = await createProject({
			request: new Request('https://cadbos.example/api/projects', {
				method: 'POST',
				body: JSON.stringify({ title: 'Living room' })
			}),
			platform: platform(db),
			locals: { user: owner }
		} as Parameters<typeof createProject>[0]);
		const project = (await createResponse.json()) as ProjectRecord;

		const response = await createSession({
			request: new Request('https://cadbos.example/api/projects/x/sessions', {
				method: 'POST',
				body: JSON.stringify({ title: 'Hijacked' })
			}),
			params: { id: project.id },
			platform: platform(db),
			locals: { user: intruder }
		} as Parameters<typeof createSession>[0]);
		expect(response.status).toBe(404);
	});
});

describe('POST /api/projects/[id]/sessions/[sessionId]/fork', () => {
	it('forks with lineage, rejects a generation that is not the parent’s own', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', owner.pubkey);
		const createResponse = await createProject({
			request: new Request('https://cadbos.example/api/projects', {
				method: 'POST',
				body: JSON.stringify({ title: 'Living room' })
			}),
			platform: platform(db),
			locals: { user: owner }
		} as Parameters<typeof createProject>[0]);
		const project = (await createResponse.json()) as ProjectRecord;

		const sessionResponse = await createSession({
			request: new Request('https://cadbos.example/api/projects/x/sessions', {
				method: 'POST',
				body: JSON.stringify({})
			}),
			params: { id: project.id },
			platform: platform(db),
			locals: { user: owner }
		} as Parameters<typeof createSession>[0]);
		const parentSession = (await sessionResponse.json()) as CreateSessionResponse;
		seedGeneration(db, '00000000-0000-4000-8000-000000000101', parentSession.id, 'user-1');

		const forkResponse = await forkSession({
			request: new Request('https://cadbos.example/api/projects/x/sessions/y/fork', {
				method: 'POST',
				body: JSON.stringify({
					forkedFromGenerationId: '00000000-0000-4000-8000-000000000101',
					title: 'Style B'
				})
			}),
			params: { id: project.id, sessionId: parentSession.id },
			platform: platform(db),
			locals: { user: owner }
		} as Parameters<typeof forkSession>[0]);
		expect(forkResponse.status).toBe(201);
		const forked = (await forkResponse.json()) as ForkSessionResponse;
		expect(forked.parentSessionId).toBe(parentSession.id);
		expect(forked.forkedFromGenerationId).toBe('00000000-0000-4000-8000-000000000101');

		const otherSessionResponse = await createSession({
			request: new Request('https://cadbos.example/api/projects/x/sessions', {
				method: 'POST',
				body: JSON.stringify({})
			}),
			params: { id: project.id },
			platform: platform(db),
			locals: { user: owner }
		} as Parameters<typeof createSession>[0]);
		const otherSession = (await otherSessionResponse.json()) as CreateSessionResponse;
		seedGeneration(db, '00000000-0000-4000-8000-000000000102', otherSession.id, 'user-1');

		const mismatched = await forkSession({
			request: new Request('https://cadbos.example/api/projects/x/sessions/y/fork', {
				method: 'POST',
				body: JSON.stringify({ forkedFromGenerationId: '00000000-0000-4000-8000-000000000102' })
			}),
			params: { id: project.id, sessionId: parentSession.id },
			platform: platform(db),
			locals: { user: owner }
		} as Parameters<typeof forkSession>[0]);
		expect(mismatched.status).toBe(404);
	});
});

describe('GET, POST /api/projects/[id]/share and DELETE /api/projects/[id]/share', () => {
	it('issues a token, auto-revokes the prior one, and revoke (of whichever is active) 404s on a repeat', async () => {
		const db = makeD1();
		await seedTwoUsers(db);
		const createResponse = await createProject({
			request: new Request('https://cadbos.example/api/projects', {
				method: 'POST',
				body: JSON.stringify({ title: 'Living room' })
			}),
			platform: platform(db),
			locals: { user: owner }
		} as Parameters<typeof createProject>[0]);
		const project = (await createResponse.json()) as ProjectRecord;

		const noShareYet = await getShare({
			params: { id: project.id },
			platform: platform(db),
			locals: { user: owner }
		} as Parameters<typeof getShare>[0]);
		expect(noShareYet.status).toBe(404);

		const firstShare = await issueShare({
			params: { id: project.id },
			platform: platform(db),
			locals: { user: owner }
		} as Parameters<typeof issueShare>[0]);
		expect(firstShare.status).toBe(201);
		const firstToken = (await firstShare.json()) as ShareTokenResponse;
		expect(await getProjectDetailByShareToken(db, firstToken.token)).not.toBeNull();

		// The owner can recover the token they were just handed (e.g. after a
		// page reload) without reissuing it.
		const getFirst = await getShare({
			params: { id: project.id },
			platform: platform(db),
			locals: { user: owner }
		} as Parameters<typeof getShare>[0]);
		expect(getFirst.status).toBe(200);
		expect(((await getFirst.json()) as ShareTokenResponse).token).toBe(firstToken.token);

		const deniedGet = await getShare({
			params: { id: project.id },
			platform: platform(db),
			locals: { user: intruder }
		} as Parameters<typeof getShare>[0]);
		expect(deniedGet.status).toBe(404);

		const secondShare = await issueShare({
			params: { id: project.id },
			platform: platform(db),
			locals: { user: owner }
		} as Parameters<typeof issueShare>[0]);
		const secondToken = (await secondShare.json()) as ShareTokenResponse;
		expect(await getProjectDetailByShareToken(db, firstToken.token)).toBeNull();
		expect(await getProjectDetailByShareToken(db, secondToken.token)).not.toBeNull();

		const deniedRevoke = await revokeShare({
			params: { id: project.id },
			platform: platform(db),
			locals: { user: intruder }
		} as Parameters<typeof revokeShare>[0]);
		expect(deniedRevoke.status).toBe(404);

		// The caller never needs to know secondToken's value to revoke it —
		// revoking always targets whichever link is currently active.
		const revoke = await revokeShare({
			params: { id: project.id },
			platform: platform(db),
			locals: { user: owner }
		} as Parameters<typeof revokeShare>[0]);
		expect(revoke.status).toBe(204);
		expect(await getProjectDetailByShareToken(db, secondToken.token)).toBeNull();

		const getAfterRevoke = await getShare({
			params: { id: project.id },
			platform: platform(db),
			locals: { user: owner }
		} as Parameters<typeof getShare>[0]);
		expect(getAfterRevoke.status).toBe(404);

		const revokeAgain = await revokeShare({
			params: { id: project.id },
			platform: platform(db),
			locals: { user: owner }
		} as Parameters<typeof revokeShare>[0]);
		expect(revokeAgain.status).toBe(404);
	});
});

describe('PATCH /api/projects/[id]/sessions/[sessionId]', () => {
	it('renames only when owned', async () => {
		const db = makeD1();
		await seedTwoUsers(db);
		const createResponse = await createProject({
			request: new Request('https://cadbos.example/api/projects', {
				method: 'POST',
				body: JSON.stringify({ title: 'Living room' })
			}),
			platform: platform(db),
			locals: { user: owner }
		} as Parameters<typeof createProject>[0]);
		const project = (await createResponse.json()) as ProjectRecord;
		const sessionResponse = await createSession({
			request: new Request('https://cadbos.example/api/projects/x/sessions', {
				method: 'POST',
				body: JSON.stringify({})
			}),
			params: { id: project.id },
			platform: platform(db),
			locals: { user: owner }
		} as Parameters<typeof createSession>[0]);
		const session = (await sessionResponse.json()) as CreateSessionResponse;

		const denied = await renameSession({
			request: new Request('https://cadbos.example/api/projects/x/sessions/y', {
				method: 'PATCH',
				body: JSON.stringify({ title: 'Hijacked' })
			}),
			params: { id: project.id, sessionId: session.id },
			platform: platform(db),
			locals: { user: intruder }
		} as Parameters<typeof renameSession>[0]);
		expect(denied.status).toBe(404);

		const renamed = await renameSession({
			request: new Request('https://cadbos.example/api/projects/x/sessions/y', {
				method: 'PATCH',
				body: JSON.stringify({ title: 'Cozy corner' })
			}),
			params: { id: project.id, sessionId: session.id },
			platform: platform(db),
			locals: { user: owner }
		} as Parameters<typeof renameSession>[0]);
		expect(renamed.status).toBe(200);
		expect(((await renamed.json()) as RenameSessionResponse).title).toBe('Cozy corner');
	});
});

describe('DELETE /api/projects/[id]/sessions/[sessionId]', () => {
	it('archives only when owned, hides the session from the project detail, and 404s on a repeat', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', owner.pubkey);
		const createResponse = await createProject({
			request: new Request('https://cadbos.example/api/projects', {
				method: 'POST',
				body: JSON.stringify({ title: 'Living room' })
			}),
			platform: platform(db),
			locals: { user: owner }
		} as Parameters<typeof createProject>[0]);
		const project = (await createResponse.json()) as ProjectRecord;
		const sessionResponse = await createSession({
			request: new Request('https://cadbos.example/api/projects/x/sessions', {
				method: 'POST',
				body: JSON.stringify({})
			}),
			params: { id: project.id },
			platform: platform(db),
			locals: { user: owner }
		} as Parameters<typeof createSession>[0]);
		const session = (await sessionResponse.json()) as CreateSessionResponse;
		seedGeneration(db, '00000000-0000-4000-8000-000000000101', session.id, 'user-1');

		const archived = await deleteSession({
			params: { id: project.id, sessionId: session.id },
			platform: platform(db),
			locals: { user: owner }
		} as Parameters<typeof deleteSession>[0]);
		expect(archived.status).toBe(204);

		const detailResponse = await getProject({
			params: { id: project.id },
			platform: platform(db),
			locals: { user: owner }
		} as Parameters<typeof getProject>[0]);
		expect(((await detailResponse.json()) as ProjectDetailResponse).sessions).toHaveLength(0);

		const generation = await db
			.prepare('SELECT id FROM generations WHERE id = ?')
			.bind('00000000-0000-4000-8000-000000000101')
			.first();
		expect(generation).not.toBeNull();

		const archiveAgain = await deleteSession({
			params: { id: project.id, sessionId: session.id },
			platform: platform(db),
			locals: { user: owner }
		} as Parameters<typeof deleteSession>[0]);
		expect(archiveAgain.status).toBe(404);
	});
});

describe('DELETE /api/projects/[id]', () => {
	it('archives only when owned, hides the project everywhere, and 404s on a repeat', async () => {
		const db = makeD1();
		await seedTwoUsers(db);
		const createResponse = await createProject({
			request: new Request('https://cadbos.example/api/projects', {
				method: 'POST',
				body: JSON.stringify({ title: 'Living room' })
			}),
			platform: platform(db),
			locals: { user: owner }
		} as Parameters<typeof createProject>[0]);
		const project = (await createResponse.json()) as ProjectRecord;

		const denied = await deleteProject({
			params: { id: project.id },
			platform: platform(db),
			locals: { user: intruder }
		} as Parameters<typeof deleteProject>[0]);
		expect(denied.status).toBe(404);

		const archived = await deleteProject({
			params: { id: project.id },
			platform: platform(db),
			locals: { user: owner }
		} as Parameters<typeof deleteProject>[0]);
		expect(archived.status).toBe(204);

		const listResponse = await listProjects({
			url: new URL('https://cadbos.example/api/projects?offset=0&size=20'),
			platform: platform(db),
			locals: { user: owner }
		} as Parameters<typeof listProjects>[0]);
		expect(((await listResponse.json()) as ProjectsResponse).projects).toHaveLength(0);

		const getResponse = await getProject({
			params: { id: project.id },
			platform: platform(db),
			locals: { user: owner }
		} as Parameters<typeof getProject>[0]);
		expect(getResponse.status).toBe(404);

		const archiveAgain = await deleteProject({
			params: { id: project.id },
			platform: platform(db),
			locals: { user: owner }
		} as Parameters<typeof deleteProject>[0]);
		expect(archiveAgain.status).toBe(404);
	});
});
