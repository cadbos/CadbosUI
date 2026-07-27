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

export type ColorReplacementJobStatus = 'processing' | 'completed' | 'failed';

export interface ColorReplacementJob {
	id: string;
	userId: string;
	comfyPromptId: string;
	sceneUrl: string;
	targetObject: string;
	color: string;
	cost: number;
	status: ColorReplacementJobStatus;
	outputUrl: string | null;
	errorCode: string | null;
	balanceAfter: number | null;
	createdAt: number;
	updatedAt: number;
	completedAt: number | null;
}

interface ColorReplacementJobRow {
	id: string;
	user_id: string;
	comfy_prompt_id: string;
	scene_url: string;
	target_object: string;
	color: string;
	cost: number;
	status: ColorReplacementJobStatus;
	output_url: string | null;
	error_code: string | null;
	balance_after: number | null;
	created_at: number;
	updated_at: number;
	completed_at: number | null;
}

interface ColorReplacementDeductionSnapshotRow {
	available_balance: number;
	cost: number;
}

function toColorReplacementJob(row: ColorReplacementJobRow): ColorReplacementJob {
	return {
		id: row.id,
		userId: row.user_id,
		comfyPromptId: row.comfy_prompt_id,
		sceneUrl: row.scene_url,
		targetObject: row.target_object,
		color: row.color,
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

export async function createColorReplacementJob(
	db: D1Database,
	input: {
		id: string;
		userId: string;
		comfyPromptId: string;
		sceneUrl: string;
		targetObject: string;
		color: string;
		cost: number;
		createdAt: number;
	}
): Promise<ColorReplacementJob> {
	const row = await db
		.prepare(
			'INSERT INTO color_replacement_jobs ' +
				'(id, user_id, comfy_prompt_id, scene_url, target_object, color, cost, status, created_at, updated_at) ' +
				"VALUES (?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?) RETURNING *"
		)
		.bind(
			input.id,
			input.userId,
			input.comfyPromptId,
			input.sceneUrl,
			input.targetObject,
			input.color,
			input.cost,
			input.createdAt,
			input.createdAt
		)
		.first<ColorReplacementJobRow>();
	if (!row) throw new Error('color replacement job insert failed');
	return toColorReplacementJob(row);
}

export async function getColorReplacementJob(
	db: D1Database,
	userId: string,
	id: string
): Promise<ColorReplacementJob | null> {
	const row = await db
		.prepare('SELECT * FROM color_replacement_jobs WHERE id = ? AND user_id = ?')
		.bind(id, userId)
		.first<ColorReplacementJobRow>();
	return row ? toColorReplacementJob(row) : null;
}

export async function failColorReplacementJob(
	db: D1Database,
	userId: string,
	id: string,
	errorCode: string,
	completedAt: number
): Promise<ColorReplacementJob> {
	const row = await db
		.prepare(
			"UPDATE color_replacement_jobs SET status = 'failed', error_code = ?, updated_at = ?, completed_at = ? " +
				"WHERE id = ? AND user_id = ? AND status = 'processing' RETURNING *"
		)
		.bind(errorCode, completedAt, completedAt, id, userId)
		.first<ColorReplacementJobRow>();
	if (row) return toColorReplacementJob(row);
	const existing = await getColorReplacementJob(db, userId, id);
	if (!existing) throw new Error('color replacement job not found');
	return existing;
}

export async function completeColorReplacementJob(
	db: D1Database,
	userId: string,
	id: string,
	outputUrl: string,
	completedAt: number
): Promise<ColorReplacementJob> {
	const results = await db.batch<ColorReplacementDeductionSnapshotRow | ColorReplacementJobRow>([
		db
			.prepare(
				'SELECT c.balance AS available_balance, j.cost FROM credits c ' +
					'JOIN color_replacement_jobs j ON j.user_id = c.user_id ' +
					"WHERE j.id = ? AND j.user_id = ? AND j.status = 'processing'"
			)
			.bind(id, userId),
		db
			.prepare(
				'UPDATE credits SET balance = MAX(balance - ' +
					"(SELECT cost FROM color_replacement_jobs WHERE id = ? AND user_id = ? AND status = 'processing'), " +
					'0), ' +
					'updated_at = ? WHERE user_id = ? AND EXISTS ' +
					"(SELECT 1 FROM color_replacement_jobs WHERE id = ? AND user_id = ? AND status = 'processing')"
			)
			.bind(id, userId, completedAt, userId, id, userId),
		db
			.prepare(
				'INSERT INTO generations ' +
					'(id, user_id, url, source_url, prompt, kind, amount, balance_after, created_at) ' +
					"SELECT j.id, j.user_id, ?, j.scene_url, j.target_object || ' → ' || j.color, 'color-replacement', j.cost, c.balance, ? " +
					'FROM color_replacement_jobs j JOIN credits c ON c.user_id = j.user_id ' +
					"WHERE j.id = ? AND j.user_id = ? AND j.status = 'processing'"
			)
			.bind(outputUrl, completedAt, id, userId),
		db
			.prepare(
				"UPDATE color_replacement_jobs SET status = 'completed', output_url = ?, " +
					'balance_after = (SELECT balance FROM credits WHERE user_id = ?), updated_at = ?, completed_at = ? ' +
					"WHERE id = ? AND user_id = ? AND status = 'processing' " +
					'AND EXISTS (SELECT 1 FROM credits WHERE user_id = ?) RETURNING *'
			)
			.bind(outputUrl, userId, completedAt, completedAt, id, userId, userId)
	]);
	const snapshot = results[0]?.results[0];
	if (snapshot && 'available_balance' in snapshot && snapshot.available_balance < snapshot.cost) {
		console.warn('Color replacement credit deduction exceeded available balance:', {
			jobId: id
		});
	}
	const row = results[3]?.results[0];
	if (row && 'id' in row) return toColorReplacementJob(row);
	const existing = await getColorReplacementJob(db, userId, id);
	if (!existing) throw new Error('color replacement job not found');
	if (existing.status === 'processing') {
		throw new Error('color replacement job completion failed');
	}
	return existing;
}
