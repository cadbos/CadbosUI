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
import type { ShareGenerationDetailResponse } from '$lib/api/contract';
import { createProject, createSession, issueShareToken } from '$lib/server/projects';
import { makeD1 } from '$lib/server/testing/d1-shim';
import {
	seedGeneration as seedGenerationFixture,
	TEST_FORM_SNAPSHOT,
	TEST_S3_ENV
} from '$lib/server/testing/generation-fixtures';

const { GET: getSharedGenerationDetail } = await import('./+server');

function seedUser(db: D1Database, id: string, pubkey: string): void {
	db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind(id, pubkey, Date.now())
		.run();
}

function platform(db: D1Database): App.Platform {
	return { env: { DB: db, ...TEST_S3_ENV } } as unknown as App.Platform;
}

function call(
	platform: App.Platform,
	token: string,
	id: string
): ReturnType<typeof getSharedGenerationDetail> {
	return getSharedGenerationDetail({
		params: { token, id },
		platform
	} as Parameters<typeof getSharedGenerationDetail>[0]);
}

describe('GET /api/share/[token]/generations/[id]', () => {
	it('returns the text settings for a generation in an actively-shared project — no auth required', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');
		const project = await createProject(db, 'user-1', 'Living room');
		const session = await createSession(db, 'user-1', project.id, 'Main thread');
		seedGenerationFixture(db, {
			id: '00000000-0000-4000-8000-000000000101',
			userId: 'user-1',
			url: 'https://cdn.example.test/out.webp',
			sourceUrl: 'https://cdn.example.test/room.jpg',
			createdAt: Date.now(),
			sessionId: session!.id,
			kind: 'style-transfer',
			formSnapshot: {
				...TEST_FORM_SNAPSHOT,
				styleReferenceImage: { mediaKey: 'cadbos-uploads/reference.jpg' }
			}
		});
		const token = await issueShareToken(db, 'user-1', project.id);

		const response = await call(platform(db), token!, '00000000-0000-4000-8000-000000000101');
		const result = (await response.json()) as ShareGenerationDetailResponse;

		expect(response.status).toBe(200);
		expect(result.kind).toBe('style-transfer');
		expect(result.formSnapshot).not.toBeNull();
		expect(result.formSnapshot).not.toHaveProperty('styleReferenceImage');
		expect(result.formSnapshot?.styleTransferPrompt).toBe(TEST_FORM_SNAPSHOT.styleTransferPrompt);
	});

	it('returns 404 for an unknown generation id', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');
		const project = await createProject(db, 'user-1', 'Living room');
		const token = await issueShareToken(db, 'user-1', project.id);

		const response = await call(platform(db), token!, 'missing-generation');

		expect(response.status).toBe(404);
	});

	it('returns 404 for a revoked or unknown token — indistinguishably', async () => {
		const db = makeD1();
		const response = await call(platform(db), 'never-issued', 'any-id');

		expect(response.status).toBe(404);
	});
});
