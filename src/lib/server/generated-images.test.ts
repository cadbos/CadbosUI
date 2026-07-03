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
import { getGeneratedImage, recordGeneratedImage } from './generated-images';

function seedUser(db: D1Database, id: string, pubkey: string): void {
	db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind(id, pubkey, Date.now())
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
		).rejects.toThrow();
		await expect(recordGeneratedImage(db, 'user-1', '/generated/a.webp')).rejects.toThrow();
		await expect(
			recordGeneratedImage(db, 'user-1', 'http://cdn.example.test/a.webp')
		).resolves.toMatchObject({
			userId: 'user-1',
			url: 'http://cdn.example.test/a.webp'
		});
	});

	it('rejects generated images without a matching user', async () => {
		await expect(
			recordGeneratedImage(db, 'missing-user', 'https://cdn.example.test/a.webp')
		).rejects.toThrow();
	});
});

describe('getGeneratedImage', () => {
	it('returns null for an unknown generated image id', async () => {
		await expect(getGeneratedImage(db, 'no-such-image')).resolves.toBeNull();
	});
});
