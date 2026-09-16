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

import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '$lib/server/db';
import { makeDb } from '$lib/server/testing/d1-shim';
import { TEST_FORM_SNAPSHOT, TEST_S3_BUCKET } from './testing/generation-fixtures';
import { getCredit } from './billing';
import {
	deleteGeneratedImage,
	findGenerationSourceByHash,
	getGeneratedImageForUser,
	getGenerationDetailForUser,
	listCreditHistory,
	listDistinctSourceImages,
	listGeneratedImages,
	recordGeneration
} from './generations';

const HASH_1 = '1'.repeat(64);
const HASH_2 = '2'.repeat(64);
const RESULT_HASH = 'a'.repeat(64);

async function seedUser(db: Database, id: string, pubkey: string): Promise<void> {
	await db.run(
		sql`INSERT INTO users (id, pubkey, created_at) VALUES (${id}, ${pubkey}, ${Date.now()})`
	);
}

// The admin's manual approval step — no auto-provisioning exists anymore.
async function grantAccess(db: Database, userId: string, balance: number): Promise<void> {
	await db.run(
		sql`INSERT INTO credits (user_id, balance, updated_at, enabled) VALUES (${userId}, ${balance}, ${Date.now()}, 1)`
	);
}

// Every generations row now has to attach to a session it belongs to — a minimal
// project+session pair, direct SQL like the other seed helpers here.
async function seedSession(db: Database, userId: string): Promise<string> {
	const now = Date.now();
	const projectId = crypto.randomUUID();
	const sessionId = crypto.randomUUID();
	await db.run(
		sql`INSERT INTO projects (id, user_id, title, created_at, updated_at) VALUES (${projectId}, ${userId}, 'Test project', ${now}, ${now})`
	);
	await db.run(
		sql`INSERT INTO project_sessions (id, project_id, title, created_at, updated_at) VALUES (${sessionId}, ${projectId}, 'Test session', ${now}, ${now})`
	);
	return sessionId;
}

async function seedMedia(db: Database, url: string, checksum: string): Promise<number> {
	const filename = new URL(url).pathname.slice(1);
	await db.run(
		sql`INSERT OR IGNORE INTO media (filename, bucket, checksum) VALUES (${filename}, 1, ${checksum})`
	);
	const row = await db.get<{ id: number }>(
		sql`SELECT id FROM media WHERE bucket = 1 AND filename = ${filename}`
	);
	if (!row) throw new Error('media seed failed');
	return row.id;
}

async function seedGeneration(
	db: Database,
	id: string,
	userId: string,
	createdAt: number,
	kind = 'render'
): Promise<void> {
	const resultMediaId = await seedMedia(db, `https://cdn.example.test/${id}.webp`, '');
	const sourceMediaId = await seedMedia(db, 'https://cdn.example.test/source.jpg', '');
	await db.run(
		sql`INSERT INTO generations
			(id, user_id, result_media_id, source_media_id, prompt, kind, amount, balance_after, created_at)
			VALUES (${id}, ${userId}, ${resultMediaId}, ${sourceMediaId}, 'cozy', ${kind}, 1, 10, ${createdAt})`
	);
}

// Unlike seedGeneration, lets the caller set source media and checksum directly.
async function seedGenerationWithSource(
	db: Database,
	id: string,
	userId: string,
	sourceUrl: string,
	sourceHash: string,
	createdAt: number
): Promise<number> {
	const resultMediaId = await seedMedia(db, `https://cdn.example.test/${id}.webp`, '');
	const sourceMediaId = await seedMedia(db, sourceUrl, sourceHash);
	await db.run(
		sql`INSERT INTO generations
			(id, user_id, result_media_id, source_media_id, prompt, kind, amount, balance_after, created_at)
			VALUES (${id}, ${userId}, ${resultMediaId}, ${sourceMediaId}, 'cozy', 'render', 1, 10, ${createdAt})`
	);
	return sourceMediaId;
}

let db: Database;

beforeEach(async () => {
	db = makeDb();
	await db.run(
		sql`UPDATE buckets SET url = 'https://cdn.example.test' WHERE name = ${TEST_S3_BUCKET.name}`
	);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('recordGeneration', () => {
	it('subtracts the real cost and records the image against the same row', async () => {
		await seedUser(db, 'user-1', 'pubkey-1');
		await grantAccess(db, 'user-1', 5);
		const sessionId = await seedSession(db, 'user-1');
		const resultMediaId = await seedMedia(db, 'https://cdn.example.test/out.webp', RESULT_HASH);
		const sourceMediaId = await seedMedia(db, 'https://cdn.example.test/room.jpg', HASH_1);

		const result = await recordGeneration(db, 'user-1', {
			resultMediaId,
			sourceMediaId,
			sessionId,
			prompt: 'cozy',
			kind: 'render',
			amount: 1.5,
			archaiRenderSec: 5,
			archaiDownloadSec: 0,
			archaiReuploadSec: 0
		});
		expect(result.balance).toBe(3.5);

		const history = await listCreditHistory(db, 'user-1');
		expect(history).toEqual([
			expect.objectContaining({ amount: 1.5, balanceAfter: 3.5, kind: 'render' })
		]);

		const images = await listGeneratedImages(db, 'user-1', 0, 10);
		expect(images.images).toEqual([
			expect.objectContaining({ mediaId: resultMediaId, sourceMediaId })
		]);
	});

	it('isolates credit balances per user', async () => {
		await seedUser(db, 'user-1', 'pubkey-1');
		await seedUser(db, 'user-2', 'pubkey-2');
		await grantAccess(db, 'user-1', 5);
		await grantAccess(db, 'user-2', 5);
		const sessionId = await seedSession(db, 'user-1');
		const resultMediaId = await seedMedia(db, 'https://cdn.example.test/out.webp', RESULT_HASH);
		const sourceMediaId = await seedMedia(db, 'https://cdn.example.test/room.jpg', HASH_1);

		await recordGeneration(db, 'user-1', {
			resultMediaId,
			sourceMediaId,
			sessionId,
			prompt: 'cozy',
			kind: 'render',
			amount: 2,
			archaiRenderSec: 5,
			archaiDownloadSec: 0,
			archaiReuploadSec: 0
		});

		expect((await getCredit(db, 'user-1'))?.balance).toBe(3);
		expect((await getCredit(db, 'user-2'))?.balance).toBe(5);
	});

	it('persists the form snapshot as JSON, and leaves it null when omitted', async () => {
		await seedUser(db, 'user-1', 'pubkey-1');
		await grantAccess(db, 'user-1', 5);
		const sessionId = await seedSession(db, 'user-1');

		const withSnapshotResultId = await seedMedia(db, 'https://cdn.example.test/with.webp', '');
		const sourceMediaId = await seedMedia(db, 'https://cdn.example.test/room.jpg', HASH_1);
		await recordGeneration(db, 'user-1', {
			resultMediaId: withSnapshotResultId,
			sourceMediaId,
			sessionId,
			prompt: 'cozy',
			kind: 'render',
			amount: 1,
			archaiRenderSec: 0,
			archaiDownloadSec: 0,
			archaiReuploadSec: 0,
			formSnapshot: TEST_FORM_SNAPSHOT
		});
		const withSnapshotRow = await db.get<{ form_snapshot: string | null }>(
			sql`SELECT form_snapshot FROM generations WHERE user_id = ${'user-1'} ORDER BY rowid DESC LIMIT 1`
		);
		expect(JSON.parse(withSnapshotRow!.form_snapshot!)).toEqual(TEST_FORM_SNAPSHOT);

		const withoutSnapshotResultId = await seedMedia(
			db,
			'https://cdn.example.test/without.webp',
			''
		);
		await recordGeneration(db, 'user-1', {
			resultMediaId: withoutSnapshotResultId,
			sourceMediaId,
			sessionId,
			prompt: 'cozy',
			kind: 'upscale',
			amount: 1,
			archaiRenderSec: 0,
			archaiDownloadSec: 0,
			archaiReuploadSec: 0
		});
		const withoutSnapshotRow = await db.get<{ form_snapshot: string | null }>(
			sql`SELECT form_snapshot FROM generations WHERE user_id = ${'user-1'} ORDER BY rowid DESC LIMIT 1`
		);
		expect(withoutSnapshotRow!.form_snapshot).toBeNull();
	});
});

describe('getGenerationDetailForUser', () => {
	it('returns the parsed form snapshot alongside the prompt and source media', async () => {
		await seedUser(db, 'user-1', 'pubkey-1');
		await grantAccess(db, 'user-1', 5);
		const sessionId = await seedSession(db, 'user-1');
		const resultMediaId = await seedMedia(db, 'https://cdn.example.test/out.webp', RESULT_HASH);
		const sourceMediaId = await seedMedia(db, 'https://cdn.example.test/room.jpg', HASH_1);
		await recordGeneration(db, 'user-1', {
			resultMediaId,
			sourceMediaId,
			sessionId,
			prompt: 'cozy',
			kind: 'render',
			amount: 1,
			archaiRenderSec: 0,
			archaiDownloadSec: 0,
			archaiReuploadSec: 0,
			formSnapshot: TEST_FORM_SNAPSHOT
		});
		const [{ id }] = (await listGeneratedImages(db, 'user-1', 0, 1)).images;

		const detail = await getGenerationDetailForUser(db, 'user-1', id);

		expect(detail).toEqual({
			id,
			sourceMediaId,
			resultMediaId,
			prompt: 'cozy',
			kind: 'render',
			createdAt: expect.any(Number),
			formSnapshot: TEST_FORM_SNAPSHOT,
			session: {
				projectId: expect.any(String),
				projectTitle: 'Test project',
				sessionId,
				sessionTitle: 'Test session'
			}
		});
	});

	it('returns no session once the generation’s session or project is archived', async () => {
		await seedUser(db, 'user-1', 'pubkey-1');
		const sessionId = await seedSession(db, 'user-1');
		await seedGeneration(db, 'image-1', 'user-1', 1000);
		await db.run(sql`UPDATE generations SET session_id = ${sessionId} WHERE id = ${'image-1'}`);

		expect((await getGenerationDetailForUser(db, 'user-1', 'image-1'))?.session?.sessionId).toBe(
			sessionId
		);

		await db.run(
			sql`UPDATE project_sessions SET archived_at = ${Date.now()} WHERE id = ${sessionId}`
		);
		expect((await getGenerationDetailForUser(db, 'user-1', 'image-1'))?.session).toBeNull();

		await db.run(sql`UPDATE project_sessions SET archived_at = NULL WHERE id = ${sessionId}`);
		await db.run(
			sql`UPDATE projects SET archived_at = ${Date.now()} WHERE id = (SELECT project_id FROM project_sessions WHERE id = ${sessionId})`
		);
		expect((await getGenerationDetailForUser(db, 'user-1', 'image-1'))?.session).toBeNull();
	});

	it('returns null for another user’s generation', async () => {
		await seedUser(db, 'user-1', 'pubkey-1');
		await seedUser(db, 'user-2', 'pubkey-2');
		await seedGeneration(db, 'image-1', 'user-1', 1000);

		expect(await getGenerationDetailForUser(db, 'user-2', 'image-1')).toBeNull();
	});

	it('degrades to a null snapshot for a row whose stored JSON is malformed', async () => {
		await seedUser(db, 'user-1', 'pubkey-1');
		await seedGeneration(db, 'image-1', 'user-1', 1000);
		await db.run(
			sql`UPDATE generations SET form_snapshot = ${'{not valid json'} WHERE id = ${'image-1'}`
		);

		const detail = await getGenerationDetailForUser(db, 'user-1', 'image-1');

		expect(detail?.formSnapshot).toBeNull();
	});

	it('degrades to a null snapshot for a row whose stored JSON no longer matches the shape', async () => {
		await seedUser(db, 'user-1', 'pubkey-1');
		await seedGeneration(db, 'image-1', 'user-1', 1000);
		await db.run(
			sql`UPDATE generations SET form_snapshot = ${JSON.stringify({ unrelated: true })} WHERE id = ${'image-1'}`
		);

		const detail = await getGenerationDetailForUser(db, 'user-1', 'image-1');

		expect(detail?.formSnapshot).toBeNull();
	});
});

describe('listCreditHistory', () => {
	it('is empty before any generation', async () => {
		await seedUser(db, 'user-1', 'pubkey-1');
		await grantAccess(db, 'user-1', 5);
		await expect(listCreditHistory(db, 'user-1')).resolves.toEqual([]);
	});

	it('orders entries most-recent first', async () => {
		await seedUser(db, 'user-1', 'pubkey-1');
		await grantAccess(db, 'user-1', 5);
		const sessionId = await seedSession(db, 'user-1');
		const sourceMediaId = await seedMedia(db, 'https://cdn.example.test/room.jpg', HASH_1);
		const firstResultMediaId = await seedMedia(db, 'https://cdn.example.test/a.webp', RESULT_HASH);
		await recordGeneration(db, 'user-1', {
			resultMediaId: firstResultMediaId,
			sourceMediaId,
			sessionId,
			prompt: 'cozy',
			kind: 'render',
			amount: 1,
			archaiRenderSec: 5,
			archaiDownloadSec: 0,
			archaiReuploadSec: 0
		});
		const secondResultMediaId = await seedMedia(db, 'https://cdn.example.test/b.webp', RESULT_HASH);
		await recordGeneration(db, 'user-1', {
			resultMediaId: secondResultMediaId,
			sourceMediaId: firstResultMediaId,
			sessionId,
			prompt: 'change the sofa',
			kind: 'edit',
			amount: 2,
			archaiRenderSec: 5,
			archaiDownloadSec: 0,
			archaiReuploadSec: 0
		});

		const history = await listCreditHistory(db, 'user-1');
		expect(history.map((entry) => entry.kind)).toEqual(['edit', 'render']);
	});

	it('skips a row with an unrecognized stored generation kind, logging a warning', async () => {
		await seedUser(db, 'user-1', 'pubkey-1');
		await seedGeneration(db, 'invalid-kind', 'user-1', 1000, 'unknown');
		const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		const history = await listCreditHistory(db, 'user-1');

		expect(history).toEqual([]);
		expect(consoleWarn.mock.calls.flat()).toEqual([
			JSON.stringify({
				level: 'warn',
				area: 'generations',
				event: 'unknown_generation_kind',
				id: 'invalid-kind',
				kind: 'unknown'
			})
		]);
	});

	// The expenses page (routes/expenses/+page.svelte) resolves a clicked row
	// straight back to its project/session via these two fields.
	it('joins the owning session and project id for each entry', async () => {
		await seedUser(db, 'user-1', 'pubkey-1');
		await grantAccess(db, 'user-1', 5);
		const sessionId = await seedSession(db, 'user-1');
		const projectId = (
			await db.get<{ project_id: string }>(
				sql`SELECT project_id FROM project_sessions WHERE id = ${sessionId}`
			)
		)?.project_id;
		const resultMediaId = await seedMedia(db, 'https://cdn.example.test/out.webp', RESULT_HASH);
		const sourceMediaId = await seedMedia(db, 'https://cdn.example.test/room.jpg', HASH_1);
		await recordGeneration(db, 'user-1', {
			resultMediaId,
			sourceMediaId,
			sessionId,
			prompt: 'cozy',
			kind: 'render',
			amount: 1,
			archaiRenderSec: 5,
			archaiDownloadSec: 0,
			archaiReuploadSec: 0
		});

		const history = await listCreditHistory(db, 'user-1');
		expect(history).toEqual([expect.objectContaining({ sessionId, projectId })]);
	});

	it('scans past a newer invalid-kind row to reach a valid older one within the limit', async () => {
		await seedUser(db, 'user-1', 'pubkey-1');
		await seedGeneration(db, 'invalid-newer', 'user-1', 2000, 'unknown');
		await seedGeneration(db, 'valid-older', 'user-1', 1000);
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		const history = await listCreditHistory(db, 'user-1', 1);

		expect(history).toEqual([expect.objectContaining({ id: 'valid-older' })]);
	});

	// A generation predating Module 11 (or otherwise never attached to a
	// session) must not disappear from the history — it just can't be
	// resolved back to a project/session.
	it('leaves sessionId/projectId null for a generation with no session', async () => {
		await seedUser(db, 'user-1', 'pubkey-1');
		await seedGeneration(db, 'no-session', 'user-1', 1000);

		const history = await listCreditHistory(db, 'user-1');
		expect(history).toEqual([expect.objectContaining({ sessionId: null, projectId: null })]);
	});
});

describe('getGeneratedImageForUser', () => {
	it('returns null for an unknown generation id', async () => {
		await seedUser(db, 'user-1', 'pubkey-1');
		await expect(getGeneratedImageForUser(db, 'user-1', 'no-such-image')).resolves.toBeNull();
	});

	it('returns null when the generation belongs to a different user', async () => {
		await seedUser(db, 'user-1', 'pubkey-1');
		await seedUser(db, 'user-2', 'pubkey-2');
		await seedGeneration(db, 'image-1', 'user-2', 1000);

		await expect(getGeneratedImageForUser(db, 'user-1', 'image-1')).resolves.toBeNull();
	});

	it('returns the image for its owner', async () => {
		await seedUser(db, 'user-1', 'pubkey-1');
		await seedGeneration(db, 'image-1', 'user-1', 1000);

		await expect(getGeneratedImageForUser(db, 'user-1', 'image-1')).resolves.toEqual({
			id: 'image-1',
			userId: 'user-1',
			mediaId: expect.any(Number),
			sourceMediaId: expect.any(Number),
			filename: 'image-1.webp',
			bucketName: TEST_S3_BUCKET.name,
			kind: 'render',
			createdAt: 1000
		});
	});
});

describe('deleteGeneratedImage', () => {
	it('deletes only the owner’s row', async () => {
		await seedUser(db, 'user-1', 'pubkey-1');
		await seedUser(db, 'user-2', 'pubkey-2');
		await seedGeneration(db, 'image-1', 'user-1', 1000);
		const image = await getGeneratedImageForUser(db, 'user-1', 'image-1');
		if (!image) throw new Error('generated image seed failed');

		await expect(deleteGeneratedImage(db, 'user-2', 'image-1', image.mediaId)).resolves.toEqual({
			generationDeleted: false,
			mediaDeleted: false
		});
		await expect(deleteGeneratedImage(db, 'user-1', 'image-1', image.mediaId)).resolves.toEqual({
			generationDeleted: true,
			mediaDeleted: true
		});
		await expect(getGeneratedImageForUser(db, 'user-1', 'image-1')).resolves.toBeNull();
		expect(await db.get(sql`SELECT id FROM media WHERE id = ${image.mediaId}`)).toBeUndefined();
	});
});

describe('listGeneratedImages', () => {
	it('returns one user image page in newest-first order', async () => {
		await seedUser(db, 'user-1', 'pubkey-1');
		await seedUser(db, 'user-2', 'pubkey-2');
		await seedGeneration(db, 'oldest', 'user-1', 1000);
		await seedGeneration(db, 'newest', 'user-1', 3000);
		await seedGeneration(db, 'middle', 'user-1', 2000);
		await seedGeneration(db, 'other-user-image', 'user-2', 4000);

		const page = await listGeneratedImages(db, 'user-1', 0, 2);

		expect(page).toEqual({
			images: [
				{
					id: 'newest',
					userId: 'user-1',
					mediaId: expect.any(Number),
					sourceMediaId: expect.any(Number),
					filename: 'newest.webp',
					bucketName: TEST_S3_BUCKET.name,
					kind: 'render',
					createdAt: 3000
				},
				{
					id: 'middle',
					userId: 'user-1',
					mediaId: expect.any(Number),
					sourceMediaId: expect.any(Number),
					filename: 'middle.webp',
					bucketName: TEST_S3_BUCKET.name,
					kind: 'render',
					createdAt: 2000
				}
			],
			hasMore: true
		});
	});

	it('applies the requested offset', async () => {
		await seedUser(db, 'user-1', 'pubkey-1');
		await seedGeneration(db, 'first', 'user-1', 3000);
		await seedGeneration(db, 'second', 'user-1', 2000);
		await seedGeneration(db, 'third', 'user-1', 1000);

		const page = await listGeneratedImages(db, 'user-1', 1, 2);

		expect(page.images.map((image) => image.id)).toEqual(['second', 'third']);
		expect(page.hasMore).toBe(false);
	});

	it('skips a row with an unrecognized stored generation kind, logging a warning', async () => {
		await seedUser(db, 'user-1', 'pubkey-1');
		await seedGeneration(db, 'invalid-kind', 'user-1', 1000, 'unknown');
		const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		const page = await listGeneratedImages(db, 'user-1', 0, 10);

		expect(page.images).toEqual([]);
		expect(page.hasMore).toBe(false);
		expect(consoleWarn.mock.calls.flat()).toEqual([
			JSON.stringify({
				level: 'warn',
				area: 'generations',
				event: 'unknown_generation_kind',
				id: 'invalid-kind',
				kind: 'unknown'
			})
		]);
	});

	it('scans past newer invalid-kind rows to fill the page with valid older ones', async () => {
		await seedUser(db, 'user-1', 'pubkey-1');
		await seedGeneration(db, 'invalid-1', 'user-1', 6000, 'unknown');
		await seedGeneration(db, 'invalid-2', 'user-1', 5000, 'unknown');
		await seedGeneration(db, 'invalid-3', 'user-1', 4000, 'unknown');
		await seedGeneration(db, 'valid-1', 'user-1', 3000);
		await seedGeneration(db, 'valid-2', 'user-1', 2000);
		await seedGeneration(db, 'valid-3', 'user-1', 1000);
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		const page = await listGeneratedImages(db, 'user-1', 0, 2);

		expect(page.images.map((image) => image.id)).toEqual(['valid-1', 'valid-2']);
		expect(page.hasMore).toBe(true);
	});
});

describe('findGenerationSourceByHash', () => {
	it('returns the most recent source media URL for a matching hash', async () => {
		await seedUser(db, 'user-1', 'pubkey-1');
		await seedGenerationWithSource(
			db,
			'a',
			'user-1',
			'https://cdn.example.test/room-v1.jpg',
			HASH_1,
			1000
		);
		const expectedMediaId = await seedGenerationWithSource(
			db,
			'b',
			'user-1',
			'https://cdn.example.test/room-v2.jpg',
			HASH_1,
			2000
		);

		await expect(
			findGenerationSourceByHash(db, 'user-1', HASH_1, TEST_S3_BUCKET.name)
		).resolves.toBe(expectedMediaId);
	});

	it('never matches across users', async () => {
		await seedUser(db, 'user-1', 'pubkey-1');
		await seedUser(db, 'user-2', 'pubkey-2');
		await seedGenerationWithSource(
			db,
			'a',
			'user-2',
			'https://cdn.example.test/room.jpg',
			HASH_1,
			1000
		);

		await expect(
			findGenerationSourceByHash(db, 'user-1', HASH_1, TEST_S3_BUCKET.name)
		).resolves.toBeNull();
	});

	it('never matches an empty hash', async () => {
		await seedUser(db, 'user-1', 'pubkey-1');
		await seedGeneration(db, 'empty-checksum', 'user-1', 1000);

		await expect(
			findGenerationSourceByHash(db, 'user-1', '', TEST_S3_BUCKET.name)
		).resolves.toBeNull();
	});
});

describe('listDistinctSourceImages', () => {
	it('collapses repeat uploads of the same hash into one card', async () => {
		await seedUser(db, 'user-1', 'pubkey-1');
		const mediaId = await seedGenerationWithSource(
			db,
			'a',
			'user-1',
			'https://cdn.example.test/room.jpg',
			HASH_1,
			1000
		);
		await seedGenerationWithSource(
			db,
			'b',
			'user-1',
			'https://cdn.example.test/room.jpg',
			HASH_1,
			2000
		);

		const page = await listDistinctSourceImages(db, 'user-1', 0, 10);

		expect(page).toEqual({
			images: [{ mediaId, createdAt: 2000 }],
			hasMore: false
		});
	});

	// An empty checksum means this source isn't something the user uploaded:
	// once a result exists, every tool submits it as the working image
	// (RequestState#resolveWorkingImageKey) and no hash is attached, so the
	// source media there is a previous generation's own output.
	it('excludes rows whose source was a previous result, not an upload', async () => {
		await seedUser(db, 'user-1', 'pubkey-1');
		// A real upload, mixed in so the exclusion isn't just "everything is empty".
		const uploadMediaId = await seedGenerationWithSource(
			db,
			'upload',
			'user-1',
			'https://cdn.example.test/room.jpg',
			HASH_1,
			500
		);
		// An edit continuing from a previous render result — its checksum is
		// always '' for this mode, even though the row itself is recent.
		await seedGenerationWithSource(
			db,
			'edit-from-result',
			'user-1',
			'https://cdn.example.test/prior-render.webp',
			'',
			2000
		);
		// A legacy, pre-migration upload row — also '', indistinguishable from
		// the case above by design.
		await seedGenerationWithSource(
			db,
			'legacy-upload',
			'user-1',
			'https://cdn.example.test/legacy-room.jpg',
			'',
			1000
		);

		const page = await listDistinctSourceImages(db, 'user-1', 0, 10);

		expect(page).toEqual({
			images: [{ mediaId: uploadMediaId, createdAt: 500 }],
			hasMore: false
		});
	});

	it('never mixes another user’s photos into the page', async () => {
		await seedUser(db, 'user-1', 'pubkey-1');
		await seedUser(db, 'user-2', 'pubkey-2');
		const mediaId = await seedGenerationWithSource(
			db,
			'a',
			'user-1',
			'https://cdn.example.test/mine.jpg',
			HASH_1,
			1000
		);
		await seedGenerationWithSource(
			db,
			'b',
			'user-2',
			'https://cdn.example.test/theirs.jpg',
			HASH_2,
			2000
		);

		const page = await listDistinctSourceImages(db, 'user-1', 0, 10);

		expect(page.images).toEqual([{ mediaId, createdAt: 1000 }]);
	});
});
