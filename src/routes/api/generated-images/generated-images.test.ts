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

import { describe, expect, it, vi } from 'vitest';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { GeneratedImagesResponse, SessionUser } from '$lib/api/contract';
import { makeD1 } from '$lib/server/testing/d1-shim';
import { DEMO_PUBKEY } from '$lib/server/demo';
import { DELETE, GET } from './+server';

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

type GeneratedImagesEvent = Parameters<typeof GET>[0];
type DeleteGeneratedImageEvent = Parameters<typeof DELETE>[0];

function call(
	user: SessionUser | null,
	platform: App.Platform,
	search = ''
): ReturnType<typeof GET> {
	return GET({
		url: new URL(`https://cadbos.example/api/generated-images${search}`),
		platform,
		locals: { user }
	} as GeneratedImagesEvent);
}

function bucket(failDelete = false): Pick<R2Bucket, 'delete'> {
	return {
		delete: vi.fn(() => {
			if (failDelete) return Promise.reject(new Error('simulated R2 failure'));
			return Promise.resolve();
		})
	};
}

function callDelete(
	user: SessionUser | null,
	platform: App.Platform,
	body: unknown
): ReturnType<typeof DELETE> {
	return DELETE({
		request: new Request('https://cadbos.example/api/generated-images', {
			method: 'DELETE',
			body: JSON.stringify(body)
		}),
		platform,
		locals: { user }
	} as DeleteGeneratedImageEvent);
}

describe('GET /api/generated-images', () => {
	it('returns 401 for non-authenticated users', async () => {
		const response = await call(null, { env: { DB: makeD1() } } as App.Platform);
		const result = await response.json();

		expect(response.status).toBe(401);
		expect(result).toEqual({
			error: {
				code: 'unauthorized',
				message: 'Authentication required'
			}
		});
	});

	it('uses default pagination params', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');

		for (let index = 0; index < 21; index += 1) {
			seedGeneratedImage(db, `user-1-image-${index}`, 'user-1', 10_000 + index);
		}

		const response = await call({ pubkey: 'pubkey-1' }, { env: { DB: db } } as App.Platform);
		const result = (await response.json()) as GeneratedImagesResponse;

		expect(response.status).toBe(200);
		expect(result.images).toHaveLength(20);
		expect(result.images[0]).toEqual({
			id: 'user-1-image-20',
			url: 'https://cdn.example.test/user-1-image-20.webp',
			createdAt: 10020
		});
		expect(result.pagination).toEqual({ offset: 0, size: 20, hasMore: true });
	});

	it('rejects a user id search param', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');

		const response = await call(
			{ pubkey: 'pubkey-1' },
			{ env: { DB: db } } as App.Platform,
			'?userId=user-2'
		);

		expect(response.status).toBe(400);
	});

	it('applies offset and size search params', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');
		seedGeneratedImage(db, 'first', 'user-1', 3000);
		seedGeneratedImage(db, 'second', 'user-1', 2000);
		seedGeneratedImage(db, 'third', 'user-1', 1000);

		const response = await call(
			{ pubkey: 'pubkey-1' },
			{ env: { DB: db } } as App.Platform,
			'?offset=1&size=2'
		);
		const result = (await response.json()) as GeneratedImagesResponse;

		expect(response.status).toBe(200);
		expect(result.images.map((image) => image.id)).toEqual(['second', 'third']);
		expect(result.pagination).toEqual({ offset: 1, size: 2, hasMore: false });
	});

	it('rejects invalid pagination params', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');

		const response = await call(
			{ pubkey: 'pubkey-1' },
			{ env: { DB: db } } as App.Platform,
			'?offset=-1&size=0'
		);

		expect(response.status).toBe(400);
	});

	it('fails closed for the dev-only demo session without touching D1', async () => {
		const response = await call({ pubkey: DEMO_PUBKEY }, { env: {} } as App.Platform);
		const result = await response.json();

		expect(response.status).toBe(500);
		expect(result).toEqual({
			error: {
				code: 'account_error',
				message: 'Account record not found'
			}
		});
	});

	it('fails closed if a real session has no matching D1 user row', async () => {
		const response = await call({ pubkey: 'ghost-pubkey' }, {
			env: { DB: makeD1() }
		} as App.Platform);

		expect(response.status).toBe(500);
	});
});

describe('DELETE /api/generated-images', () => {
	it('returns 401 for non-authenticated users', async () => {
		const response = await callDelete(null, { env: { DB: makeD1() } } as App.Platform, {
			id: 'image-1'
		});

		expect(response.status).toBe(401);
	});

	it('rejects requests that do not name exactly one image id', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');

		const response = await callDelete({ pubkey: 'pubkey-1' }, { env: { DB: db } } as App.Platform, {
			ids: ['image-1']
		});

		expect(response.status).toBe(400);
	});

	it('deletes the authenticated user image from R2 and D1', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');
		seedGeneratedImage(db, 'image-1', 'user-1', 1000);
		const uploadsBucket = bucket();

		const response = await callDelete(
			{ pubkey: 'pubkey-1' },
			{
				env: {
					DB: db,
					UPLOADS_BUCKET: uploadsBucket,
					UPLOADS_PUBLIC_URL: 'https://cdn.example.test/'
				}
			} as App.Platform,
			{ id: 'image-1' }
		);

		const row = await db
			.prepare('SELECT id FROM generated_images WHERE id = ?')
			.bind('image-1')
			.first<{ id: string }>();

		expect(response.status).toBe(204);
		expect(uploadsBucket.delete).toHaveBeenCalledWith('image-1.webp');
		expect(row).toBeNull();
	});

	it('does not delete another user image', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');
		seedUser(db, 'user-2', 'pubkey-2');
		seedGeneratedImage(db, 'image-2', 'user-2', 1000);
		const uploadsBucket = bucket();

		const response = await callDelete(
			{ pubkey: 'pubkey-1' },
			{
				env: {
					DB: db,
					UPLOADS_BUCKET: uploadsBucket,
					UPLOADS_PUBLIC_URL: 'https://cdn.example.test/'
				}
			} as App.Platform,
			{ id: 'image-2' }
		);
		const row = await db
			.prepare('SELECT id FROM generated_images WHERE id = ?')
			.bind('image-2')
			.first<{ id: string }>();

		expect(response.status).toBe(404);
		expect(uploadsBucket.delete).not.toHaveBeenCalled();
		expect(row).toEqual({ id: 'image-2' });
	});

	it('keeps the D1 row when R2 deletion fails', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');
		seedGeneratedImage(db, 'image-1', 'user-1', 1000);
		const uploadsBucket = bucket(true);

		const response = await callDelete(
			{ pubkey: 'pubkey-1' },
			{
				env: {
					DB: db,
					UPLOADS_BUCKET: uploadsBucket,
					UPLOADS_PUBLIC_URL: 'https://cdn.example.test/'
				}
			} as App.Platform,
			{ id: 'image-1' }
		);
		const row = await db
			.prepare('SELECT id FROM generated_images WHERE id = ?')
			.bind('image-1')
			.first<{ id: string }>();

		expect(response.status).toBe(500);
		expect(row).toEqual({ id: 'image-1' });
	});

	it('fails closed for the dev-only demo session without touching D1 or R2', async () => {
		const uploadsBucket = bucket();

		const response = await callDelete(
			{ pubkey: DEMO_PUBKEY },
			{ env: { UPLOADS_BUCKET: uploadsBucket } } as App.Platform,
			{ id: 'image-1' }
		);

		expect(response.status).toBe(500);
		expect(uploadsBucket.delete).not.toHaveBeenCalled();
	});

	it('fails closed if a real session has no matching D1 user row', async () => {
		const response = await callDelete(
			{ pubkey: 'ghost-pubkey' },
			{ env: { DB: makeD1() } } as App.Platform,
			{ id: 'image-1' }
		);

		expect(response.status).toBe(500);
	});
});
