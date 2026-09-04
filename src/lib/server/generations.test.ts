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
import { sql } from 'drizzle-orm';
import type { Database } from '$lib/server/db';
import { makeDb } from './testing/d1-shim';
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

// Unlike seedGeneration, lets the caller set source media and checksum directly.
async function seedGenerationWithSource(
	db: Database,
	id: string,
	userId: string,
	sourceUrl: string,
	sourceHash: string,
	createdAt: number
): Promise<void> {
	const resultMediaId = await seedMedia(db, `https://cdn.example.test/${id}.webp`, '');
	const sourceMediaId = await seedMedia(db, sourceUrl, sourceHash);
	await db.run(
		sql`INSERT INTO generations
			(id, user_id, result_media_id, source_media_id, prompt, kind, amount, balance_after, created_at)
			VALUES (${id}, ${userId}, ${resultMediaId}, ${sourceMediaId}, 'cozy', 'render', 1, 10, ${createdAt})`
	);
}

let db: Database;

beforeEach(() => {
	db = makeDb();
	return db.run(
		sql`UPDATE buckets SET url = 'https://cdn.example.test' WHERE name = 'cadbos-uploads'`
	);
});

describe('recordGeneration', () => {
	it('subtracts the real cost and records the image against the same row', async () => {
		await seedUser(db, 'user-1', 'pubkey-1');
		await grantAccess(db, 'user-1', 5);
		const sessionId = await seedSession(db, 'user-1');

		const result = await recordGeneration(db, 'user-1', {
			url: 'https://cdn.example.test/out.webp',
			resultHash: RESULT_HASH,
			sourceUrl: 'https://cdn.example.test/room.jpg',
			sourceHash: HASH_1,
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
			expect.objectContaining({ url: 'https://cdn.example.test/out.webp' })
		]);
	});

	it('isolates credit balances per user', async () => {
		await seedUser(db, 'user-1', 'pubkey-1');
		await seedUser(db, 'user-2', 'pubkey-2');
		await grantAccess(db, 'user-1', 5);
		await grantAccess(db, 'user-2', 5);
		const sessionId = await seedSession(db, 'user-1');

		await recordGeneration(db, 'user-1', {
			url: 'https://cdn.example.test/out.webp',
			resultHash: RESULT_HASH,
			sourceUrl: 'https://cdn.example.test/room.jpg',
			sourceHash: HASH_1,
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
		await seedUser(db, 'user-1', 'pubkey-1');
		await grantAccess(db, 'user-1', 5);
		await expect(listCreditHistory(db, 'user-1')).resolves.toEqual([]);
	});

	it('orders entries most-recent first', async () => {
		await seedUser(db, 'user-1', 'pubkey-1');
		await grantAccess(db, 'user-1', 5);
		const sessionId = await seedSession(db, 'user-1');
		await recordGeneration(db, 'user-1', {
			url: 'https://cdn.example.test/a.webp',
			resultHash: RESULT_HASH,
			sourceUrl: 'https://cdn.example.test/room.jpg',
			sourceHash: HASH_1,
			sessionId,
			prompt: 'cozy',
			kind: 'render',
			amount: 1
		});
		await recordGeneration(db, 'user-1', {
			url: 'https://cdn.example.test/b.webp',
			resultHash: RESULT_HASH,
			sourceUrl: 'https://cdn.example.test/a.webp',
			sourceHash: '',
			sessionId,
			prompt: 'change the sofa',
			kind: 'edit',
			amount: 2
		});

		const history = await listCreditHistory(db, 'user-1');
		expect(history.map((entry) => entry.kind)).toEqual(['edit', 'render']);
	});

	it('rejects an invalid stored generation kind', async () => {
		await seedUser(db, 'user-1', 'pubkey-1');
		await seedGeneration(db, 'invalid-kind', 'user-1', 1000, 'unknown');

		await expect(listCreditHistory(db, 'user-1')).rejects.toThrow(
			'generation invalid-kind has invalid kind'
		);
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
		await recordGeneration(db, 'user-1', {
			url: 'https://cdn.example.test/out.webp',
			resultHash: RESULT_HASH,
			sourceUrl: 'https://cdn.example.test/room.jpg',
			sourceHash: HASH_1,
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
			filename: 'image-1.webp',
			bucketName: 'cadbos-uploads',
			url: 'https://cdn.example.test/image-1.webp',
			sourceUrl: 'https://cdn.example.test/source.jpg',
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
					filename: 'newest.webp',
					bucketName: 'cadbos-uploads',
					url: 'https://cdn.example.test/newest.webp',
					sourceUrl: 'https://cdn.example.test/source.jpg',
					kind: 'render',
					createdAt: 3000
				},
				{
					id: 'middle',
					userId: 'user-1',
					mediaId: expect.any(Number),
					filename: 'middle.webp',
					bucketName: 'cadbos-uploads',
					url: 'https://cdn.example.test/middle.webp',
					sourceUrl: 'https://cdn.example.test/source.jpg',
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

	it('rejects an invalid stored generation kind', async () => {
		await seedUser(db, 'user-1', 'pubkey-1');
		await seedGeneration(db, 'invalid-kind', 'user-1', 1000, 'unknown');

		await expect(listGeneratedImages(db, 'user-1', 0, 10)).rejects.toThrow(
			'generation invalid-kind has invalid kind'
		);
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
		await seedGenerationWithSource(
			db,
			'b',
			'user-1',
			'https://cdn.example.test/room-v2.jpg',
			HASH_1,
			2000
		);

		await expect(findGenerationSourceByHash(db, 'user-1', HASH_1)).resolves.toBe(
			'https://cdn.example.test/room-v2.jpg'
		);
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

		await expect(findGenerationSourceByHash(db, 'user-1', HASH_1)).resolves.toBeNull();
	});

	it('never matches an empty hash', async () => {
		await seedUser(db, 'user-1', 'pubkey-1');
		await seedGeneration(db, 'empty-checksum', 'user-1', 1000);

		await expect(findGenerationSourceByHash(db, 'user-1', '')).resolves.toBeNull();
	});
});

describe('listDistinctSourceImages', () => {
	it('collapses repeat uploads of the same hash into one card', async () => {
		await seedUser(db, 'user-1', 'pubkey-1');
		await seedGenerationWithSource(
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
			images: [{ sourceUrl: 'https://cdn.example.test/room.jpg', createdAt: 2000 }],
			hasMore: false
		});
	});

	// An empty checksum means this source isn't something the user uploaded:
	// #resolveSourceFor never attaches a hash for the
	// 'current-result' source mode (edit/upscale always use it; the other
	// tools do whenever "use the current result" is picked over a fresh
	// photo), so the source media there is a previous generation's own output.
	it('excludes rows whose source was a previous result, not an upload', async () => {
		await seedUser(db, 'user-1', 'pubkey-1');
		// A real upload, mixed in so the exclusion isn't just "everything is empty".
		await seedGenerationWithSource(
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
			images: [{ sourceUrl: 'https://cdn.example.test/room.jpg', createdAt: 500 }],
			hasMore: false
		});
	});

	it('never mixes another user’s photos into the page', async () => {
		await seedUser(db, 'user-1', 'pubkey-1');
		await seedUser(db, 'user-2', 'pubkey-2');
		await seedGenerationWithSource(
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

		expect(page.images).toEqual([
			{ sourceUrl: 'https://cdn.example.test/mine.jpg', createdAt: 1000 }
		]);
	});
});
