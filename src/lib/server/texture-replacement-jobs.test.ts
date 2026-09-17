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
	completeTextureReplacementJob,
	createTextureReplacementJob
} from '$lib/server/texture-replacement-jobs';
import { makeD1 } from '$lib/server/testing/d1-shim';
import { seedManagedMedia } from '$lib/server/testing/generation-fixtures';

function seedAccount(db: D1Database): void {
	db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind('user-1', 'pubkey-1', 1)
		.run();
	db.prepare('INSERT INTO credits (user_id, balance, updated_at, enabled) VALUES (?, ?, ?, 1)')
		.bind('user-1', 1, 1)
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

describe('texture replacement jobs', () => {
	it('clamps completion spending at zero and warns', async () => {
		const db = makeD1();
		seedAccount(db);
		const sceneMediaId = seedManagedMedia(db, 'scene.jpg');
		const referenceMediaId = seedManagedMedia(db, 'reference.jpg');
		await createTextureReplacementJob(db, {
			id: 'job-1',
			userId: 'user-1',
			comfyPromptId: 'prompt-job-1',
			sceneMediaId,
			sessionId: 'session-1',
			referenceMediaId,
			replacementSurface: 'oak flooring',
			cost: 2,
			createdAt: 10,
			uploadQueueSec: 3
		});
		const outputMediaId = seedManagedMedia(db, 'result.png');
		const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		const job = await completeTextureReplacementJob(
			db,
			'user-1',
			'job-1',
			outputMediaId,
			20,
			5,
			10,
			2,
			1
		);

		expect(job).toMatchObject({ status: 'completed', balanceAfter: 0, cost: 2 });
		const credit = await db
			.prepare('SELECT balance FROM credits WHERE user_id = ?')
			.bind('user-1')
			.first<{ balance: number }>();
		const generation = await db
			.prepare(
				'SELECT amount, balance_after, comfyui_upload_queue_sec, comfyui_queue_wait_sec, ' +
					'comfyui_execution_sec, comfyui_download_sec, comfyui_reupload_sec FROM generations WHERE id = ?'
			)
			.bind('job-1')
			.first<{
				amount: number;
				balance_after: number;
				comfyui_upload_queue_sec: number;
				comfyui_queue_wait_sec: number;
				comfyui_execution_sec: number;
				comfyui_download_sec: number;
				comfyui_reupload_sec: number;
			}>();
		expect(credit?.balance).toBe(0);
		expect(generation).toEqual({
			amount: 2,
			balance_after: 0,
			comfyui_upload_queue_sec: 3,
			comfyui_queue_wait_sec: 5,
			comfyui_execution_sec: 10,
			comfyui_download_sec: 2,
			comfyui_reupload_sec: 1
		});
		const jobRow = await db
			.prepare(
				'SELECT upload_queue_sec, queue_wait_sec, execution_sec, download_sec, reupload_sec ' +
					'FROM texture_replacement_jobs WHERE id = ?'
			)
			.bind('job-1')
			.first<{
				upload_queue_sec: number;
				queue_wait_sec: number;
				execution_sec: number;
				download_sec: number;
				reupload_sec: number;
			}>();
		expect(jobRow).toEqual({
			upload_queue_sec: 3,
			queue_wait_sec: 5,
			execution_sec: 10,
			download_sec: 2,
			reupload_sec: 1
		});
		expect(warning).toHaveBeenCalledOnce();
		expect(warning).toHaveBeenCalledWith(
			'Texture replacement credit deduction exceeded available balance:',
			{ jobId: 'job-1' }
		);
		warning.mockRestore();
	});
});
