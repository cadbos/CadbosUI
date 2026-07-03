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

export interface GeneratedImage {
	id: string;
	userId: string;
	url: string;
	createdAt: number;
}

interface GeneratedImageRow {
	id: string;
	user_id: string;
	url: string;
	created_at: number;
}

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
	const row = await db
		.prepare(
			'INSERT INTO generated_images (id, user_id, url, created_at) VALUES (?, ?, ?, ?) ' +
				'RETURNING id, user_id, url, created_at'
		)
		.bind(crypto.randomUUID(), userId, url, Date.now())
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
