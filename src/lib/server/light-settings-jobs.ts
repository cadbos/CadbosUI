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
import type { Database } from '$lib/server/db';
import { getOrCreateMedia, mediaUrl } from '$lib/server/media';

export type LightSettingsJobStatus = 'processing' | 'completed' | 'failed';

export interface LightSettingsJob {
	id: string;
	userId: string;
	comfyPromptId: string;
	sceneUrl: string;
	sessionId: string;
	instruction: string;
	cost: number;
	status: LightSettingsJobStatus;
	outputUrl: string | null;
	errorCode: string | null;
	balanceAfter: number | null;
	createdAt: number;
	updatedAt: number;
	completedAt: number | null;
}

interface LightSettingsJobRow {
	id: string;
	user_id: string;
	comfy_prompt_id: string;
	scene_filename: string;
	scene_bucket_url: string;
	session_id: string;
	instruction: string;
	cost: number;
	status: LightSettingsJobStatus;
	output_filename: string | null;
	output_bucket_url: string | null;
	error_code: string | null;
	balance_after: number | null;
	created_at: number;
	updated_at: number;
	completed_at: number | null;
}

interface LightSettingsDeductionSnapshotRow {
	available_balance: number;
	cost: number;
}

function toLightSettingsJob(row: LightSettingsJobRow): LightSettingsJob {
	return {
		id: row.id,
		userId: row.user_id,
		comfyPromptId: row.comfy_prompt_id,
		sceneUrl: mediaUrl(row.scene_bucket_url, row.scene_filename),
		sessionId: row.session_id,
		instruction: row.instruction,
		cost: row.cost,
		status: row.status,
		outputUrl:
			row.output_filename === null || row.output_bucket_url === null
				? null
				: mediaUrl(row.output_bucket_url, row.output_filename),
		errorCode: row.error_code,
		balanceAfter: row.balance_after,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		completedAt: row.completed_at
	};
}

export async function createLightSettingsJob(
	db: Database,
	input: {
		id: string;
		userId: string;
		comfyPromptId: string;
		sceneUrl: string;
		sceneHash: string;
		sessionId: string;
		instruction: string;
		cost: number;
		createdAt: number;
	}
): Promise<LightSettingsJob> {
	const scene = await getOrCreateMedia(db, input.sceneUrl, input.sceneHash);
	await db.run(
		sql`INSERT INTO light_settings_jobs
			(id, user_id, comfy_prompt_id, scene_media_id, session_id, instruction, cost, status, created_at, updated_at)
			VALUES (${input.id}, ${input.userId}, ${input.comfyPromptId}, ${scene.id}, ${input.sessionId}, ${input.instruction}, ${input.cost}, 'processing', ${input.createdAt}, ${input.createdAt})`
	);
	const job = await getLightSettingsJob(db, input.userId, input.id);
	if (!job) throw new Error('light settings job insert failed');
	return job;
}

export async function getLightSettingsJob(
	db: Database,
	userId: string,
	id: string
): Promise<LightSettingsJob | null> {
	const row = await db.get<LightSettingsJobRow>(
		sql`SELECT j.id, j.user_id, j.comfy_prompt_id, scene.filename AS scene_filename,
			scene_bucket.url AS scene_bucket_url, j.session_id, j.instruction, j.cost, j.status,
			output.filename AS output_filename, output_bucket.url AS output_bucket_url,
			j.error_code, j.balance_after, j.created_at, j.updated_at, j.completed_at
			FROM light_settings_jobs j JOIN media scene ON scene.id = j.scene_media_id
			JOIN buckets scene_bucket ON scene_bucket.id = scene.bucket
			LEFT JOIN media output ON output.id = j.output_media_id
			LEFT JOIN buckets output_bucket ON output_bucket.id = output.bucket
			WHERE j.id = ${id} AND j.user_id = ${userId}`
	);
	return row ? toLightSettingsJob(row) : null;
}

export async function failLightSettingsJob(
	db: Database,
	userId: string,
	id: string,
	errorCode: string,
	completedAt: number
): Promise<LightSettingsJob> {
	await db.run(
		sql`UPDATE light_settings_jobs SET status = 'failed', error_code = ${errorCode}, updated_at = ${completedAt}, completed_at = ${completedAt}
			WHERE id = ${id} AND user_id = ${userId} AND status = 'processing'`
	);
	const job = await getLightSettingsJob(db, userId, id);
	if (!job) throw new Error('light settings job not found');
	return job;
}

export async function completeLightSettingsJob(
	db: Database,
	userId: string,
	id: string,
	outputUrl: string,
	outputHash: string,
	completedAt: number
): Promise<LightSettingsJob> {
	const output = await getOrCreateMedia(db, outputUrl, outputHash);
	const [snapshotRows] = await db.batch([
		db.all<LightSettingsDeductionSnapshotRow>(
			sql`SELECT c.balance AS available_balance, j.cost FROM credits c
				JOIN light_settings_jobs j ON j.user_id = c.user_id
				WHERE j.id = ${id} AND j.user_id = ${userId} AND j.status = 'processing'`
		),
		db.run(
			sql`UPDATE credits SET balance = MAX(balance -
				(SELECT cost FROM light_settings_jobs WHERE id = ${id} AND user_id = ${userId} AND status = 'processing'), 0),
				updated_at = ${completedAt} WHERE user_id = ${userId} AND EXISTS
				(SELECT 1 FROM light_settings_jobs WHERE id = ${id} AND user_id = ${userId} AND status = 'processing')`
		),
		db.run(
			sql`INSERT INTO generations
				(id, user_id, result_media_id, source_media_id, prompt, kind, amount, balance_after, created_at, session_id)
				SELECT j.id, j.user_id, ${output.id}, j.scene_media_id, j.instruction, 'light-settings', j.cost, c.balance, ${completedAt}, j.session_id
				FROM light_settings_jobs j JOIN credits c ON c.user_id = j.user_id
				WHERE j.id = ${id} AND j.user_id = ${userId} AND j.status = 'processing'`
		),
		db.run(
			sql`UPDATE light_settings_jobs SET status = 'completed', output_media_id = ${output.id},
				balance_after = (SELECT balance FROM credits WHERE user_id = ${userId}), updated_at = ${completedAt}, completed_at = ${completedAt}
				WHERE id = ${id} AND user_id = ${userId} AND status = 'processing'
				AND EXISTS (SELECT 1 FROM credits WHERE user_id = ${userId})`
		)
	]);
	const snapshot = snapshotRows[0];
	if (snapshot && snapshot.available_balance < snapshot.cost) {
		console.warn('Light settings credit deduction exceeded available balance:', {
			jobId: id
		});
	}
	const job = await getLightSettingsJob(db, userId, id);
	if (!job) throw new Error('light settings job not found');
	if (job.status === 'processing') throw new Error('light settings job completion failed');
	return job;
}
