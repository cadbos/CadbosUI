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

export type TextureReplacementJobStatus = 'processing' | 'completed' | 'failed';

export interface TextureReplacementJob {
	id: string;
	userId: string;
	comfyPromptId: string;
	sceneUrl: string;
	referenceUrl: string;
	replacementSurface: string;
	cost: number;
	status: TextureReplacementJobStatus;
	outputUrl: string | null;
	errorCode: string | null;
	balanceAfter: number | null;
	createdAt: number;
	updatedAt: number;
	completedAt: number | null;
}

interface TextureReplacementJobRow {
	id: string;
	user_id: string;
	comfy_prompt_id: string;
	scene_url: string;
	reference_url: string;
	replacement_surface: string;
	cost: number;
	status: TextureReplacementJobStatus;
	output_url: string | null;
	error_code: string | null;
	balance_after: number | null;
	created_at: number;
	updated_at: number;
	completed_at: number | null;
}

interface TextureReplacementDeductionSnapshotRow {
	available_balance: number;
	cost: number;
}

function toTextureReplacementJob(row: TextureReplacementJobRow): TextureReplacementJob {
	return {
		id: row.id,
		userId: row.user_id,
		comfyPromptId: row.comfy_prompt_id,
		sceneUrl: row.scene_url,
		referenceUrl: row.reference_url,
		replacementSurface: row.replacement_surface,
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

export async function createTextureReplacementJob(
	db: D1Database,
	input: {
		id: string;
		userId: string;
		comfyPromptId: string;
		sceneUrl: string;
		referenceUrl: string;
		replacementSurface: string;
		cost: number;
		createdAt: number;
	}
): Promise<TextureReplacementJob> {
	const row = await db
		.prepare(
			'INSERT INTO texture_replacement_jobs ' +
				'(id, user_id, comfy_prompt_id, scene_url, reference_url, replacement_surface, cost, status, created_at, updated_at) ' +
				"VALUES (?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?) RETURNING *"
		)
		.bind(
			input.id,
			input.userId,
			input.comfyPromptId,
			input.sceneUrl,
			input.referenceUrl,
			input.replacementSurface,
			input.cost,
			input.createdAt,
			input.createdAt
		)
		.first<TextureReplacementJobRow>();
	if (!row) throw new Error('texture replacement job insert failed');
	return toTextureReplacementJob(row);
}

export async function getTextureReplacementJob(
	db: D1Database,
	userId: string,
	id: string
): Promise<TextureReplacementJob | null> {
	const row = await db
		.prepare('SELECT * FROM texture_replacement_jobs WHERE id = ? AND user_id = ?')
		.bind(id, userId)
		.first<TextureReplacementJobRow>();
	return row ? toTextureReplacementJob(row) : null;
}

export async function failTextureReplacementJob(
	db: D1Database,
	userId: string,
	id: string,
	errorCode: string,
	completedAt: number
): Promise<TextureReplacementJob> {
	const row = await db
		.prepare(
			"UPDATE texture_replacement_jobs SET status = 'failed', error_code = ?, updated_at = ?, completed_at = ? " +
				"WHERE id = ? AND user_id = ? AND status = 'processing' RETURNING *"
		)
		.bind(errorCode, completedAt, completedAt, id, userId)
		.first<TextureReplacementJobRow>();
	if (row) return toTextureReplacementJob(row);
	const existing = await getTextureReplacementJob(db, userId, id);
	if (!existing) throw new Error('texture replacement job not found');
	return existing;
}

export async function completeTextureReplacementJob(
	db: D1Database,
	userId: string,
	id: string,
	outputUrl: string,
	completedAt: number
): Promise<TextureReplacementJob> {
	const results = await db.batch<TextureReplacementDeductionSnapshotRow | TextureReplacementJobRow>(
		[
			db
				.prepare(
					'SELECT c.balance AS available_balance, j.cost FROM credits c ' +
						'JOIN texture_replacement_jobs j ON j.user_id = c.user_id ' +
						"WHERE j.id = ? AND j.user_id = ? AND j.status = 'processing'"
				)
				.bind(id, userId),
			db
				.prepare(
					'UPDATE credits SET balance = MAX(balance - ' +
						"(SELECT cost FROM texture_replacement_jobs WHERE id = ? AND user_id = ? AND status = 'processing'), " +
						'0), ' +
						'updated_at = ? WHERE user_id = ? AND EXISTS ' +
						"(SELECT 1 FROM texture_replacement_jobs WHERE id = ? AND user_id = ? AND status = 'processing')"
				)
				.bind(id, userId, completedAt, userId, id, userId),
			db
				.prepare(
					'INSERT INTO generations ' +
						'(id, user_id, url, source_url, prompt, kind, amount, balance_after, created_at) ' +
						"SELECT j.id, j.user_id, ?, j.scene_url, j.replacement_surface, 'texture-replacement', j.cost, c.balance, ? " +
						'FROM texture_replacement_jobs j JOIN credits c ON c.user_id = j.user_id ' +
						"WHERE j.id = ? AND j.user_id = ? AND j.status = 'processing'"
				)
				.bind(outputUrl, completedAt, id, userId),
			db
				.prepare(
					"UPDATE texture_replacement_jobs SET status = 'completed', output_url = ?, " +
						'balance_after = (SELECT balance FROM credits WHERE user_id = ?), updated_at = ?, completed_at = ? ' +
						"WHERE id = ? AND user_id = ? AND status = 'processing' " +
						'AND EXISTS (SELECT 1 FROM credits WHERE user_id = ?) RETURNING *'
				)
				.bind(outputUrl, userId, completedAt, completedAt, id, userId, userId)
		]
	);
	const snapshot = results[0]?.results[0];
	if (snapshot && 'available_balance' in snapshot && snapshot.available_balance < snapshot.cost) {
		console.warn('Texture replacement credit deduction exceeded available balance:', {
			jobId: id
		});
	}
	const row = results[3]?.results[0];
	if (row && 'id' in row) return toTextureReplacementJob(row);
	const existing = await getTextureReplacementJob(db, userId, id);
	if (!existing) throw new Error('texture replacement job not found');
	if (existing.status === 'processing') {
		throw new Error('texture replacement job completion failed');
	}
	return existing;
}
