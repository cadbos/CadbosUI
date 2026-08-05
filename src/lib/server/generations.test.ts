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

function seedGeneration(
	db: D1Database,
	id: string,
	userId: string,
	createdAt: number,
	kind = 'render'
): void {
	db.prepare(
		'INSERT INTO generations ' +
			'(id, user_id, url, source_url, prompt, kind, amount, balance_after, created_at) ' +
			"VALUES (?, ?, ?, 'https://cdn.example.test/source.jpg', 'cozy', ?, 1, 10, ?)"
	)
		.bind(id, userId, `https://cdn.example.test/${id}.webp`, kind, createdAt)
		.run();
}

// Unlike seedGeneration, lets the caller set source_url/source_hash directly —
// needed to exercise dedup lookups and the pre-migration ('') grouping case.
function seedGenerationWithSource(
	db: D1Database,
	id: string,
	userId: string,
	sourceUrl: string,
	sourceHash: string,
	createdAt: number
): void {
	db.prepare(
		'INSERT INTO generations ' +
			'(id, user_id, url, source_url, source_hash, prompt, kind, amount, balance_after, created_at) ' +
			"VALUES (?, ?, ?, ?, ?, 'cozy', 'render', 1, 10, ?)"
	)
		.bind(id, userId, `https://cdn.example.test/${id}.webp`, sourceUrl, sourceHash, createdAt)
		.run();
}

let db: D1Database;

beforeEach(() => {
	db = makeD1();
});

describe('recordGeneration', () => {
	it('subtracts the real cost and records the image against the same row', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		grantAccess(db, 'user-1', 5);

		const result = await recordGeneration(db, 'user-1', {
			url: 'https://cdn.example.test/out.webp',
			sourceUrl: 'https://cdn.example.test/room.jpg',
			sourceHash: 'hash-room',
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
		seedUser(db, 'user-1', 'pubkey-1');
		seedUser(db, 'user-2', 'pubkey-2');
		grantAccess(db, 'user-1', 5);
		grantAccess(db, 'user-2', 5);

		await recordGeneration(db, 'user-1', {
			url: 'https://cdn.example.test/out.webp',
			sourceUrl: 'https://cdn.example.test/room.jpg',
			sourceHash: 'hash-room',
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
		await recordGeneration(db, 'user-1', {
			url: 'https://cdn.example.test/a.webp',
			sourceUrl: 'https://cdn.example.test/room.jpg',
			sourceHash: 'hash-room',
			prompt: 'cozy',
			kind: 'render',
			amount: 1
		});
		await recordGeneration(db, 'user-1', {
			url: 'https://cdn.example.test/b.webp',
			sourceUrl: 'https://cdn.example.test/a.webp',
			sourceHash: '',
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
			url: 'https://cdn.example.test/image-1.webp',
			sourceUrl: 'https://cdn.example.test/source.jpg',
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

		await expect(deleteGeneratedImage(db, 'user-2', 'image-1')).resolves.toBe(false);
		await expect(deleteGeneratedImage(db, 'user-1', 'image-1')).resolves.toBe(true);
		await expect(getGeneratedImageForUser(db, 'user-1', 'image-1')).resolves.toBeNull();
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
					url: 'https://cdn.example.test/newest.webp',
					sourceUrl: 'https://cdn.example.test/source.jpg',
					kind: 'render',
					createdAt: 3000
				},
				{
					id: 'middle',
					userId: 'user-1',
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
	it('returns the most recent source_url for a matching hash', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		seedGenerationWithSource(
			db,
			'a',
			'user-1',
			'https://cdn.example.test/room-v1.jpg',
			'hash-1',
			1000
		);
		seedGenerationWithSource(
			db,
			'b',
			'user-1',
			'https://cdn.example.test/room-v2.jpg',
			'hash-1',
			2000
		);

		await expect(findGenerationSourceByHash(db, 'user-1', 'hash-1')).resolves.toBe(
			'https://cdn.example.test/room-v2.jpg'
		);
	});

	it('never matches across users', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		seedUser(db, 'user-2', 'pubkey-2');
		seedGenerationWithSource(
			db,
			'a',
			'user-2',
			'https://cdn.example.test/room.jpg',
			'hash-1',
			1000
		);

		await expect(findGenerationSourceByHash(db, 'user-1', 'hash-1')).resolves.toBeNull();
	});

	it('never matches an empty hash, even against pre-migration rows', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		seedGeneration(db, 'legacy', 'user-1', 1000); // seedGeneration leaves source_hash at its '' default

		await expect(findGenerationSourceByHash(db, 'user-1', '')).resolves.toBeNull();
	});
});

describe('listDistinctSourceImages', () => {
	it('collapses repeat uploads of the same hash into one card', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		seedGenerationWithSource(
			db,
			'a',
			'user-1',
			'https://cdn.example.test/room.jpg',
			'hash-1',
			1000
		);
		seedGenerationWithSource(
			db,
			'b',
			'user-1',
			'https://cdn.example.test/room.jpg',
			'hash-1',
			2000
		);

		const page = await listDistinctSourceImages(db, 'user-1', 0, 10);

		expect(page).toEqual({
			images: [{ sourceUrl: 'https://cdn.example.test/room.jpg', createdAt: 2000 }],
			hasMore: false
		});
	});

	// The migration backfills pre-existing rows with source_hash = '' (no hash
	// was ever computed for them). Grouping by url — not hash — means two such
	// rows sharing the same source_url (e.g. repeated renders from one photo,
	// recorded before hash-based dedup existed) still collapse into a single
	// card, exactly like hashed rows do. Grouping by hash instead left them as
	// separate cards sharing an identical url, which crashed the gallery
	// (Svelte's each_key_duplicate) in production.
	it('collapses pre-migration rows (empty source_hash) sharing a url into one card', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		seedGeneration(db, 'legacy-a', 'user-1', 1000);
		seedGeneration(db, 'legacy-b', 'user-1', 2000);

		const page = await listDistinctSourceImages(db, 'user-1', 0, 10);

		expect(page).toEqual({
			images: [{ sourceUrl: 'https://cdn.example.test/source.jpg', createdAt: 2000 }],
			hasMore: false
		});
	});

	it('keeps pre-migration rows with different urls as separate cards', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		seedGenerationWithSource(
			db,
			'legacy-a',
			'user-1',
			'https://cdn.example.test/room-a.jpg',
			'',
			1000
		);
		seedGenerationWithSource(
			db,
			'legacy-b',
			'user-1',
			'https://cdn.example.test/room-b.jpg',
			'',
			2000
		);

		const page = await listDistinctSourceImages(db, 'user-1', 0, 10);

		expect(page.images).toHaveLength(2);
	});

	it('never mixes another user’s photos into the page', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		seedUser(db, 'user-2', 'pubkey-2');
		seedGenerationWithSource(
			db,
			'a',
			'user-1',
			'https://cdn.example.test/mine.jpg',
			'hash-1',
			1000
		);
		seedGenerationWithSource(
			db,
			'b',
			'user-2',
			'https://cdn.example.test/theirs.jpg',
			'hash-2',
			2000
		);

		const page = await listDistinctSourceImages(db, 'user-1', 0, 10);

		expect(page.images).toEqual([
			{ sourceUrl: 'https://cdn.example.test/mine.jpg', createdAt: 1000 }
		]);
	});
});
