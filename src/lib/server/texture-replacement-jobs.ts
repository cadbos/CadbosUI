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

export type TextureReplacementJobStatus = 'processing' | 'completed' | 'failed';

export interface TextureReplacementJob {
	id: string;
	userId: string;
	comfyPromptId: string;
	sceneUrl: string;
	sessionId: string;
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
	scene_filename: string;
	scene_bucket_url: string;
	session_id: string;
	reference_filename: string;
	reference_bucket_url: string;
	replacement_surface: string;
	cost: number;
	status: TextureReplacementJobStatus;
	output_filename: string | null;
	output_bucket_url: string | null;
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
		sceneUrl: mediaUrl(row.scene_bucket_url, row.scene_filename),
		sessionId: row.session_id,
		referenceUrl: mediaUrl(row.reference_bucket_url, row.reference_filename),
		replacementSurface: row.replacement_surface,
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

export async function createTextureReplacementJob(
	db: Database,
	input: {
		id: string;
		userId: string;
		comfyPromptId: string;
		sceneUrl: string;
		sceneHash: string;
		sessionId: string;
		referenceUrl: string;
		replacementSurface: string;
		cost: number;
		createdAt: number;
	}
): Promise<TextureReplacementJob> {
	const [scene, reference] = await Promise.all([
		getOrCreateMedia(db, input.sceneUrl, input.sceneHash),
		getOrCreateMedia(db, input.referenceUrl, '')
	]);
	await db.run(
		sql`INSERT INTO texture_replacement_jobs
			(id, user_id, comfy_prompt_id, scene_media_id, session_id, reference_media_id, replacement_surface, cost, status, created_at, updated_at)
			VALUES (${input.id}, ${input.userId}, ${input.comfyPromptId}, ${scene.id}, ${input.sessionId}, ${reference.id}, ${input.replacementSurface}, ${input.cost}, 'processing', ${input.createdAt}, ${input.createdAt})`
	);
	const job = await getTextureReplacementJob(db, input.userId, input.id);
	if (!job) throw new Error('texture replacement job insert failed');
	return job;
}

export async function getTextureReplacementJob(
	db: Database,
	userId: string,
	id: string
): Promise<TextureReplacementJob | null> {
	const row = await db.get<TextureReplacementJobRow>(
		sql`SELECT j.id, j.user_id, j.comfy_prompt_id, scene.filename AS scene_filename,
			scene_bucket.url AS scene_bucket_url, j.session_id,
			reference.filename AS reference_filename, reference_bucket.url AS reference_bucket_url,
			j.replacement_surface, j.cost, j.status, output.filename AS output_filename,
			output_bucket.url AS output_bucket_url, j.error_code, j.balance_after,
			j.created_at, j.updated_at, j.completed_at FROM texture_replacement_jobs j
			JOIN media scene ON scene.id = j.scene_media_id
			JOIN buckets scene_bucket ON scene_bucket.id = scene.bucket
			JOIN media reference ON reference.id = j.reference_media_id
			JOIN buckets reference_bucket ON reference_bucket.id = reference.bucket
			LEFT JOIN media output ON output.id = j.output_media_id
			LEFT JOIN buckets output_bucket ON output_bucket.id = output.bucket
			WHERE j.id = ${id} AND j.user_id = ${userId}`
	);
	return row ? toTextureReplacementJob(row) : null;
}

export async function failTextureReplacementJob(
	db: Database,
	userId: string,
	id: string,
	errorCode: string,
	completedAt: number
): Promise<TextureReplacementJob> {
	await db.run(
		sql`UPDATE texture_replacement_jobs SET status = 'failed', error_code = ${errorCode}, updated_at = ${completedAt}, completed_at = ${completedAt}
			WHERE id = ${id} AND user_id = ${userId} AND status = 'processing'`
	);
	const job = await getTextureReplacementJob(db, userId, id);
	if (!job) throw new Error('texture replacement job not found');
	return job;
}

export async function completeTextureReplacementJob(
	db: Database,
	userId: string,
	id: string,
	outputUrl: string,
	outputHash: string,
	completedAt: number
): Promise<TextureReplacementJob> {
	const output = await getOrCreateMedia(db, outputUrl, outputHash);
	const [snapshotRows] = await db.batch([
		db.all<TextureReplacementDeductionSnapshotRow>(
			sql`SELECT c.balance AS available_balance, j.cost FROM credits c
				JOIN texture_replacement_jobs j ON j.user_id = c.user_id
				WHERE j.id = ${id} AND j.user_id = ${userId} AND j.status = 'processing'`
		),
		db.run(
			sql`UPDATE credits SET balance = MAX(balance -
				(SELECT cost FROM texture_replacement_jobs WHERE id = ${id} AND user_id = ${userId} AND status = 'processing'), 0),
				updated_at = ${completedAt} WHERE user_id = ${userId} AND EXISTS
				(SELECT 1 FROM texture_replacement_jobs WHERE id = ${id} AND user_id = ${userId} AND status = 'processing')`
		),
		db.run(
			sql`INSERT INTO generations
				(id, user_id, result_media_id, source_media_id, prompt, kind, amount, balance_after, created_at, session_id)
				SELECT j.id, j.user_id, ${output.id}, j.scene_media_id, j.replacement_surface, 'texture-replacement', j.cost, c.balance, ${completedAt}, j.session_id
				FROM texture_replacement_jobs j JOIN credits c ON c.user_id = j.user_id
				WHERE j.id = ${id} AND j.user_id = ${userId} AND j.status = 'processing'`
		),
		db.run(
			sql`UPDATE texture_replacement_jobs SET status = 'completed', output_media_id = ${output.id},
				balance_after = (SELECT balance FROM credits WHERE user_id = ${userId}), updated_at = ${completedAt}, completed_at = ${completedAt}
				WHERE id = ${id} AND user_id = ${userId} AND status = 'processing'
				AND EXISTS (SELECT 1 FROM credits WHERE user_id = ${userId})`
		)
	]);
	const snapshot = snapshotRows[0];
	if (snapshot && snapshot.available_balance < snapshot.cost) {
		console.warn('Texture replacement credit deduction exceeded available balance:', { jobId: id });
	}
	const job = await getTextureReplacementJob(db, userId, id);
	if (!job) throw new Error('texture replacement job not found');
	if (job.status === 'processing') throw new Error('texture replacement job completion failed');
	return job;
}
