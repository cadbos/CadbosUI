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
import type { RequestFormSnapshot } from '$lib/api/contract';
import type { Database } from '$lib/server/db';

export type RepaintJobStatus = 'processing' | 'completed' | 'failed';

export interface RepaintJob {
	id: string;
	userId: string;
	comfyPromptId: string;
	sceneMediaId: number;
	sessionId: string;
	target: string;
	color: string;
	cost: number;
	status: RepaintJobStatus;
	outputMediaId: number | null;
	errorCode: string | null;
	balanceAfter: number | null;
	createdAt: number;
	updatedAt: number;
	completedAt: number | null;
}

interface RepaintJobRow {
	id: string;
	user_id: string;
	comfy_prompt_id: string;
	scene_media_id: number;
	session_id: string;
	target: string;
	color: string;
	cost: number;
	status: RepaintJobStatus;
	output_media_id: number | null;
	error_code: string | null;
	balance_after: number | null;
	created_at: number;
	updated_at: number;
	completed_at: number | null;
}

interface RepaintDeductionSnapshotRow {
	available_balance: number;
	cost: number;
}

function toRepaintJob(row: RepaintJobRow): RepaintJob {
	return {
		id: row.id,
		userId: row.user_id,
		comfyPromptId: row.comfy_prompt_id,
		sceneMediaId: row.scene_media_id,
		sessionId: row.session_id,
		target: row.target,
		color: row.color,
		cost: row.cost,
		status: row.status,
		outputMediaId: row.output_media_id,
		errorCode: row.error_code,
		balanceAfter: row.balance_after,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		completedAt: row.completed_at
	};
}

export async function createRepaintJob(
	db: Database,
	input: {
		id: string;
		userId: string;
		comfyPromptId: string;
		sceneMediaId: number;
		sessionId: string;
		target: string;
		color: string;
		cost: number;
		createdAt: number;
		uploadQueueSec: number;
		formSnapshot?: RequestFormSnapshot;
	}
): Promise<RepaintJob> {
	await db.run(sql`INSERT INTO repaint_jobs
		(id, user_id, comfy_prompt_id, scene_media_id, session_id, target, color, cost, status, created_at, updated_at, upload_queue_sec, form_snapshot)
		VALUES (${input.id}, ${input.userId}, ${input.comfyPromptId}, ${input.sceneMediaId}, ${input.sessionId}, ${input.target}, ${input.color}, ${input.cost}, 'processing', ${input.createdAt}, ${input.createdAt}, ${input.uploadQueueSec}, ${input.formSnapshot ? JSON.stringify(input.formSnapshot) : null})`);
	const job = await getRepaintJob(db, input.userId, input.id);
	if (!job) throw new Error('repaint job insert failed');
	return job;
}

export async function getRepaintJob(
	db: Database,
	userId: string,
	id: string
): Promise<RepaintJob | null> {
	const row =
		await db.get<RepaintJobRow>(sql`SELECT j.id, j.user_id, j.comfy_prompt_id, j.scene_media_id, j.session_id,
		j.target, j.color, j.cost, j.status, j.output_media_id,
		j.error_code, j.balance_after, j.created_at, j.updated_at, j.completed_at
		FROM repaint_jobs j WHERE j.id = ${id} AND j.user_id = ${userId}`);
	return row ? toRepaintJob(row) : null;
}

export async function failRepaintJob(
	db: Database,
	userId: string,
	id: string,
	errorCode: string,
	completedAt: number,
	queueWaitSec: number,
	executionSec: number,
	downloadSec = 0
): Promise<RepaintJob> {
	await db.run(sql`UPDATE repaint_jobs SET status = 'failed', error_code = ${errorCode},
		updated_at = ${completedAt}, completed_at = ${completedAt}, queue_wait_sec = ${queueWaitSec},
		execution_sec = ${executionSec}, download_sec = ${downloadSec}
		WHERE id = ${id} AND user_id = ${userId} AND status = 'processing'`);
	const job = await getRepaintJob(db, userId, id);
	if (!job) throw new Error('repaint job not found');
	return job;
}

export async function completeRepaintJob(
	db: Database,
	userId: string,
	id: string,
	outputMediaId: number,
	completedAt: number,
	queueWaitSec: number,
	executionSec: number,
	downloadSec: number,
	reuploadSec: number
): Promise<RepaintJob> {
	const [snapshotRows] = await db.batch([
		db.all<RepaintDeductionSnapshotRow>(sql`SELECT c.balance AS available_balance, j.cost FROM credits c
			JOIN repaint_jobs j ON j.user_id = c.user_id
			WHERE j.id = ${id} AND j.user_id = ${userId} AND j.status = 'processing'`),
		db.run(sql`UPDATE credits SET balance = MAX(balance -
			(SELECT cost FROM repaint_jobs WHERE id = ${id} AND user_id = ${userId} AND status = 'processing'), 0),
			updated_at = ${completedAt} WHERE user_id = ${userId} AND EXISTS
			(SELECT 1 FROM repaint_jobs WHERE id = ${id} AND user_id = ${userId} AND status = 'processing')`),
		db.run(sql`INSERT INTO generations
			(id, user_id, result_media_id, source_media_id, prompt, kind, amount, balance_after, created_at, session_id,
			comfyui_upload_queue_sec, comfyui_queue_wait_sec, comfyui_execution_sec, comfyui_download_sec, comfyui_reupload_sec, form_snapshot)
			SELECT j.id, j.user_id, ${outputMediaId}, j.scene_media_id, j.target, 'repaint', j.cost, c.balance, ${completedAt}, j.session_id,
			j.upload_queue_sec, ${queueWaitSec}, ${executionSec}, ${downloadSec}, ${reuploadSec}, j.form_snapshot
			FROM repaint_jobs j JOIN credits c ON c.user_id = j.user_id
			WHERE j.id = ${id} AND j.user_id = ${userId} AND j.status = 'processing'`),
		db.run(sql`UPDATE repaint_jobs SET status = 'completed', output_media_id = ${outputMediaId},
			balance_after = (SELECT balance FROM credits WHERE user_id = ${userId}), updated_at = ${completedAt}, completed_at = ${completedAt},
			queue_wait_sec = ${queueWaitSec}, execution_sec = ${executionSec}, download_sec = ${downloadSec}, reupload_sec = ${reuploadSec}
			WHERE id = ${id} AND user_id = ${userId} AND status = 'processing'
			AND EXISTS (SELECT 1 FROM credits WHERE user_id = ${userId})`)
	]);
	const snapshot = snapshotRows[0];
	if (snapshot && snapshot.available_balance < snapshot.cost) {
		console.warn('Repaint credit deduction exceeded available balance:', {
			jobId: id
		});
	}
	const job = await getRepaintJob(db, userId, id);
	if (!job) throw new Error('repaint job not found');
	if (job.status === 'processing') throw new Error('repaint job completion failed');
	return job;
}
