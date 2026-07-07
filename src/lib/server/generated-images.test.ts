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
import {
	GeneratedImageRecordError,
	getGeneratedImage,
	listGeneratedImages,
	recordGeneratedImage
} from './generated-images';

function seedUser(db: D1Database, id: string, pubkey: string): void {
	db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind(id, pubkey, Date.now())
		.run();
}

function seedGeneratedImage(db: D1Database, id: string, userId: string, createdAt: number): void {
	db.prepare('INSERT INTO generated_images (id, user_id, url, created_at) VALUES (?, ?, ?, ?)')
		.bind(id, userId, `https://cdn.example.test/${id}.webp`, createdAt)
		.run();
}

let db: D1Database;

beforeEach(() => {
	db = makeD1();
});

describe('recordGeneratedImage', () => {
	it('creates generated image rows linked to one user', async () => {
		seedUser(db, 'user-1', 'pubkey-1');

		const first = await recordGeneratedImage(db, 'user-1', 'https://cdn.example.test/a.webp');
		const second = await recordGeneratedImage(db, 'user-1', 'https://cdn.example.test/b.webp');

		expect(first.userId).toBe('user-1');
		expect(second.userId).toBe('user-1');
		expect(first.id).not.toBe(second.id);
		expect(await getGeneratedImage(db, first.id)).toEqual(first);
		expect(await getGeneratedImage(db, second.id)).toEqual(second);
	});

	it('isolates generated image rows per user', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		seedUser(db, 'user-2', 'pubkey-2');

		await recordGeneratedImage(db, 'user-1', 'https://cdn.example.test/a.webp');
		await recordGeneratedImage(db, 'user-2', 'https://cdn.example.test/b.webp');

		const firstCount = await db
			.prepare('SELECT COUNT(*) AS count FROM generated_images WHERE user_id = ?')
			.bind('user-1')
			.first<{ count: number }>();
		const secondCount = await db
			.prepare('SELECT COUNT(*) AS count FROM generated_images WHERE user_id = ?')
			.bind('user-2')
			.first<{ count: number }>();

		expect(firstCount?.count).toBe(1);
		expect(secondCount?.count).toBe(1);
	});

	it('stores only HTTP URLs', async () => {
		seedUser(db, 'user-1', 'pubkey-1');

		await expect(
			recordGeneratedImage(db, 'user-1', 'data:image/webp;base64,abc')
		).rejects.toMatchObject({
			name: 'GeneratedImageRecordError',
			code: 'invalid_url',
			message: 'Generated image URL is invalid'
		});
		await expect(recordGeneratedImage(db, 'user-1', '/generated/a.webp')).rejects.toBeInstanceOf(
			GeneratedImageRecordError
		);
		await expect(
			recordGeneratedImage(db, 'user-1', 'http://cdn.example.test/a.webp')
		).resolves.toMatchObject({
			userId: 'user-1',
			url: 'http://cdn.example.test/a.webp'
		});
	});

	it('rejects an invalid user id', async () => {
		await expect(
			recordGeneratedImage(db, ' ', 'https://cdn.example.test/a.webp')
		).rejects.toMatchObject({
			name: 'GeneratedImageRecordError',
			code: 'invalid_user_id',
			message: 'Generated image user id is invalid'
		});
	});

	it('rejects generated images without a matching user', async () => {
		await expect(
			recordGeneratedImage(db, 'missing-user', 'https://cdn.example.test/a.webp')
		).rejects.toMatchObject({
			name: 'GeneratedImageRecordError',
			code: 'unknown_user_id',
			message: 'Generated image user was not found'
		});
	});
});

describe('getGeneratedImage', () => {
	it('returns null for an unknown generated image id', async () => {
		await expect(getGeneratedImage(db, 'no-such-image')).resolves.toBeNull();
	});
});

describe('listGeneratedImages', () => {
	it('returns one user image page in newest-first order', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		seedUser(db, 'user-2', 'pubkey-2');
		seedGeneratedImage(db, 'oldest', 'user-1', 1000);
		seedGeneratedImage(db, 'newest', 'user-1', 3000);
		seedGeneratedImage(db, 'middle', 'user-1', 2000);
		seedGeneratedImage(db, 'other-user-image', 'user-2', 4000);

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
		seedGeneratedImage(db, 'first', 'user-1', 3000);
		seedGeneratedImage(db, 'second', 'user-1', 2000);
		seedGeneratedImage(db, 'third', 'user-1', 1000);

		const page = await listGeneratedImages(db, 'user-1', 1, 2);

		expect(page.images.map((image) => image.id)).toEqual(['second', 'third']);
		expect(page.hasMore).toBe(false);
	});
});
