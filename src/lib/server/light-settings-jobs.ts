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

export type LightSettingsJobStatus = 'processing' | 'completed' | 'failed';

export interface LightSettingsJob {
	id: string;
	userId: string;
	comfyPromptId: string;
	sceneMediaId: number;
	sessionId: string;
	instruction: string;
	cost: number;
	status: LightSettingsJobStatus;
	outputMediaId: number | null;
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
	scene_media_id: number;
	session_id: string;
	instruction: string;
	cost: number;
	status: LightSettingsJobStatus;
	output_media_id: number | null;
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
		sceneMediaId: row.scene_media_id,
		sessionId: row.session_id,
		instruction: row.instruction,
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

export async function createLightSettingsJob(
	db: D1Database,
	input: {
		id: string;
		userId: string;
		comfyPromptId: string;
		sceneMediaId: number;
		sessionId: string;
		instruction: string;
		cost: number;
		createdAt: number;
	}
): Promise<LightSettingsJob> {
	await db
		.prepare(
			'INSERT INTO light_settings_jobs ' +
				'(id, user_id, comfy_prompt_id, scene_media_id, session_id, instruction, cost, status, created_at, updated_at) ' +
				"VALUES (?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?)"
		)
		.bind(
			input.id,
			input.userId,
			input.comfyPromptId,
			input.sceneMediaId,
			input.sessionId,
			input.instruction,
			input.cost,
			input.createdAt,
			input.createdAt
		)
		.run();
	const job = await getLightSettingsJob(db, input.userId, input.id);
	if (!job) throw new Error('light settings job insert failed');
	return job;
}

export async function getLightSettingsJob(
	db: D1Database,
	userId: string,
	id: string
): Promise<LightSettingsJob | null> {
	const row = await db
		.prepare(
			'SELECT j.id, j.user_id, j.comfy_prompt_id, j.scene_media_id, j.session_id, ' +
				'j.instruction, j.cost, j.status, j.output_media_id, ' +
				'j.error_code, j.balance_after, j.created_at, j.updated_at, j.completed_at ' +
				'FROM light_settings_jobs j ' +
				'WHERE j.id = ? AND j.user_id = ?'
		)
		.bind(id, userId)
		.first<LightSettingsJobRow>();
	return row ? toLightSettingsJob(row) : null;
}

export async function failLightSettingsJob(
	db: D1Database,
	userId: string,
	id: string,
	errorCode: string,
	completedAt: number
): Promise<LightSettingsJob> {
	await db
		.prepare(
			"UPDATE light_settings_jobs SET status = 'failed', error_code = ?, updated_at = ?, completed_at = ? " +
				"WHERE id = ? AND user_id = ? AND status = 'processing'"
		)
		.bind(errorCode, completedAt, completedAt, id, userId)
		.run();
	const job = await getLightSettingsJob(db, userId, id);
	if (!job) throw new Error('light settings job not found');
	return job;
}

export async function completeLightSettingsJob(
	db: D1Database,
	userId: string,
	id: string,
	outputMediaId: number,
	completedAt: number
): Promise<LightSettingsJob> {
	const results = await db.batch<LightSettingsDeductionSnapshotRow>([
		db
			.prepare(
				'SELECT c.balance AS available_balance, j.cost FROM credits c ' +
					'JOIN light_settings_jobs j ON j.user_id = c.user_id ' +
					"WHERE j.id = ? AND j.user_id = ? AND j.status = 'processing'"
			)
			.bind(id, userId),
		db
			.prepare(
				'UPDATE credits SET balance = MAX(balance - ' +
					"(SELECT cost FROM light_settings_jobs WHERE id = ? AND user_id = ? AND status = 'processing'), " +
					'0), ' +
					'updated_at = ? WHERE user_id = ? AND EXISTS ' +
					"(SELECT 1 FROM light_settings_jobs WHERE id = ? AND user_id = ? AND status = 'processing')"
			)
			.bind(id, userId, completedAt, userId, id, userId),
		db
			.prepare(
				'INSERT INTO generations ' +
					'(id, user_id, result_media_id, source_media_id, prompt, kind, amount, balance_after, created_at, session_id) ' +
					"SELECT j.id, j.user_id, ?, j.scene_media_id, j.instruction, 'light-settings', j.cost, c.balance, ?, j.session_id " +
					'FROM light_settings_jobs j JOIN credits c ON c.user_id = j.user_id ' +
					"WHERE j.id = ? AND j.user_id = ? AND j.status = 'processing'"
			)
			.bind(outputMediaId, completedAt, id, userId),
		db
			.prepare(
				"UPDATE light_settings_jobs SET status = 'completed', output_media_id = ?, " +
					'balance_after = (SELECT balance FROM credits WHERE user_id = ?), updated_at = ?, completed_at = ? ' +
					"WHERE id = ? AND user_id = ? AND status = 'processing' " +
					'AND EXISTS (SELECT 1 FROM credits WHERE user_id = ?)'
			)
			.bind(outputMediaId, userId, completedAt, completedAt, id, userId, userId)
	]);
	const snapshot = results[0]?.results[0];
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
