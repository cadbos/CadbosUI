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

import { createDb } from '$lib/server/db';
import { mediaKey } from '$lib/server/media';
import { TEST_S3_BUCKET } from '$lib/server/testing/generation-fixtures';
import { seedCredit } from '$lib/server/testing/ledger-fixtures';
import { expect, test, SESSION_ID, USER_ID } from './helpers/generation-api';

const imageKey = mediaKey(TEST_S3_BUCKET.name, 'scene.png');
const referenceImageKey = mediaKey(TEST_S3_BUCKET.name, 'reference.png');
const instruments = [
	{ route: 'repaint', body: { target: 'walls', color: '#a3b19b' } },
	{ route: 'edit', body: { prompt: 'remove chair' } },
	{ route: 'light-settings', body: { instruction: 'daylight' } },
	{ route: 'object-replacement', body: { referenceImageKey, replacementObject: 'chair' } },
	{ route: 'texture-replacement', body: { referenceImageKey, replacementSurface: 'floor' } }
];

for (const instrument of instruments) {
	test.describe(instrument.route, () => {
		test.describe('processing intervals', () => {
			test.use({ comfyCompletion: 'pending' });
			test('uses the default and applies configuration changes to an existing job', async ({
				generationApi
			}) => {
				const { db, request, env } = generationApi;
				await seedCredit(createDb(db), USER_ID, 12);
				const submitted = await request.post(`/api/${instrument.route}`, {
					data: { imageKey, sessionId: SESSION_ID, ...instrument.body }
				});
				expect(submitted.status()).toBe(202);
				const { id } = (await submitted.json()) as { id: string };
				const before = await db.prepare('SELECT * FROM ledger_entries ORDER BY id').all();
				for (const [value, expected] of [
					[undefined, '2'],
					['60', '60'],
					['private-invalid-value', '2'],
					['0', '2'],
					['2147484', '2']
				] as const) {
					env.COMFYUI_POLL_INTERVAL_SECONDS = value;
					const pending = await request.get(`/api/${instrument.route}/${id}`);
					expect(pending.status()).toBe(200);
					expect(pending.headers()['retry-after']).toBe(expected);
					expect(await pending.json()).toEqual({
						id,
						status: 'processing',
						elapsedMs: expect.any(Number),
						queueAhead: 1
					});
				}
				expect(generationApi.submissions).toHaveLength(1);
				expect(await db.prepare('SELECT * FROM ledger_entries ORDER BY id').all()).toEqual(before);
			});
		});

		test.describe('invalid interval', () => {
			test.use({ generationEnv: { COMFYUI_POLL_INTERVAL_SECONDS: 'private-invalid-value' } });
			test('submits, polls, and completes using the fallback interval', async ({
				generationApi
			}) => {
				const { db, request } = generationApi;
				await seedCredit(createDb(db), USER_ID, 12);
				const submitted = await request.post(`/api/${instrument.route}`, {
					data: { imageKey, sessionId: SESSION_ID, ...instrument.body }
				});
				expect(submitted.status()).toBe(202);
				const { id } = (await submitted.json()) as { id: string };
				const pending = await request.get(`/api/${instrument.route}/${id}`);
				expect(pending.headers()['retry-after']).toBe('2');
				expect(await pending.json()).toEqual({
					id,
					status: 'processing',
					elapsedMs: expect.any(Number),
					queueAhead: 1
				});
				const completed = await request.get(`/api/${instrument.route}/${id}`);
				expect(completed.status()).toBe(200);
				expect(completed.headers()['retry-after']).toBeUndefined();
				expect(await completed.json()).toMatchObject({ id, status: 'completed' });
				const stored = await request.get(`/api/${instrument.route}/${id}`);
				expect(stored.status()).toBe(200);
				expect(await stored.json()).toMatchObject({ id, status: 'completed' });
				expect(generationApi.submissions).toHaveLength(1);
				expect(
					await db
						.prepare(
							"SELECT COUNT(*) AS count FROM ledger_entries WHERE reason = 'generation-charge'"
						)
						.first('count')
				).toBe(1);
			});
		});
	});
}
