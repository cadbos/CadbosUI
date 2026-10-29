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
import type {
	SessionUser,
	UsageGenerationsResponse,
	UserUsageDetailResponse
} from '$lib/api/contract';
import { createDb } from '$lib/server/db';
import { mediaLink } from '$lib/server/media-access';
import { seedCredit } from '$lib/server/testing/ledger-fixtures';
import { makeD1 } from '$lib/server/testing/d1-shim';
import {
	seedGeneration,
	seedGenerationRecord,
	seedMedia
} from '$lib/server/testing/generation-fixtures';
import { seedAdmin } from '$lib/server/testing/session-fixtures';
import { GET as getUser } from './[pubkey]/+server';
import { GET as getGenerations } from './[pubkey]/generations/+server';

const ADMIN_PUBKEY = 'admin-pubkey';
const USER_PUBKEY = 'user-pubkey';
const CDN = 'https://cdn.example.test';
const EXTERNAL_BUCKET = `external:${CDN}`;

async function seedUser(db: D1Database, id: string, pubkey: string): Promise<void> {
	await db
		.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind(id, pubkey, 1000)
		.run();
}

async function seedPlatform(): Promise<D1Database> {
	const db = makeD1();
	await seedUser(db, 'admin', ADMIN_PUBKEY);
	await seedAdmin(db, 'admin');
	await seedUser(db, 'user-1', USER_PUBKEY);
	await seedCredit(createDb(db), 'user-1', 11.5, 1, 4000);
	for (const [id, kind, amount, createdAt, balanceAfter] of [
		['generation-1', 'render', 1.25, 5000, 10.25],
		['generation-2', 'edit', 2.75, 6000, 7.5],
		['generation-3', 'render', 0.5, 6500, 7]
	] as const) {
		await seedGeneration(createDb(db), {
			id,
			userId: 'user-1',
			url: `${CDN}/${id}.webp`,
			sourceUrl: `${CDN}/source.jpg`,
			sourceChecksum: '1'.repeat(64),
			prompt: `prompt of ${id}`,
			kind,
			amount,
			balanceAfter,
			createdAt
		});
	}
	return db;
}

function platform(db: D1Database): App.Platform {
	return { env: { DB: db } } as App.Platform;
}

type UserEvent = Parameters<typeof getUser>[0];
type GenerationsEvent = Parameters<typeof getGenerations>[0];

function callUser(
	viewer: SessionUser | null,
	db: D1Database,
	pubkey: string,
	search = ''
): ReturnType<typeof getUser> {
	return getUser({
		params: { pubkey },
		url: new URL(`https://cadbos.example/api/usage/users/${pubkey}${search}`),
		platform: platform(db),
		locals: { sessionLookupUnavailable: false, user: viewer }
	} as UserEvent);
}

function callGenerations(
	viewer: SessionUser | null,
	db: D1Database,
	pubkey: string,
	search = ''
): ReturnType<typeof getGenerations> {
	return getGenerations({
		params: { pubkey },
		url: new URL(`https://cadbos.example/api/usage/users/${pubkey}/generations${search}`),
		platform: platform(db),
		locals: { sessionLookupUnavailable: false, user: viewer }
	} as GenerationsEvent);
}

const ADMIN: SessionUser = { pubkey: ADMIN_PUBKEY };

describe('GET /api/usage/users/[pubkey]', () => {
	it('requires an authenticated admin', async () => {
		const db = await seedPlatform();

		expect((await callUser(null, db, USER_PUBKEY)).status).toBe(401);
		expect((await callUser({ pubkey: USER_PUBKEY }, db, USER_PUBKEY)).status).toBe(403);
	});

	it('returns 404 for an unknown pubkey', async () => {
		const response = await callUser(ADMIN, await seedPlatform(), 'missing-pubkey');

		expect(response.status).toBe(404);
	});

	it.each(['?from=1', '?from=2000&to=1000', '?from=a&to=b', '?from=1&to=2&size=3'])(
		'rejects the invalid range %s',
		async (search) => {
			const response = await callUser(ADMIN, await seedPlatform(), USER_PUBKEY, search);

			expect(response.status).toBe(400);
		}
	);

	it("returns the user's all-time usage and generation kinds", async () => {
		const response = await callUser(ADMIN, await seedPlatform(), USER_PUBKEY);

		expect(response.status).toBe(200);
		expect((await response.json()) as UserUsageDetailResponse).toEqual({
			user: {
				pubkey: USER_PUBKEY,
				balance: 7,
				totalDeposit: 11.5,
				lastDepositAt: 4000,
				projectCount: 0,
				sessionCount: 0,
				generationCount: 3,
				sourceCount: 1,
				sourceBytes: null,
				referenceCount: 0,
				referenceBytes: null,
				totalSpend: 4.5,
				latestSpendAt: 6500
			},
			generationKinds: [
				{ kind: 'render', count: 2 },
				{ kind: 'edit', count: 1 }
			]
		});
	});

	it('limits every figure but the balance to the range', async () => {
		const response = await callUser(ADMIN, await seedPlatform(), USER_PUBKEY, '?from=5500&to=6200');

		expect(response.status).toBe(200);
		expect((await response.json()) as UserUsageDetailResponse).toEqual({
			user: {
				pubkey: USER_PUBKEY,
				balance: 7.5,
				totalDeposit: 0,
				lastDepositAt: null,
				projectCount: 0,
				sessionCount: 0,
				generationCount: 1,
				sourceCount: 1,
				sourceBytes: null,
				referenceCount: 0,
				referenceBytes: null,
				totalSpend: 2.75,
				latestSpendAt: 6000
			},
			generationKinds: [{ kind: 'edit', count: 1 }]
		});
	});
});

describe('GET /api/usage/users/[pubkey]/generations', () => {
	it('requires an authenticated admin', async () => {
		const db = await seedPlatform();

		expect((await callGenerations(null, db, USER_PUBKEY, '?from=0&to=1')).status).toBe(401);
		expect(
			(await callGenerations({ pubkey: USER_PUBKEY }, db, USER_PUBKEY, '?from=0&to=1')).status
		).toBe(403);
	});

	it('requires a range', async () => {
		const response = await callGenerations(ADMIN, await seedPlatform(), USER_PUBKEY);

		expect(response.status).toBe(400);
	});

	it("lists the range's generations newest first with their images", async () => {
		const db = await seedPlatform();
		const referenceMediaId = await seedMedia(createDb(db), `${CDN}/reference.webp`);
		await seedGenerationRecord(createDb(db), {
			id: 'generation-4',
			userId: 'user-1',
			resultMediaId: await seedMedia(createDb(db), `${CDN}/generation-4.webp`),
			sourceMediaId: await seedMedia(createDb(db), `${CDN}/source.jpg`),
			referenceMediaId,
			prompt: 'modern',
			kind: 'style-transfer',
			amount: 1,
			balanceAfter: 6,
			createdAt: 6800
		});

		const response = await callGenerations(
			ADMIN,
			db,
			USER_PUBKEY,
			'?from=5500&to=7000&offset=0&size=2'
		);

		expect(response.status).toBe(200);
		expect((await response.json()) as UsageGenerationsResponse).toEqual({
			generations: [
				{
					id: 'generation-4',
					kind: 'style-transfer',
					createdAt: 6800,
					prompt: 'modern',
					source: mediaLink(EXTERNAL_BUCKET, 'source.jpg'),
					result: mediaLink(EXTERNAL_BUCKET, 'generation-4.webp'),
					reference: mediaLink(EXTERNAL_BUCKET, 'reference.webp')
				},
				{
					id: 'generation-3',
					kind: 'render',
					createdAt: 6500,
					prompt: 'prompt of generation-3',
					source: mediaLink(EXTERNAL_BUCKET, 'source.jpg'),
					result: mediaLink(EXTERNAL_BUCKET, 'generation-3.webp'),
					reference: null
				}
			],
			pagination: { offset: 0, size: 2, hasMore: true }
		});
	});

	it('pages by offset past unrecognized kinds', async () => {
		const db = await seedPlatform();
		await seedGeneration(createDb(db), {
			id: 'generation-legacy',
			userId: 'user-1',
			url: `${CDN}/generation-legacy.webp`,
			sourceUrl: `${CDN}/source.jpg`,
			sourceChecksum: '1'.repeat(64),
			kind: 'legacy-kind',
			balanceAfter: 6,
			createdAt: 6700
		});
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		const response = await callGenerations(
			ADMIN,
			db,
			USER_PUBKEY,
			'?from=0&to=10000&offset=1&size=1'
		);
		const result = (await response.json()) as UsageGenerationsResponse;

		expect(result.generations.map((generation) => generation.id)).toEqual(['generation-2']);
		expect(result.pagination).toEqual({ offset: 1, size: 1, hasMore: true });
	});
});
