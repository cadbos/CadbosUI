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
import { getCredit } from '$lib/server/billing';
import {
	completeTextureReplacementJob,
	createTextureReplacementJob
} from '$lib/server/texture-replacement-jobs';
import { grantGenerationAccess, makeD1 } from '$lib/server/testing/d1-shim';

function seedAccount(db: D1Database): void {
	db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind('user-1', 'pubkey-1', 1)
		.run();
	grantGenerationAccess(db, 'user-1', 1, 1, 1);
}

describe('texture replacement jobs', () => {
	it('clamps completion spending at zero and warns', async () => {
		const db = makeD1();
		seedAccount(db);
		await createTextureReplacementJob(db, {
			id: 'job-1',
			userId: 'user-1',
			comfyPromptId: 'prompt-job-1',
			sceneUrl: 'https://cdn.example.test/scene.jpg',
			sceneHash: 'hash-scene',
			referenceUrl: 'https://cdn.example.test/reference.jpg',
			replacementSurface: 'oak flooring',
			cost: 2,
			createdAt: 10
		});
		const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		const job = await completeTextureReplacementJob(
			db,
			'user-1',
			'job-1',
			'https://cdn.example.test/result.png',
			20
		);

		expect(job).toMatchObject({ status: 'completed', balanceAfter: 0, cost: 2 });
		const credit = await getCredit(db, 'user-1');
		const generation = await db
			.prepare(
				'SELECT -entry.amount / 100.0 AS amount, job.balance_after ' +
					'FROM generations generation ' +
					'JOIN texture_replacement_jobs job ON job.id = generation.id ' +
					'JOIN ledger_entries entry ON entry.transaction_id = generation.ledger_transaction_id ' +
					'JOIN ledger_accounts account ON account.id = entry.account_id ' +
					"WHERE generation.id = ? AND account.kind = 'user_balance'"
			)
			.bind('job-1')
			.first<{ amount: number; balance_after: number }>();
		expect(credit?.balance).toBe(0);
		expect(generation).toEqual({ amount: 1, balance_after: 0 });
		expect(warning).toHaveBeenCalledOnce();
		expect(warning).toHaveBeenCalledWith(
			'Texture replacement credit deduction exceeded available balance:',
			{ jobId: 'job-1' }
		);
		warning.mockRestore();
	});
});
