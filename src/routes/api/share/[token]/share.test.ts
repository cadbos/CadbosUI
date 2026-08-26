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
import type { ProjectDetailResponse } from '$lib/api/contract';
import {
	archiveProject,
	createProject,
	createSession,
	issueShareToken,
	revokeActiveShareToken
} from '$lib/server/projects';
import { makeD1 } from '$lib/server/testing/d1-shim';
import { seedGeneration as seedGenerationFixture } from '$lib/server/testing/generation-fixtures';

const { GET: getSharedProject } = await import('./+server');

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

describe('GET /api/share/[token]', () => {
	it('returns the project detail for a valid, active token — no auth required', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');
		const project = await createProject(db, 'user-1', 'Living room');
		const session = await createSession(db, 'user-1', project.id, 'Main thread');
		seedGeneration(db, '00000000-0000-4000-8000-000000000101', session!.id, 'user-1');
		const token = await issueShareToken(db, 'user-1', project.id);

		const response = await getSharedProject({
			params: { token: token! },
			platform: platform(db)
		} as Parameters<typeof getSharedProject>[0]);

		expect(response.status).toBe(200);
		const detail = (await response.json()) as ProjectDetailResponse;
		expect(detail.id).toBe(project.id);
		expect(detail.shareActive).toBe(true);
		expect(detail.sessions[0]?.generations.map((generation) => generation.id)).toEqual([
			'00000000-0000-4000-8000-000000000101'
		]);
	});

	it('returns 404 once the project has been archived, even with a still-active token', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');
		const project = await createProject(db, 'user-1', 'Living room');
		const token = await issueShareToken(db, 'user-1', project.id);
		await archiveProject(db, 'user-1', project.id);

		const response = await getSharedProject({
			params: { token: token! },
			platform: platform(db)
		} as Parameters<typeof getSharedProject>[0]);
		expect(response.status).toBe(404);
	});

	it('returns 404 for an unknown token, and for a revoked one — indistinguishably', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');
		const project = await createProject(db, 'user-1', 'Living room');
		const token = await issueShareToken(db, 'user-1', project.id);
		await revokeActiveShareToken(db, 'user-1', project.id);

		const revokedResponse = await getSharedProject({
			params: { token: token! },
			platform: platform(db)
		} as Parameters<typeof getSharedProject>[0]);
		expect(revokedResponse.status).toBe(404);

		const unknownResponse = await getSharedProject({
			params: { token: 'never-issued' },
			platform: platform(db)
		} as Parameters<typeof getSharedProject>[0]);
		expect(unknownResponse.status).toBe(404);
	});
});
