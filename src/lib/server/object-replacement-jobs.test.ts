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
import { getCredit } from '$lib/server/billing';
import {
	completeObjectReplacementJob,
	createObjectReplacementJob,
	failObjectReplacementJob,
	getObjectReplacementJob
} from '$lib/server/object-replacement-jobs';
import { grantGenerationAccess, makeD1 } from '$lib/server/testing/d1-shim';

function seedAccount(db: D1Database, balance = 12): void {
	db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind('user-1', 'pubkey-1', 1)
		.run();
	grantGenerationAccess(db, 'user-1', balance, 1, 1);
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
			.prepare(
				'SELECT generation.id, generation.kind, -entry.amount AS amount_units, ' +
					'job.balance_after FROM generations generation ' +
					'JOIN ledger_entries entry ON entry.transaction_id = generation.ledger_transaction_id ' +
					'JOIN object_replacement_jobs job ON job.id = generation.id ' +
					"WHERE generation.id = ? AND entry.account_id = 'archai-token'"
			)
			.bind('job-1')
			.first();
		expect(generation).toEqual({
			id: 'job-1',
			kind: 'object-replacement',
			amount_units: 200,
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
		const credit = await getCredit(db, 'user-1');
		const count = await db
			.prepare('SELECT COUNT(*) AS count FROM generations WHERE id = ?')
			.bind('job-1')
			.first<{ count: number }>();
		expect(credit?.balance).toBe(10);
		expect(count?.count).toBe(1);
	});

	it('clamps concurrent completion spending at zero and warns once', async () => {
		const db = makeD1();
		seedAccount(db, 3);
		await seedJob(db, 'job-1');
		await seedJob(db, 'job-2');
		const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		const jobs = await Promise.all([
			completeObjectReplacementJob(
				db,
				'user-1',
				'job-1',
				'https://cdn.example.test/result-1.png',
				20
			),
			completeObjectReplacementJob(
				db,
				'user-1',
				'job-2',
				'https://cdn.example.test/result-2.png',
				21
			)
		]);
		await completeObjectReplacementJob(
			db,
			'user-1',
			'job-2',
			'https://cdn.example.test/result-2.png',
			22
		);

		expect(jobs.map((job) => job.balanceAfter).sort()).toEqual([0, 1]);
		const credit = await getCredit(db, 'user-1');
		const generations = await db
			.prepare(
				'SELECT generation.id, -entry.amount AS amount_units, job.balance_after ' +
					'FROM generations generation ' +
					'JOIN ledger_entries entry ON entry.transaction_id = generation.ledger_transaction_id ' +
					'JOIN object_replacement_jobs job ON job.id = generation.id ' +
					"WHERE generation.user_id = ? AND entry.account_id = 'archai-token' ORDER BY generation.id"
			)
			.bind('user-1')
			.all<{ id: string; amount_units: number; balance_after: number }>();
		expect(credit?.balance).toBe(0);
		expect(generations.results).toEqual([
			{ id: 'job-1', amount_units: 200, balance_after: 1 },
			{ id: 'job-2', amount_units: 200, balance_after: 0 }
		]);
		expect(warning).toHaveBeenCalledOnce();
		expect(warning).toHaveBeenCalledWith(
			'Object replacement credit deduction exceeded available balance:',
			{ jobId: 'job-2' }
		);
		warning.mockRestore();
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
		const credit = await getCredit(db, 'user-1');
		expect(credit?.balance).toBe(12);
	});
});
