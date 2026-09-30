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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { makeD1 } from './testing/d1-shim';
import {
	seedGeneration as seedGenerationFixture,
	TEST_FORM_SNAPSHOT,
	TEST_S3_BUCKET
} from './testing/generation-fixtures';
import { getCredit } from './billing';
import {
	deleteGeneratedImage,
	findGenerationSourceByHash,
	getGeneratedImageForUser,
	getGenerationDetailForUser,
	listCreditHistory,
	getResourceRoles,
	listResourceGenerations,
	listResourceImages,
	listGeneratedImages,
	listSceneFilterProjects,
	getUsageTotals,
	listUserUsage,
	recordGeneration
} from './generations';

const ALL_SCENES = { view: 'iterations', projectId: null, sessionId: null } as const;

const HASH_1 = '1'.repeat(64);
const HASH_2 = '2'.repeat(64);
const RESULT_HASH = 'a'.repeat(64);

function seedUser(db: D1Database, id: string, pubkey: string): void {
	db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind(id, pubkey, Date.now())
		.run();
}

// The admin's manual approval step — no auto-provisioning exists anymore.
function grantAccess(db: D1Database, userId: string, balance: number): void {
	db.prepare('INSERT INTO credits (user_id, balance, updated_at, enabled) VALUES (?, ?, ?, 1)')
		.bind(userId, balance, Date.now())
		.run();
}

// Every generations row now has to attach to a session it belongs to — a minimal
// project+session pair, direct SQL like the other seed helpers here.
function seedSession(db: D1Database, userId: string): string {
	const now = Date.now();
	const projectId = crypto.randomUUID();
	const sessionId = crypto.randomUUID();
	db.prepare(
		'INSERT INTO projects (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
	)
		.bind(projectId, userId, 'Test project', now, now)
		.run();
	db.prepare(
		'INSERT INTO project_sessions (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
	)
		.bind(sessionId, projectId, 'Test session', now, now)
		.run();
	return sessionId;
}

function seedGeneration(
	db: D1Database,
	id: string,
	userId: string,
	createdAt: number,
	kind = 'render'
): void {
	const resultMediaId = seedMedia(db, `https://cdn.example.test/${id}.webp`, '');
	const sourceMediaId = seedMedia(db, 'https://cdn.example.test/source.jpg', '');
	db.prepare(
		'INSERT INTO generations ' +
			'(id, user_id, result_media_id, source_media_id, prompt, kind, amount, balance_after, created_at) ' +
			"VALUES (?, ?, ?, ?, 'cozy', ?, 1, 10, ?)"
	)
		.bind(id, userId, resultMediaId, sourceMediaId, kind, createdAt)
		.run();
}

function seedMedia(
	db: D1Database,
	url: string,
	checksum: string,
	size: number | null = null
): number {
	const filename = new URL(url).pathname.slice(1);
	db.prepare('INSERT OR IGNORE INTO media (filename, bucket, checksum, size) VALUES (?, 1, ?, ?)')
		.bind(filename, checksum, size)
		.run();
	const row = db
		.prepare('SELECT id FROM media WHERE bucket = 1 AND filename = ?')
		.bind(filename)
		.first<{ id: number }>() as unknown as { id: number } | null;
	if (!row) throw new Error('media seed failed');
	return row.id;
}

// Unlike seedGeneration, lets the caller set source media and checksum directly.
function seedGenerationWithSource(
	db: D1Database,
	id: string,
	userId: string,
	sourceUrl: string,
	sourceHash: string,
	createdAt: number
): number {
	const resultMediaId = seedMedia(db, `https://cdn.example.test/${id}.webp`, '');
	const sourceMediaId = seedMedia(db, sourceUrl, sourceHash);
	db.prepare(
		'INSERT INTO generations ' +
			'(id, user_id, result_media_id, source_media_id, prompt, kind, amount, balance_after, created_at) ' +
			"VALUES (?, ?, ?, ?, 'cozy', 'render', 1, 10, ?)"
	)
		.bind(id, userId, resultMediaId, sourceMediaId, createdAt)
		.run();
	return sourceMediaId;
}

// A generation that took an uploaded reference image (migrations/0019).
function seedGenerationWithReference(
	db: D1Database,
	id: string,
	userId: string,
	kind: 'style-transfer' | 'object-replacement' | 'texture-replacement',
	referenceUrl: string,
	createdAt: number
): number {
	const resultMediaId = seedMedia(db, `https://cdn.example.test/${id}.webp`, '');
	const sourceMediaId = seedMedia(db, 'https://cdn.example.test/prior-render.webp', '');
	const referenceMediaId = seedMedia(db, referenceUrl, HASH_2);
	db.prepare(
		'INSERT INTO generations ' +
			'(id, user_id, result_media_id, source_media_id, reference_media_id, prompt, kind, amount, balance_after, created_at) ' +
			"VALUES (?, ?, ?, ?, ?, '', ?, 1, 10, ?)"
	)
		.bind(id, userId, resultMediaId, sourceMediaId, referenceMediaId, kind, createdAt)
		.run();
	return referenceMediaId;
}

let db: D1Database;

beforeEach(() => {
	db = makeD1();
	db.prepare('UPDATE buckets SET url = ? WHERE name = ?')
		.bind('https://cdn.example.test', TEST_S3_BUCKET.name)
		.run();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('recordGeneration', () => {
	it('subtracts the real cost and records the image against the same row', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		grantAccess(db, 'user-1', 5);
		const sessionId = seedSession(db, 'user-1');
		const resultMediaId = seedMedia(db, 'https://cdn.example.test/out.webp', RESULT_HASH);
		const sourceMediaId = seedMedia(db, 'https://cdn.example.test/room.jpg', HASH_1);

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

		const images = await listGeneratedImages(db, 'user-1', ALL_SCENES, 0, 10);
		expect(images.images).toEqual([
			expect.objectContaining({ mediaId: resultMediaId, sourceMediaId })
		]);
	});

	it('keeps the uploaded style reference a style transfer used, for Resources', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		grantAccess(db, 'user-1', 5);
		const sessionId = seedSession(db, 'user-1');
		const resultMediaId = seedMedia(db, 'https://cdn.example.test/out.webp', RESULT_HASH);
		const sourceMediaId = seedMedia(db, 'https://cdn.example.test/room.jpg', HASH_1);
		const referenceMediaId = seedMedia(db, 'https://cdn.example.test/style.jpg', HASH_2);

		await recordGeneration(db, 'user-1', {
			resultMediaId,
			sourceMediaId,
			sessionId,
			prompt: '',
			kind: 'style-transfer',
			amount: 1,
			archaiRenderSec: 0,
			archaiDownloadSec: 0,
			archaiReuploadSec: 0,
			referenceMediaId
		});

		const page = await listResourceImages(db, 'user-1', 'references', 0, 10);
		expect(page.images).toEqual([
			expect.objectContaining({ mediaId: referenceMediaId, roles: ['style-reference'] })
		]);
	});

	it('isolates credit balances per user', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		seedUser(db, 'user-2', 'pubkey-2');
		grantAccess(db, 'user-1', 5);
		grantAccess(db, 'user-2', 5);
		const sessionId = seedSession(db, 'user-1');
		const resultMediaId = seedMedia(db, 'https://cdn.example.test/out.webp', RESULT_HASH);
		const sourceMediaId = seedMedia(db, 'https://cdn.example.test/room.jpg', HASH_1);

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
		seedUser(db, 'user-1', 'pubkey-1');
		grantAccess(db, 'user-1', 5);
		const sessionId = seedSession(db, 'user-1');

		const withSnapshotResultId = seedMedia(db, 'https://cdn.example.test/with.webp', '');
		const sourceMediaId = seedMedia(db, 'https://cdn.example.test/room.jpg', HASH_1);
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
		const withSnapshotRow = await db
			.prepare(
				'SELECT form_snapshot FROM generations WHERE user_id = ? ORDER BY rowid DESC LIMIT 1'
			)
			.bind('user-1')
			.first<{ form_snapshot: string | null }>();
		expect(JSON.parse(withSnapshotRow!.form_snapshot!)).toEqual(TEST_FORM_SNAPSHOT);

		const withoutSnapshotResultId = seedMedia(db, 'https://cdn.example.test/without.webp', '');
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
		const withoutSnapshotRow = await db
			.prepare(
				'SELECT form_snapshot FROM generations WHERE user_id = ? ORDER BY rowid DESC LIMIT 1'
			)
			.bind('user-1')
			.first<{ form_snapshot: string | null }>();
		expect(withoutSnapshotRow!.form_snapshot).toBeNull();
	});
});

describe('getGenerationDetailForUser', () => {
	it('returns the parsed form snapshot alongside the prompt and source media', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		grantAccess(db, 'user-1', 5);
		const sessionId = seedSession(db, 'user-1');
		const resultMediaId = seedMedia(db, 'https://cdn.example.test/out.webp', RESULT_HASH);
		const sourceMediaId = seedMedia(db, 'https://cdn.example.test/room.jpg', HASH_1);
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
		const [{ id }] = (await listGeneratedImages(db, 'user-1', ALL_SCENES, 0, 1)).images;

		const detail = await getGenerationDetailForUser(db, 'user-1', id);

		expect(detail).toEqual({
			id,
			sourceMediaId,
			resultMediaId,
			prompt: 'cozy',
			kind: 'render',
			createdAt: expect.any(Number),
			amount: 1,
			balanceAfter: 4,
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
		seedUser(db, 'user-1', 'pubkey-1');
		const sessionId = seedSession(db, 'user-1');
		seedGeneration(db, 'image-1', 'user-1', 1000);
		db.prepare('UPDATE generations SET session_id = ? WHERE id = ?')
			.bind(sessionId, 'image-1')
			.run();

		expect((await getGenerationDetailForUser(db, 'user-1', 'image-1'))?.session?.sessionId).toBe(
			sessionId
		);

		db.prepare('UPDATE project_sessions SET archived_at = ? WHERE id = ?')
			.bind(Date.now(), sessionId)
			.run();
		expect((await getGenerationDetailForUser(db, 'user-1', 'image-1'))?.session).toBeNull();

		db.prepare('UPDATE project_sessions SET archived_at = NULL WHERE id = ?').bind(sessionId).run();
		db.prepare(
			'UPDATE projects SET archived_at = ? WHERE id = (SELECT project_id FROM project_sessions WHERE id = ?)'
		)
			.bind(Date.now(), sessionId)
			.run();
		expect((await getGenerationDetailForUser(db, 'user-1', 'image-1'))?.session).toBeNull();
	});

	it('returns null for another user’s generation', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		seedUser(db, 'user-2', 'pubkey-2');
		seedGeneration(db, 'image-1', 'user-1', 1000);

		expect(await getGenerationDetailForUser(db, 'user-2', 'image-1')).toBeNull();
	});

	it('degrades to a null snapshot for a row whose stored JSON is malformed', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		seedGeneration(db, 'image-1', 'user-1', 1000);
		db.prepare('UPDATE generations SET form_snapshot = ? WHERE id = ?')
			.bind('{not valid json', 'image-1')
			.run();

		const detail = await getGenerationDetailForUser(db, 'user-1', 'image-1');

		expect(detail?.formSnapshot).toBeNull();
	});

	it('degrades to a null snapshot for a row whose stored JSON no longer matches the shape', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		seedGeneration(db, 'image-1', 'user-1', 1000);
		db.prepare('UPDATE generations SET form_snapshot = ? WHERE id = ?')
			.bind(JSON.stringify({ unrelated: true }), 'image-1')
			.run();

		const detail = await getGenerationDetailForUser(db, 'user-1', 'image-1');

		expect(detail?.formSnapshot).toBeNull();
	});
});

describe('listCreditHistory', () => {
	it('is empty before any generation', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		grantAccess(db, 'user-1', 5);
		await expect(listCreditHistory(db, 'user-1')).resolves.toEqual([]);
	});

	it('orders entries most-recent first', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		grantAccess(db, 'user-1', 5);
		const sessionId = seedSession(db, 'user-1');
		const sourceMediaId = seedMedia(db, 'https://cdn.example.test/room.jpg', HASH_1);
		const firstResultMediaId = seedMedia(db, 'https://cdn.example.test/a.webp', RESULT_HASH);
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
		const secondResultMediaId = seedMedia(db, 'https://cdn.example.test/b.webp', RESULT_HASH);
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
		seedUser(db, 'user-1', 'pubkey-1');
		seedGeneration(db, 'invalid-kind', 'user-1', 1000, 'unknown');
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
		seedUser(db, 'user-1', 'pubkey-1');
		grantAccess(db, 'user-1', 5);
		const sessionId = seedSession(db, 'user-1');
		const projectId = (
			await db
				.prepare('SELECT project_id FROM project_sessions WHERE id = ?')
				.bind(sessionId)
				.first<{ project_id: string }>()
		)?.project_id;
		const resultMediaId = seedMedia(db, 'https://cdn.example.test/out.webp', RESULT_HASH);
		const sourceMediaId = seedMedia(db, 'https://cdn.example.test/room.jpg', HASH_1);
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
		seedUser(db, 'user-1', 'pubkey-1');
		seedGeneration(db, 'invalid-newer', 'user-1', 2000, 'unknown');
		seedGeneration(db, 'valid-older', 'user-1', 1000);
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		const history = await listCreditHistory(db, 'user-1', 1);

		expect(history).toEqual([expect.objectContaining({ id: 'valid-older' })]);
	});

	// A generation predating Module 11 (or otherwise never attached to a
	// session) must not disappear from the history — it just can't be
	// resolved back to a project/session.
	it('leaves sessionId/projectId null for a generation with no session', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		seedGeneration(db, 'no-session', 'user-1', 1000);

		const history = await listCreditHistory(db, 'user-1');
		expect(history).toEqual([expect.objectContaining({ sessionId: null, projectId: null })]);
	});
});

describe('getGeneratedImageForUser', () => {
	it('returns null for an unknown generation id', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		await expect(getGeneratedImageForUser(db, 'user-1', 'no-such-image')).resolves.toBeNull();
	});

	it('returns null when the generation belongs to a different user', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		seedUser(db, 'user-2', 'pubkey-2');
		seedGeneration(db, 'image-1', 'user-2', 1000);

		await expect(getGeneratedImageForUser(db, 'user-1', 'image-1')).resolves.toBeNull();
	});

	it('returns the image for its owner', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		seedGeneration(db, 'image-1', 'user-1', 1000);

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
		seedUser(db, 'user-1', 'pubkey-1');
		seedUser(db, 'user-2', 'pubkey-2');
		seedGeneration(db, 'image-1', 'user-1', 1000);
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
		expect(
			await db.prepare('SELECT id FROM media WHERE id = ?').bind(image.mediaId).first()
		).toBeNull();
	});
});

describe('listGeneratedImages', () => {
	it('returns one user image page in newest-first order', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		seedUser(db, 'user-2', 'pubkey-2');
		seedGeneration(db, 'oldest', 'user-1', 1000);
		seedGeneration(db, 'newest', 'user-1', 3000);
		seedGeneration(db, 'middle', 'user-1', 2000);
		seedGeneration(db, 'other-user-image', 'user-2', 4000);

		const page = await listGeneratedImages(db, 'user-1', ALL_SCENES, 0, 2);

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
					createdAt: 3000,
					session: null,
					iteration: null,
					number: 3
				},
				{
					id: 'middle',
					userId: 'user-1',
					mediaId: expect.any(Number),
					sourceMediaId: expect.any(Number),
					filename: 'middle.webp',
					bucketName: TEST_S3_BUCKET.name,
					kind: 'render',
					createdAt: 2000,
					session: null,
					iteration: null,
					number: 2
				}
			],
			hasMore: true
		});
	});

	it('applies the requested offset', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		seedGeneration(db, 'first', 'user-1', 3000);
		seedGeneration(db, 'second', 'user-1', 2000);
		seedGeneration(db, 'third', 'user-1', 1000);

		const page = await listGeneratedImages(db, 'user-1', ALL_SCENES, 1, 2);

		expect(page.images.map((image) => image.id)).toEqual(['second', 'third']);
		expect(page.hasMore).toBe(false);
	});

	it('skips a row with an unrecognized stored generation kind, logging a warning', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		seedGeneration(db, 'invalid-kind', 'user-1', 1000, 'unknown');
		const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		const page = await listGeneratedImages(db, 'user-1', ALL_SCENES, 0, 10);

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
		seedUser(db, 'user-1', 'pubkey-1');
		seedGeneration(db, 'invalid-1', 'user-1', 6000, 'unknown');
		seedGeneration(db, 'invalid-2', 'user-1', 5000, 'unknown');
		seedGeneration(db, 'invalid-3', 'user-1', 4000, 'unknown');
		seedGeneration(db, 'valid-1', 'user-1', 3000);
		seedGeneration(db, 'valid-2', 'user-1', 2000);
		seedGeneration(db, 'valid-3', 'user-1', 1000);
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		const page = await listGeneratedImages(db, 'user-1', ALL_SCENES, 0, 2);

		expect(page.images.map((image) => image.id)).toEqual(['valid-1', 'valid-2']);
		expect(page.hasMore).toBe(true);
	});
});

interface SeededSession {
	projectId: string;
	sessionId: string;
}

function seedTitledSession(
	db: D1Database,
	userId: string,
	projectTitle: string,
	sessionTitle: string,
	projectId: string = crypto.randomUUID()
): SeededSession {
	const now = Date.now();
	const sessionId = crypto.randomUUID();
	db.prepare(
		'INSERT OR IGNORE INTO projects (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
	)
		.bind(projectId, userId, projectTitle, now, now)
		.run();
	db.prepare(
		'INSERT INTO project_sessions (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
	)
		.bind(sessionId, projectId, sessionTitle, now, now)
		.run();
	return { projectId, sessionId };
}

function seedSceneGeneration(
	db: D1Database,
	id: string,
	sessionId: string | null,
	createdAt: number,
	kind = 'render'
): void {
	seedGenerationFixture(db, {
		id,
		userId: 'user-1',
		url: `https://cdn.example.test/${id}.webp`,
		sourceUrl: `https://cdn.example.test/${id}-source.jpg`,
		createdAt,
		sessionId,
		kind
	});
}

describe('listGeneratedImages filtering', () => {
	let kitchen: SeededSession;
	let kitchenRedo: SeededSession;
	let bedroom: SeededSession;

	beforeEach(() => {
		seedUser(db, 'user-1', 'pubkey-1');
		kitchen = seedTitledSession(db, 'user-1', 'Flat', 'Kitchen');
		kitchenRedo = seedTitledSession(db, 'user-1', 'Flat', 'Kitchen redo', kitchen.projectId);
		bedroom = seedTitledSession(db, 'user-1', 'House', 'Bedroom');
		seedSceneGeneration(db, 'kitchen-1', kitchen.sessionId, 1000);
		seedSceneGeneration(db, 'kitchen-2', kitchen.sessionId, 2000);
		seedSceneGeneration(db, 'kitchen-3', kitchen.sessionId, 3000);
		seedSceneGeneration(db, 'redo-1', kitchenRedo.sessionId, 1500);
		seedSceneGeneration(db, 'bedroom-1', bedroom.sessionId, 2500);
		seedSceneGeneration(db, 'no-session', null, 4000);
	});

	it("carries each scene's live session", async () => {
		const page = await listGeneratedImages(db, 'user-1', ALL_SCENES, 0, 10);

		expect(page.images.map((image) => [image.id, image.session?.sessionTitle ?? null])).toEqual([
			['no-session', null],
			['kitchen-3', 'Kitchen'],
			['bedroom-1', 'Bedroom'],
			['kitchen-2', 'Kitchen'],
			['redo-1', 'Kitchen redo'],
			['kitchen-1', 'Kitchen']
		]);
		expect(page.images.map((image) => image.iteration)).toEqual([null, 3, 1, 2, 1, 1]);
		expect(page.images.map((image) => image.number)).toEqual([6, 5, 4, 3, 2, 1]);
		expect(page.images[1].session).toEqual({
			projectId: kitchen.projectId,
			projectTitle: 'Flat',
			sessionId: kitchen.sessionId,
			sessionTitle: 'Kitchen'
		});
	});

	it('narrows every step to a project, then to one of its sessions', async () => {
		const project = await listGeneratedImages(
			db,
			'user-1',
			{ view: 'iterations', projectId: kitchen.projectId, sessionId: null },
			0,
			10
		);
		const session = await listGeneratedImages(
			db,
			'user-1',
			{ view: 'iterations', projectId: kitchen.projectId, sessionId: kitchenRedo.sessionId },
			0,
			10
		);

		expect(project.images.map((image) => image.id)).toEqual([
			'kitchen-3',
			'kitchen-2',
			'redo-1',
			'kitchen-1'
		]);
		expect(session.images.map((image) => image.id)).toEqual(['redo-1']);
		expect(project.images.map((image) => image.number)).toEqual([4, 3, 2, 1]);
		expect(session.images.map((image) => image.number)).toEqual([1]);
	});

	it('collapses each live session to its first source and latest result', async () => {
		const page = await listGeneratedImages(
			db,
			'user-1',
			{ view: 'milestones', projectId: null, sessionId: null },
			0,
			10
		);
		const firstKitchen = await getGeneratedImageForUser(db, 'user-1', 'kitchen-1');

		expect(page.images.map((image) => image.id)).toEqual(['kitchen-3', 'bedroom-1', 'redo-1']);
		expect(page.images.map((image) => image.number)).toEqual([3, 2, 1]);
		expect(page.images[0]).toMatchObject({
			filename: 'kitchen-3.webp',
			sourceMediaId: firstKitchen?.sourceMediaId,
			iteration: 3,
			session: { sessionId: kitchen.sessionId }
		});
	});

	it('picks the latest recognized kind as a session milestone and pages sessions', async () => {
		seedSceneGeneration(db, 'kitchen-unknown', kitchen.sessionId, 5000, 'unknown');

		const first = await listGeneratedImages(
			db,
			'user-1',
			{ view: 'milestones', projectId: kitchen.projectId, sessionId: null },
			0,
			1
		);
		const second = await listGeneratedImages(
			db,
			'user-1',
			{ view: 'milestones', projectId: kitchen.projectId, sessionId: null },
			1,
			1
		);

		expect(first).toMatchObject({ images: [{ id: 'kitchen-3' }], hasMore: true });
		expect(second).toMatchObject({ images: [{ id: 'redo-1' }], hasMore: false });
		expect([first.images[0].number, second.images[0].number]).toEqual([2, 1]);
	});

	it('leaves archived sessions and projects out of filters and milestones', async () => {
		db.prepare('UPDATE project_sessions SET archived_at = 1 WHERE id = ?')
			.bind(kitchenRedo.sessionId)
			.run();
		db.prepare('UPDATE projects SET archived_at = 1 WHERE id = ?').bind(bedroom.projectId).run();

		const milestones = await listGeneratedImages(
			db,
			'user-1',
			{ view: 'milestones', projectId: null, sessionId: null },
			0,
			10
		);
		const archivedSession = await listGeneratedImages(
			db,
			'user-1',
			{ view: 'iterations', projectId: kitchen.projectId, sessionId: kitchenRedo.sessionId },
			0,
			10
		);

		expect(milestones.images.map((image) => image.id)).toEqual(['kitchen-3']);
		expect(archivedSession.images).toEqual([]);
	});
});

describe('listSceneFilterProjects', () => {
	it('lists live projects and sessions with generations, most recently generated first', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		seedUser(db, 'user-2', 'pubkey-2');
		const kitchen = seedTitledSession(db, 'user-1', 'Flat', 'Kitchen');
		const hall = seedTitledSession(db, 'user-1', 'Flat', 'Hall', kitchen.projectId);
		const bedroom = seedTitledSession(db, 'user-1', 'House', 'Bedroom');
		const archived = seedTitledSession(db, 'user-1', 'House', 'Attic', bedroom.projectId);
		seedTitledSession(db, 'user-1', 'Empty', 'Nothing yet');
		seedSceneGeneration(db, 'kitchen-1', kitchen.sessionId, 1000);
		seedSceneGeneration(db, 'hall-1', hall.sessionId, 3000);
		seedSceneGeneration(db, 'bedroom-1', bedroom.sessionId, 2000);
		seedSceneGeneration(db, 'attic-1', archived.sessionId, 4000);
		db.prepare('UPDATE project_sessions SET archived_at = 1 WHERE id = ?')
			.bind(archived.sessionId)
			.run();

		await expect(listSceneFilterProjects(db, 'user-1')).resolves.toEqual([
			{
				projectId: kitchen.projectId,
				projectTitle: 'Flat',
				sessions: [
					{ sessionId: hall.sessionId, sessionTitle: 'Hall' },
					{ sessionId: kitchen.sessionId, sessionTitle: 'Kitchen' }
				]
			},
			{
				projectId: bedroom.projectId,
				projectTitle: 'House',
				sessions: [{ sessionId: bedroom.sessionId, sessionTitle: 'Bedroom' }]
			}
		]);
		await expect(listSceneFilterProjects(db, 'user-2')).resolves.toEqual([]);
	});
});

describe('findGenerationSourceByHash', () => {
	it('returns the most recent source media URL for a matching hash', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		seedGenerationWithSource(
			db,
			'a',
			'user-1',
			'https://cdn.example.test/room-v1.jpg',
			HASH_1,
			1000
		);
		const expectedMediaId = seedGenerationWithSource(
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
		seedUser(db, 'user-1', 'pubkey-1');
		seedUser(db, 'user-2', 'pubkey-2');
		seedGenerationWithSource(db, 'a', 'user-2', 'https://cdn.example.test/room.jpg', HASH_1, 1000);

		await expect(
			findGenerationSourceByHash(db, 'user-1', HASH_1, TEST_S3_BUCKET.name)
		).resolves.toBeNull();
	});

	it('never matches an empty hash', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		seedGeneration(db, 'empty-checksum', 'user-1', 1000);

		await expect(
			findGenerationSourceByHash(db, 'user-1', '', TEST_S3_BUCKET.name)
		).resolves.toBeNull();
	});
});

describe('listResourceImages', () => {
	it('collapses repeat uploads of the same hash into one card', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		const mediaId = seedGenerationWithSource(
			db,
			'a',
			'user-1',
			'https://cdn.example.test/room.jpg',
			HASH_1,
			1000
		);
		seedGenerationWithSource(db, 'b', 'user-1', 'https://cdn.example.test/room.jpg', HASH_1, 2000);

		const page = await listResourceImages(db, 'user-1', 'sources', 0, 10);

		expect(page).toEqual({
			images: [{ mediaId, createdAt: 2000, roles: ['source'] }],
			hasMore: false
		});
	});

	// An empty checksum means this source isn't something the user uploaded:
	// once a result exists, every tool submits it as the working image
	// (RequestState#resolveWorkingImageKey) and no hash is attached, so the
	// source media there is a previous generation's own output.
	it('excludes rows whose source was a previous result, not an upload', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		// A real upload, mixed in so the exclusion isn't just "everything is empty".
		const uploadMediaId = seedGenerationWithSource(
			db,
			'upload',
			'user-1',
			'https://cdn.example.test/room.jpg',
			HASH_1,
			500
		);
		// An edit continuing from a previous render result — its checksum is
		// always '' for this mode, even though the row itself is recent.
		seedGenerationWithSource(
			db,
			'edit-from-result',
			'user-1',
			'https://cdn.example.test/prior-render.webp',
			'',
			2000
		);
		// A legacy, pre-migration upload row — also '', indistinguishable from
		// the case above by design.
		seedGenerationWithSource(
			db,
			'legacy-upload',
			'user-1',
			'https://cdn.example.test/legacy-room.jpg',
			'',
			1000
		);

		const page = await listResourceImages(db, 'user-1', 'sources', 0, 10);

		expect(page).toEqual({
			images: [{ mediaId: uploadMediaId, createdAt: 500, roles: ['source'] }],
			hasMore: false
		});
	});

	it('never mixes another user’s photos into the page', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		seedUser(db, 'user-2', 'pubkey-2');
		const mediaId = seedGenerationWithSource(
			db,
			'a',
			'user-1',
			'https://cdn.example.test/mine.jpg',
			HASH_1,
			1000
		);
		seedGenerationWithSource(
			db,
			'b',
			'user-2',
			'https://cdn.example.test/theirs.jpg',
			HASH_2,
			2000
		);

		seedGenerationWithReference(
			db,
			'c',
			'user-2',
			'object-replacement',
			'https://cdn.example.test/their-chair.png',
			3000
		);

		const page = await listResourceImages(db, 'user-1', 'all', 0, 10);

		expect(page.images).toEqual([{ mediaId, createdAt: 1000, roles: ['source'] }]);
	});

	it('lists each reference under the tool that took it', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		const style = seedGenerationWithReference(
			db,
			'style',
			'user-1',
			'style-transfer',
			'https://cdn.example.test/style.jpg',
			3000
		);
		const chair = seedGenerationWithReference(
			db,
			'object',
			'user-1',
			'object-replacement',
			'https://cdn.example.test/chair.png',
			2000
		);
		const wood = seedGenerationWithReference(
			db,
			'texture',
			'user-1',
			'texture-replacement',
			'https://cdn.example.test/wood.png',
			1000
		);
		seedGenerationWithSource(
			db,
			'render',
			'user-1',
			'https://cdn.example.test/room.jpg',
			HASH_1,
			4000
		);

		const page = await listResourceImages(db, 'user-1', 'references', 0, 10);

		expect(page.images).toEqual([
			{ mediaId: style, createdAt: 3000, roles: ['style-reference'] },
			{ mediaId: chair, createdAt: 2000, roles: ['object-reference'] },
			{ mediaId: wood, createdAt: 1000, roles: ['texture-reference'] }
		]);
	});

	it('shows an image used both as a source and a reference once, with both roles', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		const room = seedGenerationWithSource(
			db,
			'render',
			'user-1',
			'https://cdn.example.test/room.jpg',
			HASH_1,
			1000
		);
		const reference = seedGenerationWithReference(
			db,
			'texture',
			'user-1',
			'texture-replacement',
			'https://cdn.example.test/room.jpg',
			2000
		);
		expect(reference).toBe(room);

		const all = await listResourceImages(db, 'user-1', 'all', 0, 10);
		const sources = await listResourceImages(db, 'user-1', 'sources', 0, 10);
		const references = await listResourceImages(db, 'user-1', 'references', 0, 10);

		expect(all.images).toHaveLength(1);
		expect(all.images[0]).toMatchObject({ mediaId: room, createdAt: 2000 });
		expect([...all.images[0].roles].sort()).toEqual(['source', 'texture-reference']);
		expect(sources.images).toEqual([{ mediaId: room, createdAt: 1000, roles: ['source'] }]);
		expect(references.images).toEqual([
			{ mediaId: room, createdAt: 2000, roles: ['texture-reference'] }
		]);
	});

	it('pages across sources and references together', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		seedGenerationWithSource(
			db,
			'render',
			'user-1',
			'https://cdn.example.test/room.jpg',
			HASH_1,
			1000
		);
		const chair = seedGenerationWithReference(
			db,
			'object',
			'user-1',
			'object-replacement',
			'https://cdn.example.test/chair.png',
			2000
		);

		const first = await listResourceImages(db, 'user-1', 'all', 0, 1);

		expect(first).toEqual({
			images: [{ mediaId: chair, createdAt: 2000, roles: ['object-reference'] }],
			hasMore: true
		});
	});
});

describe('resource page queries', () => {
	// A render from `sourceUrl` that then fed a texture replacement using the
	// same image as its reference, in a real session — the shape a resource
	// page has to untangle.
	function seedSessionGeneration(
		id: string,
		userId: string,
		sessionId: string | null,
		columns: { source: number; reference?: number; kind: string; createdAt: number }
	): void {
		const resultMediaId = seedMedia(db, `https://cdn.example.test/${id}.webp`, '');
		db.prepare(
			'INSERT INTO generations ' +
				'(id, user_id, result_media_id, source_media_id, reference_media_id, prompt, kind, amount, balance_after, created_at, session_id) ' +
				"VALUES (?, ?, ?, ?, ?, '', ?, 1, 10, ?, ?)"
		)
			.bind(
				id,
				userId,
				resultMediaId,
				columns.source,
				columns.reference ?? null,
				columns.kind,
				columns.createdAt,
				sessionId
			)
			.run();
	}

	it('lists every generation an image took part in, with how it was used and where', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		const sessionId = seedSession(db, 'user-1');
		const room = seedMedia(db, 'https://cdn.example.test/room.jpg', HASH_1);
		const prior = seedMedia(db, 'https://cdn.example.test/prior.webp', '');
		seedSessionGeneration('render', 'user-1', sessionId, {
			source: room,
			kind: 'render',
			createdAt: 1000
		});
		seedSessionGeneration('texture', 'user-1', sessionId, {
			source: prior,
			reference: room,
			kind: 'texture-replacement',
			createdAt: 2000
		});
		seedSessionGeneration('unrelated', 'user-1', sessionId, {
			source: prior,
			kind: 'render',
			createdAt: 3000
		});

		expect([...(await getResourceRoles(db, 'user-1', room))].sort()).toEqual([
			'source',
			'texture-reference'
		]);
		const page = await listResourceGenerations(db, 'user-1', room, 0, 10);

		expect(page.hasMore).toBe(false);
		expect(page.generations).toEqual([
			expect.objectContaining({
				id: 'texture',
				kind: 'texture-replacement',
				createdAt: 2000,
				roles: ['texture-reference'],
				session: {
					projectId: expect.any(String),
					projectTitle: 'Test project',
					sessionId,
					sessionTitle: 'Test session'
				}
			}),
			expect.objectContaining({ id: 'render', kind: 'render', roles: ['source'] })
		]);
	});

	it('tells generations whose settings were saved apart from older ones', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		const sessionId = seedSession(db, 'user-1');
		const room = seedMedia(db, 'https://cdn.example.test/room.jpg', HASH_1);
		seedSessionGeneration('legacy', 'user-1', sessionId, {
			source: room,
			kind: 'render',
			createdAt: 1000
		});
		seedSessionGeneration('upscaled', 'user-1', sessionId, {
			source: room,
			kind: 'upscale',
			createdAt: 2000
		});
		seedSessionGeneration('recent', 'user-1', sessionId, {
			source: room,
			kind: 'render',
			createdAt: 3000
		});
		db.prepare('UPDATE generations SET form_snapshot = ? WHERE id = ?')
			.bind(JSON.stringify(TEST_FORM_SNAPSHOT), 'recent')
			.run();

		const page = await listResourceGenerations(db, 'user-1', room, 0, 10);

		expect(page.generations.map(({ id, settingsSaved }) => ({ id, settingsSaved }))).toEqual([
			{ id: 'recent', settingsSaved: true },
			// An upscale has no settings to lose.
			{ id: 'upscaled', settingsSaved: true },
			{ id: 'legacy', settingsSaved: false }
		]);
	});

	it('leaves nothing to open once the generation’s session is archived', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		const sessionId = seedSession(db, 'user-1');
		const room = seedMedia(db, 'https://cdn.example.test/room.jpg', HASH_1);
		seedSessionGeneration('render', 'user-1', sessionId, {
			source: room,
			kind: 'render',
			createdAt: 1000
		});
		db.prepare('UPDATE project_sessions SET archived_at = 1 WHERE id = ?').bind(sessionId).run();

		const page = await listResourceGenerations(db, 'user-1', room, 0, 10);

		expect(page.generations).toEqual([expect.objectContaining({ id: 'render', session: null })]);
	});

	it('treats another user’s image as not a resource at all', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		seedUser(db, 'user-2', 'pubkey-2');
		const theirs = seedGenerationWithSource(
			db,
			'theirs',
			'user-2',
			'https://cdn.example.test/theirs.jpg',
			HASH_2,
			1000
		);

		expect(await getResourceRoles(db, 'user-1', theirs)).toEqual([]);
		expect((await listResourceGenerations(db, 'user-1', theirs, 0, 10)).generations).toEqual([]);
	});

	it('pages through the generations newest first', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		const sessionId = seedSession(db, 'user-1');
		const room = seedMedia(db, 'https://cdn.example.test/room.jpg', HASH_1);
		for (const [id, createdAt] of [
			['a', 1000],
			['b', 2000],
			['c', 3000]
		] as const) {
			seedSessionGeneration(id, 'user-1', sessionId, { source: room, kind: 'render', createdAt });
		}

		const first = await listResourceGenerations(db, 'user-1', room, 0, 2);
		const second = await listResourceGenerations(db, 'user-1', room, 2, 2);

		expect(first.generations.map((generation) => generation.id)).toEqual(['c', 'b']);
		expect(first.hasMore).toBe(true);
		expect(second.generations.map((generation) => generation.id)).toEqual(['a']);
		expect(second.hasMore).toBe(false);
	});
});

function seedProject(db: D1Database, userId: string, archivedAt: number | null = null): string {
	const now = Date.now();
	const id = crypto.randomUUID();
	db.prepare(
		'INSERT INTO projects (id, user_id, title, created_at, updated_at, archived_at) ' +
			'VALUES (?, ?, ?, ?, ?, ?)'
	)
		.bind(id, userId, 'Project', now, now, archivedAt)
		.run();
	return id;
}

function seedProjectSession(
	db: D1Database,
	projectId: string,
	archivedAt: number | null = null
): void {
	const now = Date.now();
	db.prepare(
		'INSERT INTO project_sessions (id, project_id, title, created_at, updated_at, archived_at) ' +
			'VALUES (?, ?, ?, ?, ?, ?)'
	)
		.bind(crypto.randomUUID(), projectId, 'Session', now, now, archivedAt)
		.run();
}

// 'processing' is the only status whose CHECK constraint allows leaving
// output_media_id/error_code/balance_after/completed_at all null — the
// job's outcome is irrelevant to a reference-image count.
function seedReplacementJob(
	db: D1Database,
	table: 'object_replacement_jobs' | 'texture_replacement_jobs',
	userId: string,
	referenceMediaId: number
): void {
	const now = Date.now();
	const sceneMediaId = seedMedia(
		db,
		`https://cdn.example.test/scene-${crypto.randomUUID()}.jpg`,
		''
	);
	const descriptionColumn =
		table === 'object_replacement_jobs' ? 'replacement_object' : 'replacement_surface';
	db.prepare(
		`INSERT INTO ${table} ` +
			`(id, user_id, comfy_prompt_id, scene_media_id, reference_media_id, ${descriptionColumn}, ` +
			"cost, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'x', 1, 'processing', ?, ?)"
	)
		.bind(
			crypto.randomUUID(),
			userId,
			crypto.randomUUID(),
			sceneMediaId,
			referenceMediaId,
			now,
			now
		)
		.run();
}

describe('listUserUsage', () => {
	it('returns zero counts for a fresh user with no data', async () => {
		seedUser(db, 'user-1', 'pubkey-1');

		const page = await listUserUsage(db, 0, 10);

		expect(page.users).toEqual([
			expect.objectContaining({
				pubkey: 'pubkey-1',
				projectCount: 0,
				sessionCount: 0,
				generationCount: 0,
				sourceCount: 0,
				sourceBytes: null,
				referenceCount: 0,
				referenceBytes: null
			})
		]);
	});

	it('counts projects and sessions including archived ones', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		const activeProject = seedProject(db, 'user-1');
		seedProjectSession(db, activeProject);
		const archivedProject = seedProject(db, 'user-1', Date.now());
		seedProjectSession(db, archivedProject, Date.now());

		const page = await listUserUsage(db, 0, 10);

		expect(page.users).toEqual([expect.objectContaining({ projectCount: 2, sessionCount: 2 })]);
	});

	it('counts each distinct source media once per user', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		seedGenerationWithSource(db, 'a', 'user-1', 'https://cdn.example.test/room.jpg', HASH_1, 1000);
		seedGenerationWithSource(db, 'b', 'user-1', 'https://cdn.example.test/room.jpg', HASH_1, 2000);

		const page = await listUserUsage(db, 0, 10);

		expect(page.users).toEqual([expect.objectContaining({ generationCount: 2, sourceCount: 1 })]);
	});

	it('counts references from replacement jobs and style-transfer generations, de-duplicated', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		const referenceMediaId = seedMedia(db, 'https://cdn.example.test/ref.jpg', '');
		seedReplacementJob(db, 'object_replacement_jobs', 'user-1', referenceMediaId);
		seedReplacementJob(db, 'texture_replacement_jobs', 'user-1', referenceMediaId);
		seedGenerationWithReference(
			db,
			'reused',
			'user-1',
			'object-replacement',
			'https://cdn.example.test/ref.jpg',
			1000
		);
		seedGenerationWithReference(
			db,
			'style',
			'user-1',
			'style-transfer',
			'https://cdn.example.test/style-ref.jpg',
			2000
		);

		const page = await listUserUsage(db, 0, 10);

		expect(page.users).toEqual([expect.objectContaining({ referenceCount: 2 })]);
	});

	it('totals source bytes over distinct media, skipping unknown sizes', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		seedMedia(db, 'https://cdn.example.test/room.jpg', HASH_1, 1000);
		seedMedia(db, 'https://cdn.example.test/hall.jpg', HASH_2, 500);
		seedMedia(db, 'https://cdn.example.test/legacy.jpg', RESULT_HASH, null);
		seedGenerationWithSource(db, 'a', 'user-1', 'https://cdn.example.test/room.jpg', HASH_1, 1000);
		seedGenerationWithSource(db, 'b', 'user-1', 'https://cdn.example.test/room.jpg', HASH_1, 2000);
		seedGenerationWithSource(db, 'c', 'user-1', 'https://cdn.example.test/hall.jpg', HASH_2, 3000);
		seedGenerationWithSource(
			db,
			'd',
			'user-1',
			'https://cdn.example.test/legacy.jpg',
			RESULT_HASH,
			4000
		);

		const page = await listUserUsage(db, 0, 10);

		expect(page.users).toEqual([
			expect.objectContaining({ sourceCount: 3, sourceBytes: 1500, referenceBytes: null })
		]);
	});

	it('reports null source bytes when no source size is known', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		seedGenerationWithSource(db, 'a', 'user-1', 'https://cdn.example.test/room.jpg', HASH_1, 1000);

		const page = await listUserUsage(db, 0, 10);

		expect(page.users).toEqual([expect.objectContaining({ sourceCount: 1, sourceBytes: null })]);
	});

	it('totals reference bytes over distinct references, including style-transfer', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		const sharedReferenceId = seedMedia(db, 'https://cdn.example.test/ref.jpg', '', 700);
		const textureReferenceId = seedMedia(db, 'https://cdn.example.test/texture.jpg', '', 300);
		seedMedia(db, 'https://cdn.example.test/style-ref.jpg', HASH_2, 200);
		seedReplacementJob(db, 'object_replacement_jobs', 'user-1', sharedReferenceId);
		seedReplacementJob(db, 'texture_replacement_jobs', 'user-1', sharedReferenceId);
		seedReplacementJob(db, 'texture_replacement_jobs', 'user-1', textureReferenceId);
		seedGenerationWithReference(
			db,
			'style',
			'user-1',
			'style-transfer',
			'https://cdn.example.test/style-ref.jpg',
			1000
		);

		const page = await listUserUsage(db, 0, 10);

		expect(page.users).toEqual([
			expect.objectContaining({ referenceCount: 3, referenceBytes: 1200 })
		]);
	});

	it("does not count another user's size for a media both users reference", async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		seedUser(db, 'user-2', 'pubkey-2');
		const sharedReferenceId = seedMedia(db, 'https://cdn.example.test/ref.jpg', '', 700);
		seedReplacementJob(db, 'object_replacement_jobs', 'user-1', sharedReferenceId);

		const page = await listUserUsage(db, 0, 10);

		const byPubkey = Object.fromEntries(page.users.map((user) => [user.pubkey, user]));
		expect(byPubkey['pubkey-1']).toEqual(expect.objectContaining({ referenceBytes: 700 }));
		expect(byPubkey['pubkey-2']).toEqual(expect.objectContaining({ referenceBytes: null }));
	});

	it('isolates counts per user', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		seedUser(db, 'user-2', 'pubkey-2');
		seedProject(db, 'user-1');
		seedGeneration(db, 'a', 'user-2', 1000);

		const page = await listUserUsage(db, 0, 10);

		const byPubkey = Object.fromEntries(page.users.map((user) => [user.pubkey, user]));
		expect(byPubkey['pubkey-1']).toEqual(
			expect.objectContaining({ projectCount: 1, generationCount: 0 })
		);
		expect(byPubkey['pubkey-2']).toEqual(
			expect.objectContaining({ projectCount: 0, generationCount: 1 })
		);
	});
});

describe('getUsageTotals', () => {
	it('returns zeros and null sizes on an empty database', async () => {
		expect(await getUsageTotals(db)).toEqual({
			userCount: 0,
			projectCount: 0,
			sessionCount: 0,
			generationCount: 0,
			sourceCount: 0,
			sourceBytes: null,
			referenceCount: 0,
			referenceBytes: null,
			totalSpend: 0
		});
	});

	it('totals users, projects, sessions and spend across all users, archived included', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		seedUser(db, 'user-2', 'pubkey-2');
		seedUser(db, 'user-3', 'pubkey-3');
		const active = seedProject(db, 'user-1');
		seedProjectSession(db, active);
		const archived = seedProject(db, 'user-2', Date.now());
		seedProjectSession(db, archived, Date.now());
		seedGeneration(db, 'a', 'user-1', 1000);
		seedGeneration(db, 'b', 'user-2', 2000);

		expect(await getUsageTotals(db)).toEqual(
			expect.objectContaining({
				userCount: 3,
				projectCount: 2,
				sessionCount: 2,
				generationCount: 2,
				totalSpend: 2
			})
		);
	});

	it('counts sources and sizes per distinct (user, media), skipping unknown sizes', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		seedUser(db, 'user-2', 'pubkey-2');
		seedMedia(db, 'https://cdn.example.test/room.jpg', HASH_1, 1000);
		seedMedia(db, 'https://cdn.example.test/legacy.jpg', RESULT_HASH, null);
		seedGenerationWithSource(db, 'a', 'user-1', 'https://cdn.example.test/room.jpg', HASH_1, 1000);
		seedGenerationWithSource(db, 'b', 'user-1', 'https://cdn.example.test/room.jpg', HASH_1, 2000);
		seedGenerationWithSource(db, 'c', 'user-2', 'https://cdn.example.test/room.jpg', HASH_1, 3000);
		seedGenerationWithSource(
			db,
			'd',
			'user-2',
			'https://cdn.example.test/legacy.jpg',
			RESULT_HASH,
			4000
		);

		expect(await getUsageTotals(db)).toEqual(
			expect.objectContaining({ sourceCount: 3, sourceBytes: 2000, referenceBytes: null })
		);
	});

	it('counts references from replacement jobs and style-transfer, once per user and media', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		seedUser(db, 'user-2', 'pubkey-2');
		const sharedId = seedMedia(db, 'https://cdn.example.test/ref.jpg', '', 700);
		seedMedia(db, 'https://cdn.example.test/style-ref.jpg', HASH_2, 200);
		seedReplacementJob(db, 'object_replacement_jobs', 'user-1', sharedId);
		seedReplacementJob(db, 'texture_replacement_jobs', 'user-1', sharedId);
		seedReplacementJob(db, 'object_replacement_jobs', 'user-2', sharedId);
		seedGenerationWithReference(
			db,
			'style',
			'user-1',
			'style-transfer',
			'https://cdn.example.test/style-ref.jpg',
			1000
		);

		expect(await getUsageTotals(db)).toEqual(
			expect.objectContaining({ referenceCount: 3, referenceBytes: 1600 })
		);
	});

	it('equals the sum of the per-user usage rows', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		seedUser(db, 'user-2', 'pubkey-2');
		seedProjectSession(db, seedProject(db, 'user-1'));
		seedMedia(db, 'https://cdn.example.test/room.jpg', HASH_1, 1000);
		seedGenerationWithSource(db, 'a', 'user-1', 'https://cdn.example.test/room.jpg', HASH_1, 1000);
		seedGenerationWithSource(db, 'b', 'user-2', 'https://cdn.example.test/room.jpg', HASH_1, 2000);
		seedGenerationWithReference(
			db,
			'style',
			'user-2',
			'style-transfer',
			'https://cdn.example.test/style-ref.jpg',
			3000
		);

		const { users } = await listUserUsage(db, 0, 10);
		const totals = await getUsageTotals(db);

		const sum = (pick: (user: (typeof users)[number]) => number | null): number =>
			users.reduce((total, user) => total + (pick(user) ?? 0), 0);
		expect(totals).toEqual({
			userCount: users.length,
			projectCount: sum((user) => user.projectCount),
			sessionCount: sum((user) => user.sessionCount),
			generationCount: sum((user) => user.generationCount),
			sourceCount: sum((user) => user.sourceCount),
			sourceBytes: sum((user) => user.sourceBytes),
			referenceCount: sum((user) => user.referenceCount),
			referenceBytes: null,
			totalSpend: sum((user) => user.totalSpend)
		});
	});
});
