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
import { describe, expect, it } from 'vitest';
import type { Database } from '$lib/server/db';
import {
	completeFluxKontextEditJob,
	createFluxKontextEditJob,
	failFluxKontextEditJob,
	getFluxKontextEditJob
} from '$lib/server/flux-kontext-edit-jobs';
import { makeDb } from '$lib/server/testing/d1-shim';
import { seedManagedMedia } from '$lib/server/testing/generation-fixtures';

async function seedAccount(db: Database): Promise<void> {
	await db.run(sql`INSERT INTO users (id, pubkey, created_at) VALUES ('user-1', 'pubkey-1', 1)`);
	await db.run(
		sql`INSERT INTO credits (user_id, balance, updated_at, enabled) VALUES ('user-1', 12, 1, 1)`
	);
	await db.run(
		sql`INSERT INTO projects (id, user_id, title, created_at, updated_at) VALUES ('project-1', 'user-1', 'Test project', 1, 1)`
	);
	await db.run(
		sql`INSERT INTO project_sessions (id, project_id, title, created_at, updated_at) VALUES ('session-1', 'project-1', 'Test session', 1, 1)`
	);
}

describe('flux kontext edit jobs', () => {
	it('stores media references and atomically records a completed generation', async () => {
		const db = makeDb();
		await seedAccount(db);
		const sceneMediaId = await seedManagedMedia(db, 'scene.jpg', 'a'.repeat(64));
		const outputMediaId = await seedManagedMedia(db, 'edits/job-1.png', 'b'.repeat(64));

		const created = await createFluxKontextEditJob(db, {
			id: 'job-1',
			userId: 'user-1',
			comfyPromptId: 'prompt-1',
			sceneMediaId,
			sessionId: 'session-1',
			instruction: 'make the walls white',
			cost: 2,
			createdAt: 10
		});
		expect(created).toMatchObject({ sceneMediaId, status: 'processing', outputMediaId: null });

		const completed = await completeFluxKontextEditJob(db, 'user-1', 'job-1', outputMediaId, 20);
		expect(completed).toMatchObject({ outputMediaId, status: 'completed', balanceAfter: 10 });

		const references = await db.get<{
			scene_media_id: number;
			output_media_id: number;
			source_media_id: number;
			result_media_id: number;
			kind: string;
		}>(
			sql`SELECT j.scene_media_id, j.output_media_id, g.source_media_id, g.result_media_id, g.kind
				FROM flux_kontext_edit_jobs j JOIN generations g ON g.id = j.id WHERE j.id = 'job-1'`
		);
		expect(references).toMatchObject({
			source_media_id: references?.scene_media_id,
			result_media_id: references?.output_media_id,
			kind: 'edit'
		});
	});

	it('fails a processing job with an error code and completed timestamp', async () => {
		const db = makeDb();
		await seedAccount(db);
		const sceneMediaId = await seedManagedMedia(db, 'scene.jpg', 'a'.repeat(64));
		await createFluxKontextEditJob(db, {
			id: 'job-1',
			userId: 'user-1',
			comfyPromptId: 'prompt-1',
			sceneMediaId,
			sessionId: 'session-1',
			instruction: 'remove the sofa',
			cost: 2,
			createdAt: 10
		});

		const failed = await failFluxKontextEditJob(db, 'user-1', 'job-1', 'edit_timeout', 30);

		expect(failed).toMatchObject({
			status: 'failed',
			errorCode: 'edit_timeout',
			completedAt: 30
		});
		await expect(getFluxKontextEditJob(db, 'user-1', 'job-1')).resolves.toMatchObject({
			status: 'failed'
		});
	});
});
