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

import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '$lib/server/db';
import {
	completeTextureReplacementJob,
	createTextureReplacementJob
} from '$lib/server/texture-replacement-jobs';
import { makeDb } from '$lib/server/testing/d1-shim';

async function seedAccount(db: Database): Promise<void> {
	await db.run(sql`INSERT INTO users (id, pubkey, created_at) VALUES ('user-1', 'pubkey-1', 1)`);
	await db.run(
		sql`INSERT INTO credits (user_id, balance, updated_at, enabled) VALUES ('user-1', 1, 1, 1)`
	);
	await db.run(
		sql`INSERT INTO projects (id, user_id, title, created_at, updated_at) VALUES ('project-1', 'user-1', 'Test project', 1, 1)`
	);
	await db.run(
		sql`INSERT INTO project_sessions (id, project_id, title, created_at, updated_at) VALUES ('session-1', 'project-1', 'Test session', 1, 1)`
	);
}

describe('texture replacement jobs', () => {
	it('clamps completion spending at zero and warns', async () => {
		const db = makeDb();
		await seedAccount(db);
		await createTextureReplacementJob(db, {
			id: 'job-1',
			userId: 'user-1',
			comfyPromptId: 'prompt-job-1',
			sceneUrl: 'https://cdn.example.test/scene.jpg',
			sceneHash: 'hash-scene',
			sessionId: 'session-1',
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
			'',
			20
		);

		expect(job).toMatchObject({ status: 'completed', balanceAfter: 0, cost: 2 });
		const credit = await db.get<{ balance: number }>(
			sql`SELECT balance FROM credits WHERE user_id = 'user-1'`
		);
		const generation = await db.get<{ amount: number; balance_after: number }>(
			sql`SELECT amount, balance_after FROM generations WHERE id = 'job-1'`
		);
		expect(credit?.balance).toBe(0);
		expect(generation).toEqual({ amount: 2, balance_after: 0 });
		expect(warning).toHaveBeenCalledOnce();
		expect(warning).toHaveBeenCalledWith(
			'Texture replacement credit deduction exceeded available balance:',
			{ jobId: 'job-1' }
		);
		warning.mockRestore();
	});
});
