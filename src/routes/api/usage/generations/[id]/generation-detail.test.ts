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

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import type {
	AdminGenerationDetailResponse,
	RequestFormSnapshot,
	SessionUser
} from '$lib/api/contract';
import { adminGenerationDetailResponseSchema } from '$lib/api/admin-generation';
import { createDb } from '$lib/server/db';
import { getGenerationDetailForAdmin } from '$lib/server/generations';
import { mediaLink } from '$lib/server/media-access';
import { makeD1 } from '$lib/server/testing/d1-shim';
import {
	seedGenerationRecord,
	seedManagedMedia,
	TEST_FORM_SNAPSHOT
} from '$lib/server/testing/generation-fixtures';
import { seedAdmin } from '$lib/server/testing/session-fixtures';
import { GET } from './+server';

const ID = '00000000-0000-4000-8000-000000000001';
const PROJECT_ID = '00000000-0000-4000-8000-000000000002';
const SESSION_ID = '00000000-0000-4000-8000-000000000003';
const ADMIN = { pubkey: 'a'.repeat(64) };
const OWNER = { pubkey: 'b'.repeat(64) };
const BUCKET = 'cadbos-uploads';

type DetailEvent = Parameters<typeof GET>[0];

async function seed(snapshot?: RequestFormSnapshot): Promise<D1Database> {
	const raw = makeD1();
	for (const [id, pubkey] of [
		['admin', ADMIN.pubkey],
		['owner', OWNER.pubkey]
	]) {
		await raw
			.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, 1)')
			.bind(id, pubkey)
			.run();
	}
	await seedAdmin(raw, 'admin');
	await raw
		.prepare(
			'INSERT INTO projects (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, 1, 1)'
		)
		.bind(PROJECT_ID, 'owner', 'Apartment')
		.run();
	await raw
		.prepare(
			'INSERT INTO project_sessions (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, 1, 1)'
		)
		.bind(SESSION_ID, PROJECT_ID, 'Living room')
		.run();
	const db = createDb(raw);
	const sourceMediaId = await seedManagedMedia(db, 'source.jpg');
	const resultMediaId = await seedManagedMedia(db, 'result.webp');
	const referenceMediaId = await seedManagedMedia(db, 'reference.jpg');
	await seedManagedMedia(db, 'mask.png');
	await seedGenerationRecord(db, {
		id: ID,
		userId: 'owner',
		sourceMediaId,
		resultMediaId,
		referenceMediaId,
		sessionId: SESSION_ID,
		createdAt: 1000,
		prompt: 'Уютная комната',
		formSnapshot: snapshot
	});
	return raw;
}

function call(
	db: D1Database,
	user: SessionUser | null = ADMIN,
	id = ID,
	sessionLookupUnavailable = false
): ReturnType<typeof GET> {
	return GET({
		params: { id },
		platform: { env: { DB: db } } as App.Platform,
		locals: { user, sessionLookupUnavailable }
	} as DetailEvent);
}

afterEach(() => vi.restoreAllMocks());

describe('GET /api/usage/generations/[id]', () => {
	it('requires authentication and database-backed admin access before looking up an ID', async () => {
		const db = await seed();
		expect((await call(db, null)).status).toBe(401);
		expect((await call(db, null, ID, true)).status).toBe(503);
		expect((await call(db, OWNER)).status).toBe(403);
		expect((await call(db, OWNER, 'invalid')).status).toBe(403);
		expect(await getGenerationDetailForAdmin(createDb(db), OWNER.pubkey, ID)).toBeNull();
		await db.prepare('DELETE FROM admins WHERE user_id = ?').bind('admin').run();
		expect((await call(db)).status).toBe(403);
	});

	it('validates generation IDs and distinguishes a missing generation', async () => {
		const db = await seed();
		expect((await call(db, ADMIN, 'invalid')).status).toBe(400);
		expect((await call(db, ADMIN, '00000000-0000-4000-8000-000000000099')).status).toBe(404);
	});

	it('returns another user’s one generation, current names, translation and cached application media links', async () => {
		const db = await seed(TEST_FORM_SNAPSHOT);
		await db
			.prepare('UPDATE generations SET translated_prompt = ? WHERE id = ?')
			.bind('A cozy room', ID)
			.run();
		const response = await call(db);
		const body = adminGenerationDetailResponseSchema.parse(await response.json());
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(body).toMatchObject({
			id: ID,
			prompt: 'Уютная комната',
			translatedPrompt: 'A cozy room',
			kind: 'render',
			createdAt: 1000,
			project: { title: 'Apartment' },
			session: { title: 'Living room' },
			image: mediaLink(BUCKET, 'result.webp'),
			source: mediaLink(BUCKET, 'source.jpg'),
			reference: mediaLink(BUCKET, 'reference.jpg'),
			hasReference: true,
			formSnapshot: TEST_FORM_SNAPSHOT
		});
		expect(body.media).toHaveLength(3);
		expect(body).not.toHaveProperty('balanceAfter');
		expect(body).not.toHaveProperty('history');
	});

	it('keeps archived project and session names available without changing owner continuation behavior', async () => {
		const db = await seed();
		await db
			.prepare('UPDATE projects SET title = ?, archived_at = 2 WHERE id = ?')
			.bind('Renamed apartment', PROJECT_ID)
			.run();
		await db
			.prepare('UPDATE project_sessions SET archived_at = 2 WHERE id = ?')
			.bind(SESSION_ID)
			.run();
		const body = (await (await call(db)).json()) as AdminGenerationDetailResponse;
		expect(body.project).toEqual({ title: 'Renamed apartment' });
		expect(body.session).toEqual({ title: 'Living room' });
	});

	it('preserves exact regions, masks and unknown preset IDs rather than normalizing them for editing', async () => {
		const snapshot: RequestFormSnapshot = {
			...TEST_FORM_SNAPSHOT,
			objectReferenceImage: { mediaKey: BUCKET + '/reference.jpg' },
			textureMaskImage: { mediaKey: BUCKET + '/mask.png' },
			objectReplacementRegion: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
			repaintRegion: { x: 0.2, y: 0.1, width: 0.4, height: 0.3 },
			lightSettingsPresetIds: ['retired-preset', 'midday', 'midday']
		};
		const body = adminGenerationDetailResponseSchema.parse(
			await (await call(await seed(snapshot))).json()
		);
		expect(body.formSnapshot).toEqual(snapshot);
		expect(body.media).toHaveLength(4);
		expect(body.media).toContainEqual(mediaLink(BUCKET, 'mask.png'));
	});

	it('keeps unresolved snapshot references and resolves the recorded reference without a snapshot', async () => {
		const snapshot = {
			...TEST_FORM_SNAPSHOT,
			styleReferenceImage: { mediaKey: BUCKET + '/missing.jpg' }
		};
		const db = await seed(snapshot);
		const body = (await (await call(db)).json()) as AdminGenerationDetailResponse;
		expect(body.formSnapshot?.styleReferenceImage).toEqual(snapshot.styleReferenceImage);
		expect(body.media).not.toContainEqual(mediaLink(BUCKET, 'missing.jpg'));
		await db
			.prepare('UPDATE generations SET form_snapshot = NULL, session_id = NULL WHERE id = ?')
			.bind(ID)
			.run();
		const older = (await (await call(db)).json()) as AdminGenerationDetailResponse;
		expect(older.formSnapshot).toBeNull();
		expect(older.project).toBeNull();
		expect(older.session).toBeNull();
		expect(older.reference).toEqual(mediaLink(BUCKET, 'reference.jpg'));
	});

	it.each(['{broken', '{"unrelated":true}'])(
		'surfaces unavailable settings and logs invalid stored snapshots safely: %s',
		async (snapshot) => {
			const db = await seed();
			const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
			await db
				.prepare('UPDATE generations SET form_snapshot = ? WHERE id = ?')
				.bind(snapshot, ID)
				.run();
			const response = await call(db);
			const body = (await response.json()) as AdminGenerationDetailResponse;
			expect(response.status).toBe(200);
			expect(body.formSnapshot).toBeNull();
			expect(body.prompt).toBe('Уютная комната');
			expect(logger).toHaveBeenCalled();
			expect(JSON.stringify(logger.mock.calls)).not.toContain(snapshot);
		}
	);

	it('distinguishes an unused reference from a saved reference', async () => {
		const db = await seed();
		await db
			.prepare('UPDATE generations SET reference_media_id = NULL WHERE id = ?')
			.bind(ID)
			.run();
		const body = (await (await call(db)).json()) as AdminGenerationDetailResponse;
		expect(body.hasReference).toBe(false);
		expect(body.reference).toBeNull();
	});
});
