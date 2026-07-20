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

export type ObjectReplacementJobStatus = 'processing' | 'completed' | 'failed';

export interface ObjectReplacementJob {
	id: string;
	userId: string;
	comfyPromptId: string;
	sceneUrl: string;
	referenceUrl: string;
	replacementObject: string;
	cost: number;
	status: ObjectReplacementJobStatus;
	outputUrl: string | null;
	errorCode: string | null;
	balanceAfter: number | null;
	createdAt: number;
	updatedAt: number;
	completedAt: number | null;
}

interface ObjectReplacementJobRow {
	id: string;
	user_id: string;
	comfy_prompt_id: string;
	scene_url: string;
	reference_url: string;
	replacement_object: string;
	cost: number;
	status: ObjectReplacementJobStatus;
	output_url: string | null;
	error_code: string | null;
	balance_after: number | null;
	created_at: number;
	updated_at: number;
	completed_at: number | null;
}

function toObjectReplacementJob(row: ObjectReplacementJobRow): ObjectReplacementJob {
	return {
		id: row.id,
		userId: row.user_id,
		comfyPromptId: row.comfy_prompt_id,
		sceneUrl: row.scene_url,
		referenceUrl: row.reference_url,
		replacementObject: row.replacement_object,
		cost: row.cost,
		status: row.status,
		outputUrl: row.output_url,
		errorCode: row.error_code,
		balanceAfter: row.balance_after,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		completedAt: row.completed_at
	};
}

export async function createObjectReplacementJob(
	db: D1Database,
	input: {
		id: string;
		userId: string;
		comfyPromptId: string;
		sceneUrl: string;
		referenceUrl: string;
		replacementObject: string;
		cost: number;
		createdAt: number;
	}
): Promise<ObjectReplacementJob> {
	const row = await db
		.prepare(
			'INSERT INTO object_replacement_jobs ' +
				'(id, user_id, comfy_prompt_id, scene_url, reference_url, replacement_object, cost, status, created_at, updated_at) ' +
				"VALUES (?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?) RETURNING *"
		)
		.bind(
			input.id,
			input.userId,
			input.comfyPromptId,
			input.sceneUrl,
			input.referenceUrl,
			input.replacementObject,
			input.cost,
			input.createdAt,
			input.createdAt
		)
		.first<ObjectReplacementJobRow>();
	if (!row) throw new Error('object replacement job insert failed');
	return toObjectReplacementJob(row);
}

export async function getObjectReplacementJob(
	db: D1Database,
	userId: string,
	id: string
): Promise<ObjectReplacementJob | null> {
	const row = await db
		.prepare('SELECT * FROM object_replacement_jobs WHERE id = ? AND user_id = ?')
		.bind(id, userId)
		.first<ObjectReplacementJobRow>();
	return row ? toObjectReplacementJob(row) : null;
}

export async function failObjectReplacementJob(
	db: D1Database,
	userId: string,
	id: string,
	errorCode: string,
	completedAt: number
): Promise<ObjectReplacementJob> {
	const row = await db
		.prepare(
			"UPDATE object_replacement_jobs SET status = 'failed', error_code = ?, updated_at = ?, completed_at = ? " +
				"WHERE id = ? AND user_id = ? AND status = 'processing' RETURNING *"
		)
		.bind(errorCode, completedAt, completedAt, id, userId)
		.first<ObjectReplacementJobRow>();
	if (row) return toObjectReplacementJob(row);
	const existing = await getObjectReplacementJob(db, userId, id);
	if (!existing) throw new Error('object replacement job not found');
	return existing;
}

export async function completeObjectReplacementJob(
	db: D1Database,
	userId: string,
	id: string,
	outputUrl: string,
	completedAt: number
): Promise<ObjectReplacementJob> {
	const results = await db.batch<ObjectReplacementJobRow>([
		db
			.prepare(
				'UPDATE credits SET balance = balance - ' +
					"(SELECT cost FROM object_replacement_jobs WHERE id = ? AND user_id = ? AND status = 'processing'), " +
					'updated_at = ? WHERE user_id = ? AND EXISTS ' +
					"(SELECT 1 FROM object_replacement_jobs WHERE id = ? AND user_id = ? AND status = 'processing') " +
					'RETURNING balance'
			)
			.bind(id, userId, completedAt, userId, id, userId),
		db
			.prepare(
				'INSERT INTO generations ' +
					'(id, user_id, url, source_url, prompt, kind, amount, balance_after, created_at) ' +
					"SELECT j.id, j.user_id, ?, j.scene_url, j.replacement_object, 'object-replacement', j.cost, c.balance, ? " +
					'FROM object_replacement_jobs j JOIN credits c ON c.user_id = j.user_id ' +
					"WHERE j.id = ? AND j.user_id = ? AND j.status = 'processing'"
			)
			.bind(outputUrl, completedAt, id, userId),
		db
			.prepare(
				"UPDATE object_replacement_jobs SET status = 'completed', output_url = ?, " +
					'balance_after = (SELECT balance FROM credits WHERE user_id = ?), updated_at = ?, completed_at = ? ' +
					"WHERE id = ? AND user_id = ? AND status = 'processing' " +
					'AND EXISTS (SELECT 1 FROM credits WHERE user_id = ?) RETURNING *'
			)
			.bind(outputUrl, userId, completedAt, completedAt, id, userId, userId)
	]);
	const row = results[2]?.results[0];
	if (row) return toObjectReplacementJob(row);
	const existing = await getObjectReplacementJob(db, userId, id);
	if (!existing) throw new Error('object replacement job not found');
	if (existing.status === 'processing') throw new Error('object replacement job completion failed');
	return existing;
}
