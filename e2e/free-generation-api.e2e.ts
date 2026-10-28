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

import { readFile } from 'node:fs/promises';
import type { D1Database } from '@cloudflare/workers-types';

import type { RequestFormSnapshot } from '$lib/api/contract';
import { defaultPhotoAdjustments } from '$lib/photo-adjustments';
import { createDb } from '$lib/server/db';
import { mediaKey } from '$lib/server/media';
import { TEST_FORM_SNAPSHOT, TEST_S3_BUCKET } from '$lib/server/testing/generation-fixtures';
import { seedCredit } from '$lib/server/testing/ledger-fixtures';
import { expect, test, SESSION_ID, USER_ID } from './helpers/generation-api';

const objectReplacementBody = {
	imageKey: mediaKey(TEST_S3_BUCKET.name, 'scene.png'),
	referenceImageKey: mediaKey(TEST_S3_BUCKET.name, 'reference.png'),
	replacementObject: 'sofa',
	sessionId: SESSION_ID
};

async function expectZeroCentDebit(db: D1Database, generationId: string): Promise<void> {
	const { results } = await db
		.prepare(
			`SELECT l.amount, l.entry_side, l.reason FROM generations g
			JOIN ledger_entries l ON l.id = g.ledger_entry_id AND l.user_id = g.user_id
			WHERE g.id = ? AND g.user_id = ?`
		)
		.bind(generationId, USER_ID)
		.all();
	expect(results).toEqual([{ amount: 0, entry_side: 'debit', reason: 'generation-charge' }]);
	expect(
		await db
			.prepare("SELECT COUNT(*) AS count FROM ledger_entries WHERE reason = 'generation-charge'")
			.first('count')
	).toBe(1);
}

test('submits and completes a free object replacement with one linked zero-cent debit', async ({
	generationApi
}) => {
	const { db: generationDb } = generationApi;
	await seedCredit(createDb(generationDb), USER_ID, 12);
	const submitted = await generationApi.request.post('/api/object-replacement', {
		data: objectReplacementBody
	});
	expect(submitted.status()).toBe(202);
	const { id } = (await submitted.json()) as { id: string };
	expect(id).toEqual(expect.any(String));
	expect(submitted.headers().location).toBe(`/api/object-replacement/${id}`);

	const processing = await generationApi.request.get(`/api/object-replacement/${id}`);
	expect(processing.status()).toBe(200);
	expect(await processing.json()).toEqual({
		id,
		status: 'processing',
		elapsedMs: expect.any(Number),
		queue: { status: 'waiting', ahead: 1 }
	});
	const completed = await generationApi.request.get(`/api/object-replacement/${id}`);
	expect(completed.status()).toBe(200);
	const result: unknown = await completed.json();
	expect(result).toMatchObject({ id, status: 'completed', cost: 0, balance: 12 });
	await expectZeroCentDebit(generationDb, id);
	expect(
		await generationDb
			.prepare(
				`SELECT j.status FROM object_replacement_jobs j
				JOIN generations g ON g.id = j.id AND g.user_id = j.user_id
				WHERE j.id = ?`
			)
			.bind(id)
			.first('status')
	).toBe('completed');

	const repeated = await generationApi.request.get(`/api/object-replacement/${id}`);
	expect(repeated.status()).toBe(200);
	expect(await repeated.json()).toEqual(result);
	await expectZeroCentDebit(generationDb, id);
	expect(generationApi.submissions).toEqual(['object-replacement']);
	const ledgerBeforeDeletion = await generationDb
		.prepare('SELECT * FROM ledger_entries ORDER BY id')
		.all();
	const jobBeforeDeletion = await generationDb
		.prepare('SELECT * FROM object_replacement_jobs WHERE id = ?')
		.bind(id)
		.first();
	expect(jobBeforeDeletion).not.toHaveProperty('ledger_entry_id');
	const deleted = await generationApi.request.delete('/api/generated-images', { data: { id } });
	expect(deleted.status()).toBe(204);
	expect(
		await generationDb.prepare('SELECT id FROM generations WHERE id = ?').bind(id).first()
	).toBeNull();
	expect(await generationDb.prepare('SELECT * FROM ledger_entries ORDER BY id').all()).toEqual(
		ledgerBeforeDeletion
	);
	expect(
		await generationDb
			.prepare('SELECT * FROM object_replacement_jobs WHERE id = ?')
			.bind(id)
			.first()
	).toEqual(jobBeforeDeletion);
	const afterDeletion = await generationApi.request.get(`/api/object-replacement/${id}`);
	expect(afterDeletion.status()).toBe(200);
	expect(await afterDeletion.json()).toEqual(result);
});

for (const { name, balance, enabled, status, code } of [
	{
		name: 'unapproved',
		balance: undefined,
		enabled: 1,
		status: 403,
		code: 'generation_restricted'
	},
	{ name: 'zero balance', balance: 0, enabled: 1, status: 402, code: 'insufficient_credit' },
	{ name: 'negative balance', balance: -1, enabled: 1, status: 402, code: 'insufficient_credit' },
	{ name: 'disabled', balance: 12, enabled: 0, status: 403, code: 'generation_restricted' }
] as const) {
	test(`rejects a free object replacement for an account with ${name} access`, async ({
		generationApi
	}) => {
		const { db: generationDb } = generationApi;
		if (balance !== undefined) {
			await seedCredit(createDb(generationDb), USER_ID, balance, enabled);
		}
		const before = await generationDb.prepare('SELECT * FROM ledger_entries ORDER BY id').all();
		const response = await generationApi.request.post('/api/object-replacement', {
			data: objectReplacementBody
		});
		expect(response.status()).toBe(status);
		expect(await response.json()).toMatchObject({ error: { code } });
		expect(generationApi.submissions).toEqual([]);
		expect(await generationDb.prepare('SELECT * FROM object_replacement_jobs').all()).toMatchObject(
			{
				results: []
			}
		);
		expect(await generationDb.prepare('SELECT * FROM generations').all()).toMatchObject({
			results: []
		});
		expect(await generationDb.prepare('SELECT * FROM ledger_entries ORDER BY id').all()).toEqual(
			before
		);
	});
}

test('completes a zero-cost render with a linked debit and the unchanged account balance', async ({
	generationApi
}) => {
	const { db: generationDb } = generationApi;
	await seedCredit(createDb(generationDb), USER_ID, 12);
	const response = await generationApi.request.post('/api/render', {
		data: {
			imageKey: objectReplacementBody.imageKey,
			prompt: 'cozy',
			outputFormat: 'png',
			sessionId: SESSION_ID
		}
	});
	expect(response.status()).toBe(200);
	const result = (await response.json()) as { id: string; cost: number; balance: number };
	expect(result).toMatchObject({ id: expect.any(String), cost: 0, balance: 12 });
	await expectZeroCentDebit(generationDb, result.id);
	expect(generationApi.submissions).toEqual(['render']);
});

for (const { name, balance, enabled } of [
	{ name: 'no credit approval', balance: undefined, enabled: 1 },
	{ name: 'positive balance', balance: 12.5, enabled: 1 },
	{ name: 'zero balance', balance: 0, enabled: 1 },
	{ name: 'negative balance', balance: -1, enabled: 1 },
	{ name: 'disabled credit access', balance: 12.5, enabled: 0 }
] as const) {
	test(`saves a processed photo with ${name} and a linked zero-cent debit`, async ({
		generationApi
	}) => {
		const { db, request } = generationApi;
		if (balance !== undefined) await seedCredit(createDb(db), USER_ID, balance, enabled);
		const ledgerBefore = await db.prepare('SELECT * FROM ledger_entries ORDER BY id').all();
		const formSnapshot: RequestFormSnapshot = {
			...TEST_FORM_SNAPSHOT,
			editOperationType: 'photo-processing',
			photoAdjustments: { ...defaultPhotoAdjustments(), exposure: 20, temperature: -8, grain: 4 }
		};
		const image = await readFile(new URL('../static/icon-192.png', import.meta.url));
		const response = await request.post('/api/photo-processing', {
			multipart: {
				file: { name: 'processed.png', mimeType: 'image/png', buffer: image },
				imageKey: objectReplacementBody.imageKey,
				sessionId: SESSION_ID,
				formSnapshot: JSON.stringify(formSnapshot)
			}
		});
		expect(response.status()).toBe(200);
		const result = (await response.json()) as { id: string; cost: number; balance: number };
		expect(result).toMatchObject({ id: expect.any(String), cost: 0, balance: balance ?? 0 });
		await expectZeroCentDebit(db, result.id);
		const { results: ledgerAfter } = await db
			.prepare('SELECT * FROM ledger_entries ORDER BY id')
			.all();
		expect(ledgerAfter).toHaveLength(ledgerBefore.results.length + 1);
		expect(ledgerAfter.slice(0, -1)).toEqual(ledgerBefore.results);
		expect(
			await db.prepare('SELECT enabled FROM credits WHERE user_id = ?').bind(USER_ID).first()
		).toEqual(balance === undefined ? null : { enabled });
		const detail = await request.get(`/api/generated-images/${result.id}`);
		expect(detail.status()).toBe(200);
		expect(await detail.json()).toMatchObject({
			id: result.id,
			kind: 'photo-processing',
			amount: 0,
			balanceAfter: balance ?? 0,
			formSnapshot,
			session: { sessionId: SESSION_ID }
		});
		expect(generationApi.submissions).toEqual([]);
	});
}
