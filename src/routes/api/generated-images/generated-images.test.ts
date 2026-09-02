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
import type { D1Database } from '@cloudflare/workers-types';
import type { GeneratedImagesResponse, SessionUser } from '$lib/api/contract';
import type { Bucket } from '$lib/server/media';
import { makeD1 } from '$lib/server/testing/d1-shim';
import {
	seedGeneration as seedGenerationFixture,
	setBucketUrl,
	TEST_S3_ENV
} from '$lib/server/testing/generation-fixtures';
import { DEMO_PUBKEY } from '$lib/server/demo';

const storage = vi.hoisted(() => ({
	deleteS3Object:
		vi.fn<(platform: App.Platform | undefined, bucket: Bucket, key: string) => Promise<void>>()
}));

vi.mock('$lib/server/s3', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/s3')>()),
	deleteS3Object: storage.deleteS3Object
}));

import { DELETE, GET } from './+server';

function seedUser(db: D1Database, id: string, pubkey: string): void {
	db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind(id, pubkey, Date.now())
		.run();
}

function seedGeneratedImage(db: D1Database, id: string, userId: string, createdAt: number): void {
	setBucketUrl(db, 'cadbos-uploads', 'https://cdn.example.test');
	seedGenerationFixture(db, {
		id,
		userId,
		url: `https://cdn.example.test/${id}.webp`,
		sourceUrl: 'https://cdn.example.test/source.jpg',
		createdAt
	});
}

type GeneratedImagesEvent = Parameters<typeof GET>[0];
type DeleteGeneratedImageEvent = Parameters<typeof DELETE>[0];

function call(
	user: SessionUser | null,
	platform: App.Platform,
	search = '',
	sessionLookupUnavailable = false
): ReturnType<typeof GET> {
	return GET({
		url: new URL(`https://cadbos.example/api/generated-images${search}`),
		platform,
		locals: { sessionLookupUnavailable, user }
	} as GeneratedImagesEvent);
}

function bucket(failDelete = false): { delete: ReturnType<typeof vi.fn> } {
	const uploadsBucket = {
		delete: vi.fn((_key: string) => {
			if (failDelete) return Promise.reject(new Error('simulated S3 failure'));
			return Promise.resolve();
		})
	};
	storage.deleteS3Object.mockImplementation(async (_platform, _bucket, key) =>
		uploadsBucket.delete(key)
	);
	return uploadsBucket;
}

function platform(db: D1Database): App.Platform {
	return { env: { DB: db, ...TEST_S3_ENV } } as unknown as App.Platform;
}

function callDelete(
	user: SessionUser | null,
	platform: App.Platform,
	body: unknown,
	sessionLookupUnavailable = false
): ReturnType<typeof DELETE> {
	return DELETE({
		request: new Request('https://cadbos.example/api/generated-images', {
			method: 'DELETE',
			body: JSON.stringify(body)
		}),
		platform,
		locals: { sessionLookupUnavailable, user }
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

	it('returns 503 when session lookup is unavailable', async () => {
		const response = await call(null, { env: {} } as App.Platform, '', true);

		expect(response.status).toBe(503);
		expect(response.headers.get('retry-after')).toBe('5');
		expect(await response.json()).toEqual({
			error: {
				code: 'authentication_unavailable',
				message: 'Authentication service temporarily unavailable'
			}
		});
	});

	it('uses default pagination params', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');

		for (let index = 0; index < 21; index += 1) {
			seedGeneratedImage(db, `user-1-image-${index}`, 'user-1', 10_000 + index);
		}

		const response = await call({ pubkey: 'pubkey-1' }, platform(db));
		const result = (await response.json()) as GeneratedImagesResponse;

		expect(response.status).toBe(200);
		expect(result.images).toHaveLength(20);
		expect(result.images[0]).toEqual({
			id: 'user-1-image-20',
			image: {
				key: 'cadbos-uploads/user-1-image-20.webp',
				url: expect.stringContaining('/user-1-image-20.webp?')
			},
			source: {
				key: 'cadbos-uploads/source.jpg',
				url: expect.stringContaining('/source.jpg?')
			},
			kind: 'render',
			createdAt: 10020
		});
		expect(result.pagination).toEqual({ offset: 0, size: 20, hasMore: true });
	});

	it('rejects a user id search param', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');

		const response = await call({ pubkey: 'pubkey-1' }, platform(db), '?userId=user-2');

		expect(response.status).toBe(400);
	});

	it('applies offset and size search params', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');
		seedGeneratedImage(db, 'first', 'user-1', 3000);
		seedGeneratedImage(db, 'second', 'user-1', 2000);
		seedGeneratedImage(db, 'third', 'user-1', 1000);

		const response = await call({ pubkey: 'pubkey-1' }, platform(db), '?offset=1&size=2');
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

	it('returns 503 without deleting from storage when session lookup is unavailable', async () => {
		const uploadsBucket = bucket();
		const response = await callDelete(
			null,
			{ env: {} } as unknown as App.Platform,
			{ id: 'image-1' },
			true
		);

		expect(response.status).toBe(503);
		expect(response.headers.get('retry-after')).toBe('5');
		expect(await response.json()).toEqual({
			error: {
				code: 'authentication_unavailable',
				message: 'Authentication service temporarily unavailable'
			}
		});
		expect(uploadsBucket.delete).not.toHaveBeenCalled();
	});

	it('rejects requests that do not name exactly one image id', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');

		const response = await callDelete({ pubkey: 'pubkey-1' }, { env: { DB: db } } as App.Platform, {
			ids: ['image-1']
		});

		expect(response.status).toBe(400);
	});

	it('deletes the authenticated user image from S3 and D1', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');
		seedGeneratedImage(db, 'image-1', 'user-1', 1000);
		const uploadsBucket = bucket();

		const response = await callDelete({ pubkey: 'pubkey-1' }, platform(db), { id: 'image-1' });

		const row = await db
			.prepare('SELECT id FROM generations WHERE id = ?')
			.bind('image-1')
			.first<{ id: string }>();

		expect(response.status).toBe(204);
		expect(uploadsBucket.delete).toHaveBeenCalledWith('image-1.webp');
		expect(row).toBeNull();
	});

	it('retains media referenced by a light settings job', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');
		seedGeneratedImage(db, 'image-1', 'user-1', 1000);
		const image = await db
			.prepare('SELECT result_media_id FROM generations WHERE id = ?')
			.bind('image-1')
			.first<{ result_media_id: number }>();
		if (!image) throw new Error('generated image seed failed');
		db.prepare(
			'INSERT INTO light_settings_jobs ' +
				'(id, user_id, comfy_prompt_id, scene_media_id, instruction, cost, status, created_at, updated_at) ' +
				"VALUES (?, ?, ?, ?, ?, ?, 'processing', ?, ?)"
		)
			.bind('light-1', 'user-1', 'prompt-1', image.result_media_id, 'warmer', 1, 1000, 1000)
			.run();
		const uploadsBucket = bucket();

		const response = await callDelete({ pubkey: 'pubkey-1' }, platform(db), { id: 'image-1' });
		const media = await db
			.prepare('SELECT id FROM media WHERE id = ?')
			.bind(image.result_media_id)
			.first<{ id: number }>();

		expect(response.status).toBe(204);
		expect(uploadsBucket.delete).not.toHaveBeenCalled();
		expect(media).toEqual({ id: image.result_media_id });
	});

	it('retains media when a reference is added immediately before the deletion batch', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');
		seedGeneratedImage(db, 'image-1', 'user-1', 1000);
		const image = await db
			.prepare('SELECT result_media_id FROM generations WHERE id = ?')
			.bind('image-1')
			.first<{ result_media_id: number }>();
		if (!image) throw new Error('generated image seed failed');
		const concurrentDb = new Proxy(db, {
			get(target, property, receiver) {
				if (property !== 'batch') return Reflect.get(target, property, receiver);
				return async (statements: Parameters<D1Database['batch']>[0]) => {
					await db
						.prepare(
							'INSERT INTO light_settings_jobs ' +
								'(id, user_id, comfy_prompt_id, scene_media_id, instruction, cost, status, created_at, updated_at) ' +
								"VALUES (?, ?, ?, ?, ?, ?, 'processing', ?, ?)"
						)
						.bind('light-1', 'user-1', 'prompt-1', image.result_media_id, 'warmer', 1, 1000, 1000)
						.run();
					return target.batch(statements);
				};
			}
		});
		const uploadsBucket = bucket();

		const response = await callDelete({ pubkey: 'pubkey-1' }, platform(concurrentDb), {
			id: 'image-1'
		});
		const generation = await db
			.prepare('SELECT id FROM generations WHERE id = ?')
			.bind('image-1')
			.first<{ id: string }>();
		const media = await db
			.prepare('SELECT id FROM media WHERE id = ?')
			.bind(image.result_media_id)
			.first<{ id: number }>();

		expect(response.status).toBe(204);
		expect(uploadsBucket.delete).not.toHaveBeenCalled();
		expect(generation).toBeNull();
		expect(media).toEqual({ id: image.result_media_id });
	});

	it('keeps S3 media referenced by another generation', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');
		seedGeneratedImage(db, 'image-1', 'user-1', 1000);
		seedGenerationFixture(db, {
			id: 'image-2',
			userId: 'user-1',
			url: 'https://cdn.example.test/image-2.webp',
			sourceUrl: 'https://cdn.example.test/image-1.webp',
			createdAt: 2000
		});
		const uploadsBucket = bucket();

		const response = await callDelete({ pubkey: 'pubkey-1' }, platform(db), { id: 'image-1' });

		expect(response.status).toBe(204);
		expect(uploadsBucket.delete).not.toHaveBeenCalled();
		expect(
			await db
				.prepare('SELECT id FROM media WHERE filename = ?')
				.bind('image-1.webp')
				.first<{ id: number }>()
		).not.toBeNull();
	});

	it('does not delete another user image', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');
		seedUser(db, 'user-2', 'pubkey-2');
		seedGeneratedImage(db, 'image-2', 'user-2', 1000);
		const uploadsBucket = bucket();

		const response = await callDelete({ pubkey: 'pubkey-1' }, platform(db), { id: 'image-2' });
		const row = await db
			.prepare('SELECT id FROM generations WHERE id = ?')
			.bind('image-2')
			.first<{ id: string }>();

		expect(response.status).toBe(404);
		expect(uploadsBucket.delete).not.toHaveBeenCalled();
		expect(row).toEqual({ id: 'image-2' });
	});

	it('keeps the committed D1 deletion when S3 deletion fails', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');
		seedGeneratedImage(db, 'image-1', 'user-1', 1000);
		const image = await db
			.prepare('SELECT result_media_id FROM generations WHERE id = ?')
			.bind('image-1')
			.first<{ result_media_id: number }>();
		if (!image) throw new Error('generated image seed failed');
		bucket(true);

		const response = await callDelete({ pubkey: 'pubkey-1' }, platform(db), { id: 'image-1' });
		const generation = await db
			.prepare('SELECT id FROM generations WHERE id = ?')
			.bind('image-1')
			.first<{ id: string }>();
		const media = await db
			.prepare('SELECT id FROM media WHERE id = ?')
			.bind(image.result_media_id)
			.first<{ id: number }>();

		expect(response.status).toBe(500);
		expect(generation).toBeNull();
		expect(media).toBeNull();
	});

	it('fails closed for the dev-only demo session without touching D1 or S3', async () => {
		const uploadsBucket = bucket();

		const response = await callDelete(
			{ pubkey: DEMO_PUBKEY },
			{ env: {} } as unknown as App.Platform,
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
