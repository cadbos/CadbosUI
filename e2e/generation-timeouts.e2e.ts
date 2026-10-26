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
	{
		route: 'repaint',
		table: 'repaint_jobs',
		code: 'repaint',
		body: { target: 'walls', color: '#a3b19b' }
	},
	{
		route: 'edit',
		table: 'flux_kontext_edit_jobs',
		code: 'edit',
		body: { prompt: 'remove chair' }
	},
	{
		route: 'light-settings',
		table: 'light_settings_jobs',
		code: 'light_settings',
		body: { instruction: 'daylight' }
	},
	{
		route: 'object-replacement',
		table: 'object_replacement_jobs',
		code: 'object_replacement',
		body: { referenceImageKey, replacementObject: 'chair' }
	},
	{
		route: 'texture-replacement',
		table: 'texture_replacement_jobs',
		code: 'texture_replacement',
		body: { referenceImageKey, replacementSurface: 'floor' }
	}
];

for (const instrument of instruments) {
	test.describe(instrument.route, () => {
		test.describe('configured deadline', () => {
			test.use({
				generationEnv: { COMFYUI_JOB_TIMEOUT_MS: '1200000' },
				comfyCompletion: 'pending'
			});

			test('uses the configured deadline including queue time and does not charge for expiration', async ({
				generationApi
			}) => {
				const { db, request } = generationApi;
				await seedCredit(createDb(db), USER_ID, 12);
				const submitted = await request.post(`/api/${instrument.route}`, {
					data: { imageKey, sessionId: SESSION_ID, ...instrument.body }
				});
				expect(submitted.status()).toBe(202);
				const { id } = (await submitted.json()) as { id: string };
				await db
					.prepare(`UPDATE ${instrument.table} SET created_at = ? WHERE id = ?`)
					.bind(Date.now() - 11 * 60_000, id)
					.run();
				const pending = await request.get(`/api/${instrument.route}/${id}`);
				expect(pending.status()).toBe(200);
				const progress = (await pending.json()) as { elapsedMs: number };
				expect(progress).toEqual({
					id,
					status: 'processing',
					elapsedMs: expect.any(Number),
					queueAhead: 1
				});
				expect(progress.elapsedMs).toBeGreaterThanOrEqual(11 * 60_000);
				const before = await db.prepare('SELECT * FROM ledger_entries ORDER BY id').all();
				await db
					.prepare(`UPDATE ${instrument.table} SET created_at = ? WHERE id = ?`)
					.bind(Date.now() - 21 * 60_000, id)
					.run();
				const expired = await request.get(`/api/${instrument.route}/${id}`);
				expect(expired.status()).toBe(200);
				expect(await expired.json()).toMatchObject({
					id,
					status: 'failed',
					error: { code: `${instrument.code}_timeout` }
				});
				expect(await db.prepare('SELECT * FROM ledger_entries ORDER BY id').all()).toEqual(before);
				expect(generationApi.submissions).toHaveLength(1);
			});

			for (const variable of ['COMFYUI_JOB_TIMEOUT_MS', 'COMFYUI_REQUEST_TIMEOUT_MS'] as const) {
				test(`invalid ${variable} leaves a processing job and its ledger intact`, async ({
					generationApi
				}) => {
					const { db, request } = generationApi;
					await seedCredit(createDb(db), USER_ID, 12);
					const submitted = await request.post(`/api/${instrument.route}`, {
						data: { imageKey, sessionId: SESSION_ID, ...instrument.body }
					});
					expect(submitted.status()).toBe(202);
					const { id } = (await submitted.json()) as { id: string };
					const before = await db.prepare('SELECT * FROM ledger_entries ORDER BY id').all();
					generationApi.env[variable] = 'private-invalid-value';
					const response = await request.get(`/api/${instrument.route}/${id}`);
					expect(response.status()).toBe(500);
					expect(await response.json()).toMatchObject({
						error: { code: `${instrument.code}_poll_failed` }
					});
					expect(
						await db
							.prepare(`SELECT status FROM ${instrument.table} WHERE id = ?`)
							.bind(id)
							.first('status')
					).toBe('processing');
					expect(await db.prepare('SELECT * FROM ledger_entries ORDER BY id').all()).toEqual(
						before
					);
				});
			}
		});

		test.describe('completed output after the deadline', () => {
			test.use({ generationEnv: { COMFYUI_JOB_TIMEOUT_MS: '1000' }, comfyCompletion: 'completed' });
			test('accepts completion before applying expiration and records one charge', async ({
				generationApi
			}) => {
				const { db, request } = generationApi;
				await seedCredit(createDb(db), USER_ID, 12);
				const submitted = await request.post(`/api/${instrument.route}`, {
					data: { imageKey, sessionId: SESSION_ID, ...instrument.body }
				});
				expect(submitted.status()).toBe(202);
				const { id } = (await submitted.json()) as { id: string };
				await db
					.prepare(`UPDATE ${instrument.table} SET created_at = ? WHERE id = ?`)
					.bind(Date.now() - 60_000, id)
					.run();
				const response = await request.get(`/api/${instrument.route}/${id}`);
				expect(response.status()).toBe(200);
				expect(await response.json()).toMatchObject({ id, status: 'completed' });
				expect(
					await db
						.prepare(
							"SELECT COUNT(*) AS count FROM ledger_entries WHERE reason = 'generation-charge'"
						)
						.first('count')
				).toBe(1);
			});
		});

		for (const variable of ['COMFYUI_JOB_TIMEOUT_MS', 'COMFYUI_REQUEST_TIMEOUT_MS'] as const) {
			test.describe(`invalid ${variable} on submission`, () => {
				test.use({ generationEnv: { [variable]: 'private-invalid-value' } });
				test('rejects the request before submitting provider work or charging', async ({
					generationApi
				}) => {
					const { db, request } = generationApi;
					await seedCredit(createDb(db), USER_ID, 12);
					const before = await db.prepare('SELECT * FROM ledger_entries ORDER BY id').all();
					const response = await request.post(`/api/${instrument.route}`, {
						data: { imageKey, sessionId: SESSION_ID, ...instrument.body }
					});
					expect(response.status()).toBe(500);
					expect(await response.json()).toMatchObject({
						error: { code: `${instrument.code}_failed` }
					});
					expect(generationApi.submissions).toEqual([]);
					expect(await db.prepare('SELECT * FROM ledger_entries ORDER BY id').all()).toEqual(
						before
					);
				});
			});
		}
	});
}

test.describe('invalid render timeout', () => {
	test.use({ generationEnv: { RENDER_TIMEOUT_MS: 'private-invalid-value' } });
	test('rejects generation without submitting provider work or charging', async ({
		generationApi
	}) => {
		const { db, request } = generationApi;
		await seedCredit(createDb(db), USER_ID, 12);
		const before = await db.prepare('SELECT * FROM ledger_entries ORDER BY id').all();
		const response = await request.post('/api/render', {
			data: { imageKey, sessionId: SESSION_ID, prompt: 'cozy', outputFormat: 'png' }
		});
		expect(response.status()).toBe(500);
		expect(await response.json()).toMatchObject({ error: { code: 'render_failed' } });
		expect(generationApi.submissions).toEqual([]);
		expect(await db.prepare('SELECT * FROM ledger_entries ORDER BY id').all()).toEqual(before);
	});
});
