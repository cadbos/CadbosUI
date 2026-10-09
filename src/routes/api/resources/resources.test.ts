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
import type { ResourceDetailResponse, ResourcesResponse, SessionUser } from '$lib/api/contract';
import { createDb } from '$lib/server/db';
import { mediaKey } from '$lib/server/media';
import { makeD1 } from '$lib/server/testing/d1-shim';
import {
	seedGeneration,
	setBucketUrl,
	TEST_S3_BUCKET,
	TEST_S3_ENV
} from '$lib/server/testing/generation-fixtures';
import { GET } from './+server';
import { GET as GET_DETAIL } from './[key]/+server';

const HASH = 'a'.repeat(64);

type ResourcesEvent = Parameters<typeof GET>[0];
type ResourceDetailEvent = Parameters<typeof GET_DETAIL>[0];

let db: D1Database;

function platform(): App.Platform {
	return { env: { DB: db, ...TEST_S3_ENV } } as unknown as App.Platform;
}

function seedUser(id: string, pubkey: string): void {
	db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind(id, pubkey, Date.now())
		.run();
}

function callList(user: SessionUser | null, search: string): ReturnType<typeof GET> {
	return GET({
		url: new URL(`https://cadbos.example/api/resources${search}`),
		platform: platform(),
		locals: { sessionLookupUnavailable: false, user }
	} as ResourcesEvent);
}

function callDetail(user: SessionUser | null, key: string): ReturnType<typeof GET_DETAIL> {
	return GET_DETAIL({
		params: { key },
		url: new URL(`https://cadbos.example/api/resources/${encodeURIComponent(key)}`),
		platform: platform(),
		locals: { sessionLookupUnavailable: false, user }
	} as ResourceDetailEvent);
}

beforeEach(async () => {
	db = makeD1();
	await setBucketUrl(createDb(db), TEST_S3_BUCKET.name, 'https://cdn.example.test');
	seedUser('user-1', 'pubkey-1');
	seedUser('user-2', 'pubkey-2');
	await seedGeneration(createDb(db), {
		id: 'render-1',
		userId: 'user-1',
		url: 'https://cdn.example.test/render-1.webp',
		sourceUrl: 'https://cdn.example.test/room.jpg',
		sourceChecksum: HASH,
		createdAt: 1000
	});
});

describe('GET /api/resources', () => {
	it('rejects an unknown filter', async () => {
		const response = await callList({ pubkey: 'pubkey-1' }, '?filter=everything');

		expect(response.status).toBe(400);
	});

	it('returns each resource with its roles', async () => {
		const response = await callList({ pubkey: 'pubkey-1' }, '?filter=sources');
		const body = (await response.json()) as ResourcesResponse;

		expect(response.status).toBe(200);
		expect(body.images).toEqual([
			{
				image: { key: mediaKey(TEST_S3_BUCKET.name, 'room.jpg'), url: expect.any(String) },
				createdAt: 1000,
				roles: ['source']
			}
		]);
	});
});

describe('GET /api/resources/[key]', () => {
	const roomKey = mediaKey(TEST_S3_BUCKET.name, 'room.jpg');

	it('requires authentication', async () => {
		const response = await callDetail(null, roomKey);

		expect(response.status).toBe(401);
	});

	it('returns the resource and the generations it took part in', async () => {
		const response = await callDetail({ pubkey: 'pubkey-1' }, roomKey);
		const body = (await response.json()) as ResourceDetailResponse;

		expect(response.status).toBe(200);
		expect(body).toEqual({
			image: { key: roomKey, url: expect.any(String) },
			roles: ['source'],
			generations: [
				{
					id: 'render-1',
					kind: 'render',
					createdAt: 1000,
					image: {
						key: mediaKey(TEST_S3_BUCKET.name, 'render-1.webp'),
						url: expect.any(String)
					},
					roles: ['source'],
					session: null,
					settingsSaved: false
				}
			],
			pagination: { offset: 0, size: 30, hasMore: false }
		});
	});

	it('answers 404 for another user’s image, never confirming it exists', async () => {
		const response = await callDetail({ pubkey: 'pubkey-2' }, roomKey);

		expect(response.status).toBe(404);
	});

	it('answers 404 for a malformed or unknown key', async () => {
		expect((await callDetail({ pubkey: 'pubkey-1' }, 'no-slash')).status).toBe(404);
		expect(
			(await callDetail({ pubkey: 'pubkey-1' }, mediaKey(TEST_S3_BUCKET.name, 'missing.jpg')))
				.status
		).toBe(404);
	});
});
