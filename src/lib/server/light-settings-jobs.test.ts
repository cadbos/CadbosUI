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

import { describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { completeLightSettingsJob, createLightSettingsJob } from '$lib/server/light-settings-jobs';
import { makeD1 } from '$lib/server/testing/d1-shim';

function seedAccount(db: D1Database): void {
	db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind('user-1', 'pubkey-1', 1)
		.run();
	db.prepare('INSERT INTO credits (user_id, balance, updated_at, enabled) VALUES (?, ?, ?, 1)')
		.bind('user-1', 12, 1)
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

describe('light settings jobs', () => {
	it('stores media references and atomically records a completed generation', async () => {
		const db = makeD1();
		seedAccount(db);
		const sceneUrl = 'https://uploads.cadbos.example/scene.jpg';
		const outputUrl = 'https://uploads.cadbos.example/light-settings/job-1.png';

		const created = await createLightSettingsJob(db, {
			id: 'job-1',
			userId: 'user-1',
			comfyPromptId: 'prompt-1',
			sceneUrl,
			sceneHash: 'A'.repeat(64),
			sessionId: 'session-1',
			instruction: 'warmer light',
			cost: 2,
			createdAt: 10
		});
		expect(created).toMatchObject({ sceneUrl, status: 'processing', outputUrl: null });

		const completed = await completeLightSettingsJob(
			db,
			'user-1',
			'job-1',
			outputUrl,
			'B'.repeat(64),
			20
		);
		expect(completed).toMatchObject({ outputUrl, status: 'completed', balanceAfter: 10 });

		const references = await db
			.prepare(
				'SELECT j.scene_media_id, j.output_media_id, g.source_media_id, g.result_media_id ' +
					'FROM light_settings_jobs j JOIN generations g ON g.id = j.id WHERE j.id = ?'
			)
			.bind('job-1')
			.first<{
				scene_media_id: number;
				output_media_id: number;
				source_media_id: number;
				result_media_id: number;
			}>();
		expect(references).toMatchObject({
			source_media_id: references?.scene_media_id,
			result_media_id: references?.output_media_id
		});
		const media = await db
			.prepare('SELECT filename, checksum FROM media ORDER BY filename')
			.all<{ filename: string; checksum: string }>();
		expect(media).toEqual({
			results: [
				{ filename: 'light-settings/job-1.png', checksum: 'b'.repeat(64) },
				{ filename: 'scene.jpg', checksum: 'a'.repeat(64) }
			]
		});
	});
});
