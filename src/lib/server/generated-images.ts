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
import { z } from 'zod';

export interface GeneratedImage {
	id: string;
	userId: string;
	url: string;
	createdAt: number;
}

export interface GeneratedImagesPage {
	images: GeneratedImage[];
	hasMore: boolean;
}

interface GeneratedImageRow {
	id: string;
	user_id: string;
	url: string;
	created_at: number;
}

export type GeneratedImageRecordErrorCode = 'invalid_user_id' | 'unknown_user_id' | 'invalid_url';

export class GeneratedImageRecordError extends Error {
	constructor(
		readonly code: GeneratedImageRecordErrorCode,
		message: string
	) {
		super(message);
		this.name = 'GeneratedImageRecordError';
	}
}

const generatedImageUserIdSchema = z.string().trim().min(1);
const generatedImageUrlSchema = z
	.string()
	.trim()
	.min(1)
	.refine((value) => {
		if (!URL.canParse(value)) return false;
		const parsed = new URL(value);
		return parsed.protocol === 'http:' || parsed.protocol === 'https:';
	});

function toGeneratedImage(row: GeneratedImageRow): GeneratedImage {
	return {
		id: row.id,
		userId: row.user_id,
		url: row.url,
		createdAt: row.created_at
	};
}

export async function recordGeneratedImage(
	db: D1Database,
	userId: string,
	url: string
): Promise<GeneratedImage> {
	const parsedUserId = generatedImageUserIdSchema.safeParse(userId);
	if (!parsedUserId.success) {
		throw new GeneratedImageRecordError('invalid_user_id', 'Generated image user id is invalid');
	}

	const parsedUrl = generatedImageUrlSchema.safeParse(url);
	if (!parsedUrl.success) {
		throw new GeneratedImageRecordError('invalid_url', 'Generated image URL is invalid');
	}

	const user = await db
		.prepare('SELECT id FROM users WHERE id = ?')
		.bind(parsedUserId.data)
		.first<{ id: string }>();
	if (!user) {
		throw new GeneratedImageRecordError('unknown_user_id', 'Generated image user was not found');
	}

	const row = await db
		.prepare(
			'INSERT INTO generated_images (id, user_id, url, created_at) VALUES (?, ?, ?, ?) ' +
				'RETURNING id, user_id, url, created_at'
		)
		.bind(crypto.randomUUID(), parsedUserId.data, parsedUrl.data, Date.now())
		.first<GeneratedImageRow>();
	if (!row) throw new Error('generated image insert failed');
	return toGeneratedImage(row);
}

export async function getGeneratedImage(
	db: D1Database,
	id: string
): Promise<GeneratedImage | null> {
	const row = await db
		.prepare('SELECT id, user_id, url, created_at FROM generated_images WHERE id = ?')
		.bind(id)
		.first<GeneratedImageRow>();
	return row ? toGeneratedImage(row) : null;
}

export async function getGeneratedImageForUser(
	db: D1Database,
	userId: string,
	id: string
): Promise<GeneratedImage | null> {
	const row = await db
		.prepare(
			'SELECT id, user_id, url, created_at FROM generated_images WHERE id = ? AND user_id = ?'
		)
		.bind(id, userId)
		.first<GeneratedImageRow>();
	return row ? toGeneratedImage(row) : null;
}

export async function deleteGeneratedImage(
	db: D1Database,
	userId: string,
	id: string
): Promise<boolean> {
	const result = await db
		.prepare('DELETE FROM generated_images WHERE id = ? AND user_id = ?')
		.bind(id, userId)
		.run();
	return result.meta.changes === 1;
}

export async function listGeneratedImages(
	db: D1Database,
	userId: string,
	offset: number,
	size: number
): Promise<GeneratedImagesPage> {
	const result = await db
		.prepare(
			'SELECT id, user_id, url, created_at FROM generated_images ' +
				'WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?'
		)
		.bind(userId, size + 1, offset)
		.all<GeneratedImageRow>();
	const rows = result.results ?? [];
	return {
		images: rows.slice(0, size).map(toGeneratedImage),
		hasMore: rows.length > size
	};
}
