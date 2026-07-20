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

import { describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import {
	completeObjectReplacementJob,
	createObjectReplacementJob,
	failObjectReplacementJob,
	getObjectReplacementJob
} from '$lib/server/object-replacement-jobs';
import { makeD1 } from '$lib/server/testing/d1-shim';

function seedAccount(db: D1Database, balance = 12): void {
	db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind('user-1', 'pubkey-1', 1)
		.run();
	db.prepare('INSERT INTO credits (user_id, balance, updated_at, enabled) VALUES (?, ?, ?, 1)')
		.bind('user-1', balance, 1)
		.run();
}

async function seedJob(db: D1Database, id = 'job-1') {
	return createObjectReplacementJob(db, {
		id,
		userId: 'user-1',
		comfyPromptId: `prompt-${id}`,
		sceneUrl: 'https://cdn.example.test/scene.jpg',
		referenceUrl: 'https://cdn.example.test/reference.jpg',
		replacementObject: 'sofa',
		cost: 2,
		createdAt: 10
	});
}

describe('object replacement jobs', () => {
	it('stores the provider prompt and snapshotted request', async () => {
		const db = makeD1();
		seedAccount(db);

		await seedJob(db);

		await expect(getObjectReplacementJob(db, 'user-1', 'job-1')).resolves.toMatchObject({
			comfyPromptId: 'prompt-job-1',
			sceneUrl: 'https://cdn.example.test/scene.jpg',
			referenceUrl: 'https://cdn.example.test/reference.jpg',
			replacementObject: 'sofa',
			cost: 2,
			status: 'processing'
		});
	});

	it('atomically completes, deducts, and records one generation', async () => {
		const db = makeD1();
		seedAccount(db);
		await seedJob(db);

		const job = await completeObjectReplacementJob(
			db,
			'user-1',
			'job-1',
			'https://cdn.example.test/result.png',
			20
		);

		expect(job).toMatchObject({ status: 'completed', balanceAfter: 10, cost: 2 });
		const generation = await db
			.prepare('SELECT id, kind, amount, balance_after FROM generations WHERE id = ?')
			.bind('job-1')
			.first();
		expect(generation).toEqual({
			id: 'job-1',
			kind: 'object-replacement',
			amount: 2,
			balance_after: 10
		});
	});

	it('returns the same completion without charging again', async () => {
		const db = makeD1();
		seedAccount(db);
		await seedJob(db);

		const [first, second] = await Promise.all([
			completeObjectReplacementJob(
				db,
				'user-1',
				'job-1',
				'https://cdn.example.test/result.png',
				20
			),
			completeObjectReplacementJob(db, 'user-1', 'job-1', 'https://cdn.example.test/result.png', 21)
		]);

		expect(first.balanceAfter).toBe(10);
		expect(second.balanceAfter).toBe(10);
		const credit = await db
			.prepare('SELECT balance FROM credits WHERE user_id = ?')
			.bind('user-1')
			.first<{ balance: number }>();
		const count = await db
			.prepare('SELECT COUNT(*) AS count FROM generations WHERE id = ?')
			.bind('job-1')
			.first<{ count: number }>();
		expect(credit?.balance).toBe(10);
		expect(count?.count).toBe(1);
	});

	it('marks a provider failure without deducting credit', async () => {
		const db = makeD1();
		seedAccount(db);
		await seedJob(db);

		const job = await failObjectReplacementJob(
			db,
			'user-1',
			'job-1',
			'object_replacement_failed',
			20
		);

		expect(job).toMatchObject({
			status: 'failed',
			errorCode: 'object_replacement_failed'
		});
		const credit = await db
			.prepare('SELECT balance FROM credits WHERE user_id = ?')
			.bind('user-1')
			.first<{ balance: number }>();
		expect(credit?.balance).toBe(12);
	});
});
