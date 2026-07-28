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

import type { D1Database } from '@cloudflare/workers-types';
import { describe, expect, it, vi } from 'vitest';

import {
	completeColorReplacementJob,
	createColorReplacementJob,
	failColorReplacementJob,
	getColorReplacementJob
} from '$lib/server/color-replacement-jobs';
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
	return createColorReplacementJob(db, {
		id,
		userId: 'user-1',
		comfyPromptId: `prompt-${id}`,
		sceneUrl: 'https://cdn.example.test/scene.jpg',
		targetObject: 'sofa',
		color: 'NCS S 2050-Y90R',
		cost: 2,
		createdAt: 10
	});
}

describe('color replacement jobs', () => {
	it('stores the provider prompt and snapshotted request for its owner', async () => {
		const db = makeD1();
		seedAccount(db);

		await seedJob(db);

		await expect(getColorReplacementJob(db, 'user-1', 'job-1')).resolves.toMatchObject({
			comfyPromptId: 'prompt-job-1',
			sceneUrl: 'https://cdn.example.test/scene.jpg',
			targetObject: 'sofa',
			color: 'NCS S 2050-Y90R',
			cost: 2,
			status: 'processing'
		});
		await expect(getColorReplacementJob(db, 'another-user', 'job-1')).resolves.toBeNull();
	});

	it('atomically completes, deducts, and records one generation', async () => {
		const db = makeD1();
		seedAccount(db);
		await seedJob(db);

		const job = await completeColorReplacementJob(
			db,
			'user-1',
			'job-1',
			'https://cdn.example.test/result.png',
			20
		);

		expect(job).toMatchObject({
			status: 'completed',
			outputUrl: 'https://cdn.example.test/result.png',
			balanceAfter: 10,
			cost: 2,
			completedAt: 20
		});
		const generation = await db
			.prepare(
				'SELECT id, source_url, prompt, kind, amount, balance_after FROM generations WHERE id = ?'
			)
			.bind('job-1')
			.first();
		expect(generation).toEqual({
			id: 'job-1',
			source_url: 'https://cdn.example.test/scene.jpg',
			prompt: 'sofa → NCS S 2050-Y90R',
			kind: 'color-replacement',
			amount: 2,
			balance_after: 10
		});
	});

	it('returns the same completion without charging or inserting again', async () => {
		const db = makeD1();
		seedAccount(db);
		await seedJob(db);

		const first = await completeColorReplacementJob(
			db,
			'user-1',
			'job-1',
			'https://cdn.example.test/result.png',
			20
		);
		const second = await completeColorReplacementJob(
			db,
			'user-1',
			'job-1',
			'https://cdn.example.test/other-result.png',
			21
		);

		expect(second).toEqual(first);
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

	it('clamps completion spending at zero and warns', async () => {
		const db = makeD1();
		seedAccount(db, 1);
		await seedJob(db);
		const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		const job = await completeColorReplacementJob(
			db,
			'user-1',
			'job-1',
			'https://cdn.example.test/result.png',
			20
		);

		expect(job).toMatchObject({ status: 'completed', balanceAfter: 0, cost: 2 });
		expect(warning).toHaveBeenCalledOnce();
		expect(warning).toHaveBeenCalledWith(
			'Color replacement credit deduction exceeded available balance:',
			{ jobId: 'job-1' }
		);
		warning.mockRestore();
	});

	it('fails only the owner job and leaves credit unchanged', async () => {
		const db = makeD1();
		seedAccount(db);
		await seedJob(db);

		await expect(
			failColorReplacementJob(db, 'another-user', 'job-1', 'color_replacement_failed', 19)
		).rejects.toThrow('color replacement job not found');
		const failed = await failColorReplacementJob(
			db,
			'user-1',
			'job-1',
			'color_replacement_failed',
			20
		);
		const repeated = await failColorReplacementJob(db, 'user-1', 'job-1', 'another_error', 21);

		expect(failed).toMatchObject({
			status: 'failed',
			errorCode: 'color_replacement_failed',
			completedAt: 20
		});
		expect(repeated).toEqual(failed);
		const credit = await db
			.prepare('SELECT balance FROM credits WHERE user_id = ?')
			.bind('user-1')
			.first<{ balance: number }>();
		expect(credit?.balance).toBe(12);
	});

	it('preserves a terminal state across completion and failure calls', async () => {
		const failedDb = makeD1();
		seedAccount(failedDb);
		await seedJob(failedDb);
		const failed = await failColorReplacementJob(
			failedDb,
			'user-1',
			'job-1',
			'color_replacement_failed',
			20
		);
		await expect(
			completeColorReplacementJob(
				failedDb,
				'user-1',
				'job-1',
				'https://cdn.example.test/result.png',
				21
			)
		).resolves.toEqual(failed);

		const completedDb = makeD1();
		seedAccount(completedDb);
		await seedJob(completedDb);
		const completed = await completeColorReplacementJob(
			completedDb,
			'user-1',
			'job-1',
			'https://cdn.example.test/result.png',
			20
		);
		await expect(
			failColorReplacementJob(completedDb, 'user-1', 'job-1', 'color_replacement_failed', 21)
		).resolves.toEqual(completed);
	});
});
