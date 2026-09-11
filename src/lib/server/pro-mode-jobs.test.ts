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
import {
	completeProModeJob,
	createProModeJob,
	failProModeJob,
	getProModeJob
} from '$lib/server/pro-mode-jobs';
import { makeD1 } from '$lib/server/testing/d1-shim';
import { seedManagedMedia } from '$lib/server/testing/generation-fixtures';

function seedAccount(db: D1Database, balance = 12): void {
	db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind('user-1', 'pubkey-1', 1)
		.run();
	db.prepare('INSERT INTO credits (user_id, balance, updated_at, enabled) VALUES (?, ?, ?, 1)')
		.bind('user-1', balance, 1)
		.run();
	db.prepare(
		'INSERT INTO projects (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
	)
		.bind('project-1', 'user-1', 'Test project', 1, 1)
		.run();
	db.prepare(
		'INSERT INTO project_sessions (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
	)
		.bind('session-1', 'project-1', 'Test session', 1, 1)
		.run();
}

async function seedJob(
	db: D1Database,
	id = 'job-1',
	referenceMediaId: number | undefined = undefined
) {
	const sceneMediaId = seedManagedMedia(db, 'scene.jpg');
	return createProModeJob(db, {
		id,
		userId: 'user-1',
		comfyPromptId: `prompt-${id}`,
		sceneMediaId,
		sessionId: 'session-1',
		referenceMediaId,
		prompt: 'replace the sofa with a blue one',
		cost: 2,
		createdAt: 10
	});
}

describe('pro mode jobs', () => {
	it('stores a job with no reference media', async () => {
		const db = makeD1();
		seedAccount(db);

		await seedJob(db);

		await expect(getProModeJob(db, 'user-1', 'job-1')).resolves.toMatchObject({
			comfyPromptId: 'prompt-job-1',
			sceneMediaId: expect.any(Number),
			referenceMediaId: null,
			prompt: 'replace the sofa with a blue one',
			cost: 2,
			status: 'processing'
		});
	});

	it('stores a job with a reference media id when one is provided', async () => {
		const db = makeD1();
		seedAccount(db);
		const referenceMediaId = seedManagedMedia(db, 'reference.jpg');

		await seedJob(db, 'job-1', referenceMediaId);

		await expect(getProModeJob(db, 'user-1', 'job-1')).resolves.toMatchObject({
			referenceMediaId
		});
	});

	it('atomically completes, deducts, and records one generation', async () => {
		const db = makeD1();
		seedAccount(db);
		await seedJob(db);
		const outputMediaId = seedManagedMedia(db, 'result.png');

		const job = await completeProModeJob(db, 'user-1', 'job-1', outputMediaId, 20);

		expect(job).toMatchObject({ status: 'completed', balanceAfter: 10, cost: 2 });
		const generation = await db
			.prepare('SELECT id, kind, amount, balance_after FROM generations WHERE id = ?')
			.bind('job-1')
			.first();
		expect(generation).toEqual({
			id: 'job-1',
			kind: 'pro-mode',
			amount: 2,
			balance_after: 10
		});
	});

	it('returns the same completion without charging again', async () => {
		const db = makeD1();
		seedAccount(db);
		await seedJob(db);
		const outputMediaId = seedManagedMedia(db, 'result.png');

		const [first, second] = await Promise.all([
			completeProModeJob(db, 'user-1', 'job-1', outputMediaId, 20),
			completeProModeJob(db, 'user-1', 'job-1', outputMediaId, 21)
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

		const job = await failProModeJob(db, 'user-1', 'job-1', 'pro_mode_failed', 20);

		expect(job).toMatchObject({
			status: 'failed',
			errorCode: 'pro_mode_failed'
		});
		const credit = await db
			.prepare('SELECT balance FROM credits WHERE user_id = ?')
			.bind('user-1')
			.first<{ balance: number }>();
		expect(credit?.balance).toBe(12);
	});

	it('clamps concurrent completion spending at zero and warns once', async () => {
		const db = makeD1();
		seedAccount(db, 3);
		await seedJob(db, 'job-1');
		await seedJob(db, 'job-2');
		const firstOutputMediaId = seedManagedMedia(db, 'result-1.png');
		const secondOutputMediaId = seedManagedMedia(db, 'result-2.png');
		const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		const jobs = await Promise.all([
			completeProModeJob(db, 'user-1', 'job-1', firstOutputMediaId, 20),
			completeProModeJob(db, 'user-1', 'job-2', secondOutputMediaId, 21)
		]);
		await completeProModeJob(db, 'user-1', 'job-2', secondOutputMediaId, 22);

		expect(jobs.map((job) => job.balanceAfter).sort()).toEqual([0, 1]);
		const credit = await db
			.prepare('SELECT balance FROM credits WHERE user_id = ?')
			.bind('user-1')
			.first<{ balance: number }>();
		expect(credit?.balance).toBe(0);
		expect(warning).toHaveBeenCalledOnce();
		expect(warning).toHaveBeenCalledWith('Pro mode credit deduction exceeded available balance:', {
			jobId: 'job-2'
		});
		warning.mockRestore();
	});
});
