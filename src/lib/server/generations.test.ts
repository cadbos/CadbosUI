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
import { getCredit } from './billing';
import {
	deleteGeneratedImage,
	findGenerationSourceByHash,
	getGeneratedImageForUser,
	listCreditHistory,
	listDistinctSourceImages,
	listGeneratedImages,
	recordGeneration
} from './generations';

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

function seedMedia(db: D1Database, url: string, checksum: string): number {
	const filename = new URL(url).pathname.slice(1);
	db.prepare('INSERT OR IGNORE INTO media (filename, bucket, checksum) VALUES (?, 1, ?)')
		.bind(filename, checksum)
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

let db: D1Database;

beforeEach(() => {
	db = makeD1();
	db.prepare(
		"UPDATE buckets SET url = 'https://cdn.example.test' WHERE name = 'cadbos-uploads'"
	).run();
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
			amount: 1.5
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
			amount: 2
		});

		expect((await getCredit(db, 'user-1'))?.balance).toBe(3);
		expect((await getCredit(db, 'user-2'))?.balance).toBe(5);
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
			amount: 1
		});
		const secondResultMediaId = seedMedia(db, 'https://cdn.example.test/b.webp', RESULT_HASH);
		await recordGeneration(db, 'user-1', {
			resultMediaId: secondResultMediaId,
			sourceMediaId: firstResultMediaId,
			sessionId,
			prompt: 'change the sofa',
			kind: 'edit',
			amount: 2
		});

		const history = await listCreditHistory(db, 'user-1');
		expect(history.map((entry) => entry.kind)).toEqual(['edit', 'render']);
	});

	it('rejects an invalid stored generation kind', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		seedGeneration(db, 'invalid-kind', 'user-1', 1000, 'unknown');

		await expect(listCreditHistory(db, 'user-1')).rejects.toThrow(
			'generation invalid-kind has invalid kind'
		);
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
			amount: 1
		});

		const history = await listCreditHistory(db, 'user-1');
		expect(history).toEqual([expect.objectContaining({ sessionId, projectId })]);
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
			bucketName: 'cadbos-uploads',
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

		const page = await listGeneratedImages(db, 'user-1', 0, 2);

		expect(page).toEqual({
			images: [
				{
					id: 'newest',
					userId: 'user-1',
					mediaId: expect.any(Number),
					sourceMediaId: expect.any(Number),
					filename: 'newest.webp',
					bucketName: 'cadbos-uploads',
					kind: 'render',
					createdAt: 3000
				},
				{
					id: 'middle',
					userId: 'user-1',
					mediaId: expect.any(Number),
					sourceMediaId: expect.any(Number),
					filename: 'middle.webp',
					bucketName: 'cadbos-uploads',
					kind: 'render',
					createdAt: 2000
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

		const page = await listGeneratedImages(db, 'user-1', 1, 2);

		expect(page.images.map((image) => image.id)).toEqual(['second', 'third']);
		expect(page.hasMore).toBe(false);
	});

	it('rejects an invalid stored generation kind', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		seedGeneration(db, 'invalid-kind', 'user-1', 1000, 'unknown');

		await expect(listGeneratedImages(db, 'user-1', 0, 10)).rejects.toThrow(
			'generation invalid-kind has invalid kind'
		);
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

		await expect(findGenerationSourceByHash(db, 'user-1', HASH_1)).resolves.toBe(expectedMediaId);
	});

	it('never matches across users', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		seedUser(db, 'user-2', 'pubkey-2');
		seedGenerationWithSource(db, 'a', 'user-2', 'https://cdn.example.test/room.jpg', HASH_1, 1000);

		await expect(findGenerationSourceByHash(db, 'user-1', HASH_1)).resolves.toBeNull();
	});

	it('never matches an empty hash', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		seedGeneration(db, 'empty-checksum', 'user-1', 1000);

		await expect(findGenerationSourceByHash(db, 'user-1', '')).resolves.toBeNull();
	});
});

describe('listDistinctSourceImages', () => {
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

		const page = await listDistinctSourceImages(db, 'user-1', 0, 10);

		expect(page).toEqual({
			images: [{ mediaId, createdAt: 2000 }],
			hasMore: false
		});
	});

	// An empty checksum means this source isn't something the user uploaded:
	// #resolveSourceFor never attaches a hash for the
	// 'current-result' source mode (edit/upscale always use it; the other
	// tools do whenever "use the current result" is picked over a fresh
	// photo), so the source media there is a previous generation's own output.
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

		const page = await listDistinctSourceImages(db, 'user-1', 0, 10);

		expect(page).toEqual({
			images: [{ mediaId: uploadMediaId, createdAt: 500 }],
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

		const page = await listDistinctSourceImages(db, 'user-1', 0, 10);

		expect(page.images).toEqual([{ mediaId, createdAt: 1000 }]);
	});
});
