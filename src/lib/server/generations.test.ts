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
	getGeneratedImageForUser,
	listCreditHistory,
	listGeneratedImages,
	recordCreditTransaction,
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

function seedGeneration(db: D1Database, id: string, userId: string, createdAt: number): void {
	db.prepare(
		'INSERT INTO generations ' +
			'(id, user_id, url, source_url, prompt, kind, amount, balance_after, created_at) ' +
			"VALUES (?, ?, ?, 'https://cdn.example.test/source.jpg', 'cozy', 'render', 1, 10, ?)"
	)
		.bind(id, userId, `https://cdn.example.test/${id}.webp`, createdAt)
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
			prompt: 'cozy',
			kind: 'render',
			amount: 2
		});

		expect((await getCredit(db, 'user-1'))?.balance).toBe(3);
		expect((await getCredit(db, 'user-2'))?.balance).toBe(5);
	});
});

describe('recordCreditTransaction', () => {
	it('subtracts the real cost without adding image history', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		grantAccess(db, 'user-1', 5);

		const result = await recordCreditTransaction(db, 'user-1', {
			kind: 'auto-prompt',
			amount: 0.75
		});
		expect(result.balance).toBe(4.25);

		const history = await listCreditHistory(db, 'user-1');
		expect(history).toEqual([
			expect.objectContaining({ amount: 0.75, balanceAfter: 4.25, kind: 'auto-prompt' })
		]);

		const images = await listGeneratedImages(db, 'user-1', 0, 10);
		expect(images.images).toEqual([]);
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
			prompt: 'cozy',
			kind: 'render',
			amount: 1
		});
		await recordGeneration(db, 'user-1', {
			url: 'https://cdn.example.test/b.webp',
			sourceUrl: 'https://cdn.example.test/a.webp',
			prompt: 'change the sofa',
			kind: 'edit',
			amount: 2
		});

		const history = await listCreditHistory(db, 'user-1');
		expect(history.map((entry) => entry.kind)).toEqual(['edit', 'render']);
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
					createdAt: 3000
				},
				{
					id: 'middle',
					userId: 'user-1',
					url: 'https://cdn.example.test/middle.webp',
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
});
