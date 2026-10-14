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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultPhotoAdjustments } from '$lib/photo-adjustments';
import { getCredit } from './billing';
import {
	getGenerationDetailForUser,
	listCreditHistory,
	recordGeneration,
	recordPhotoProcessing,
	type RecordGenerationInput
} from './generations';
import {
	completeObjectReplacementJob,
	createObjectReplacementJob,
	failObjectReplacementJob,
	getObjectReplacementJob
} from './object-replacement-jobs';
import {
	completeTextureReplacementJob,
	createTextureReplacementJob,
	failTextureReplacementJob,
	getTextureReplacementJob
} from './texture-replacement-jobs';
import {
	completeLightSettingsJob,
	createLightSettingsJob,
	failLightSettingsJob,
	getLightSettingsJob
} from './light-settings-jobs';
import {
	completeFluxKontextEditJob,
	createFluxKontextEditJob,
	failFluxKontextEditJob,
	getFluxKontextEditJob
} from './flux-kontext-edit-jobs';
import {
	completeRepaintJob,
	createRepaintJob,
	failRepaintJob,
	getRepaintJob
} from './repaint-jobs';
import { makeDb, type TestDatabase } from './testing/d1-shim';
import { seedManagedMedia, TEST_FORM_SNAPSHOT } from './testing/generation-fixtures';
import { seedCredit } from './testing/ledger-fixtures';

let db: TestDatabase;
let sourceMediaId: number;
let resultMediaId: number;
let referenceMediaId: number;

beforeEach(async () => {
	db = makeDb();
	await db.run(
		sql`INSERT INTO users (id, pubkey, created_at) VALUES ('user-1', 'pubkey-1', 1), ('user-2', 'pubkey-2', 1)`
	);
	await seedCredit(db, 'user-1', 12);
	await seedCredit(db, 'user-2', 5);
	await db.run(
		sql`INSERT INTO projects (id, user_id, title, created_at, updated_at) VALUES ('project-1', 'user-1', 'Test project', 1, 1)`
	);
	await db.run(
		sql`INSERT INTO project_sessions (id, project_id, title, created_at, updated_at) VALUES ('session-1', 'project-1', 'Test session', 1, 1)`
	);
	sourceMediaId = await seedManagedMedia(db, 'source.webp');
	resultMediaId = await seedManagedMedia(db, 'result.webp');
	referenceMediaId = await seedManagedMedia(db, 'reference.webp');
	vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

function generationInput(amount = 0.03): RecordGenerationInput {
	return {
		sourceMediaId,
		resultMediaId,
		sessionId: 'session-1',
		prompt: 'cozy',
		kind: 'render',
		amount,
		archaiRenderSec: 1,
		archaiDownloadSec: 2,
		archaiReuploadSec: 3
	};
}

function debits(): unknown[] {
	return db
		.prepare(
			"SELECT user_id, amount, entry_side, reason FROM ledger_entries WHERE entry_side = 'debit' AND reason = 'generation-charge' ORDER BY id"
		)
		.all().results;
}

const costs = [
	{ cost: 0, cents: 0 },
	{ cost: 0.03, cents: 3 },
	{ cost: 0.29, cents: 29 },
	{ cost: 1.005, cents: 101 },
	{ cost: 0.001, cents: 1 },
	{ cost: 12, cents: 1200 },
	{ cost: 13, cents: 1300 }
];

describe.each(['credit', 'debit'] as const)('%s ledger constraints', (side) => {
	it('accepts an immutable zero entry without a generation', async () => {
		await db.run(sql`INSERT INTO ledger_entries (user_id, amount, entry_side, reason, created_at)
			VALUES ('user-1', 0, ${side}, 'adjustment', 10)`);
		expect(
			db
				.prepare("SELECT amount, entry_side FROM ledger_entries WHERE reason = 'adjustment'")
				.first()
		).toEqual({ amount: 0, entry_side: side });
		expect(() =>
			db.prepare("UPDATE ledger_entries SET amount = 1 WHERE reason = 'adjustment'").run()
		).toThrow('immutable');
		expect(() =>
			db.prepare("DELETE FROM ledger_entries WHERE reason = 'adjustment'").run()
		).toThrow('immutable');
	});

	it.each([-1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])(
		'rejects invalid amount %s',
		async (amount) => {
			await expect(
				db.run(sql`INSERT INTO ledger_entries (user_id, amount, entry_side, created_at)
			VALUES ('user-1', ${amount}, ${side}, 10)`)
			).rejects.toThrow();
		}
	);
});

describe('generation ledger', () => {
	it.each(costs)('charges $cost as $cents cents', async ({ cost, cents }) => {
		const result = await recordGeneration(db, 'user-1', generationInput(cost));
		expect(result).toMatchObject({ balance: (1200 - cents) / 100, updatedAt: expect.any(Number) });
		expect(debits()).toEqual([
			{
				user_id: 'user-1',
				amount: cents,
				entry_side: 'debit',
				reason: 'generation-charge'
			}
		]);
		expect(
			db
				.prepare(
					'SELECT g.id FROM generations g JOIN ledger_entries l ON l.id = g.ledger_entry_id WHERE l.user_id = g.user_id'
				)
				.all().results
		).toEqual([{ id: result.id }]);
		expect(
			db.prepare("SELECT amount FROM ledger_entries WHERE user_id = 'user-2'").first()
		).toEqual({ amount: 500 });
	});

	it.each([-1, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER / 100 + 1])(
		'rejects invalid amount %s without a debit',
		async (amount) => {
			await expect(recordGeneration(db, 'user-1', generationInput(amount))).rejects.toThrow();
			expect(debits()).toEqual([]);
			expect(db.prepare('SELECT COUNT(*) AS count FROM generations').first()).toEqual({ count: 0 });
		}
	);

	it.each([0, 0.03])('rolls back the %s debit when the generation insert fails', async (cost) => {
		await expect(
			recordGeneration(db, 'user-1', { ...generationInput(cost), resultMediaId: -1 })
		).rejects.toThrow();
		expect(debits()).toEqual([]);
	});

	it('rejects missing credit access without writing', async () => {
		await db.run(sql`DELETE FROM credits WHERE user_id = 'user-1'`);
		await expect(recordGeneration(db, 'user-1', generationInput())).rejects.toThrow(
			'no credit row'
		);
		expect(debits()).toEqual([]);
	});

	it('records concurrent full charges and returns each transaction balance', async () => {
		const results = await Promise.all([
			recordGeneration(db, 'user-1', generationInput(7)),
			recordGeneration(db, 'user-1', generationInput(7))
		]);
		expect(results.map((result) => result.balance).sort((a, b) => a - b)).toEqual([-2, 5]);
		expect(debits()).toHaveLength(2);
	});
});

describe('photo processing ledger', () => {
	it('rolls back the zero-cent debit when the generation insert fails', async () => {
		await expect(
			recordPhotoProcessing(db, 'user-1', {
				sourceMediaId,
				resultMediaId: -1,
				sessionId: 'session-1',
				formSnapshot: {
					...TEST_FORM_SNAPSHOT,
					editOperationType: 'photo-processing',
					photoAdjustments: defaultPhotoAdjustments()
				}
			})
		).rejects.toThrow();
		expect(debits()).toEqual([]);
		expect(db.prepare('SELECT COUNT(*) AS count FROM generations').first()).toEqual({ count: 0 });
		expect(await getCredit(db, 'user-1')).toMatchObject({ balance: 12 });
	});

	it('preserves the completion balance after later debits and credits', async () => {
		const recorded = await recordPhotoProcessing(db, 'user-1', {
			sourceMediaId,
			resultMediaId,
			sessionId: 'session-1',
			formSnapshot: {
				...TEST_FORM_SNAPSHOT,
				editOperationType: 'photo-processing',
				photoAdjustments: defaultPhotoAdjustments()
			}
		});
		expect(recorded).toMatchObject({ balance: 12, updatedAt: expect.any(Number) });
		await db.run(sql`INSERT INTO ledger_entries (user_id, amount, entry_side, reason, created_at)
			VALUES ('user-1', 200, 'debit', 'adjustment', 1), ('user-1', 1000, 'credit', 'top-up', 1)`);
		expect(await getCredit(db, 'user-1')).toMatchObject({ balance: 20 });
		expect(await getGenerationDetailForUser(db, 'user-1', recorded.id)).toMatchObject({
			id: recorded.id,
			kind: 'photo-processing',
			amount: 0,
			balanceAfter: 12
		});
		expect(await listCreditHistory(db, 'user-1')).toEqual([
			expect.objectContaining({ generationId: recorded.id, amount: 0, balanceAfter: 12 })
		]);
	});
});

describe.each([
	[
		'object replacement',
		createObjectReplacementJob,
		completeObjectReplacementJob,
		getObjectReplacementJob,
		failObjectReplacementJob
	],
	[
		'texture replacement',
		createTextureReplacementJob,
		completeTextureReplacementJob,
		getTextureReplacementJob,
		failTextureReplacementJob
	],
	[
		'light settings',
		createLightSettingsJob,
		completeLightSettingsJob,
		getLightSettingsJob,
		failLightSettingsJob
	],
	[
		'flux kontext edit',
		createFluxKontextEditJob,
		completeFluxKontextEditJob,
		getFluxKontextEditJob,
		failFluxKontextEditJob
	],
	['repaint', createRepaintJob, completeRepaintJob, getRepaintJob, failRepaintJob]
] as const)('%s ledger', (name, create, complete, get, fail) => {
	function createJob(cost = 0.03, id = 'job-1') {
		const input = {
			id,
			userId: 'user-1',
			comfyPromptId: `prompt-${id}`,
			sceneMediaId: sourceMediaId,
			referenceMediaId,
			sessionId: 'session-1',
			replacementObject: 'sofa',
			replacementSurface: 'walls',
			instruction: name,
			target: 'walls',
			color: '#a3b19b',
			cost,
			createdAt: 10,
			uploadQueueSec: 1
		};
		return create(db, input);
	}

	function completeJob(id = 'job-1', outputMediaId = resultMediaId) {
		return complete(db, 'user-1', id, outputMediaId, 20, 2, 3, 4, 5);
	}

	it.each(costs)('charges $cost as $cents cents', async ({ cost, cents }) => {
		expect(await createJob(cost)).toMatchObject({ status: 'processing', balanceAfter: null });
		expect(await completeJob()).toMatchObject({
			status: 'completed',
			balanceAfter: (1200 - cents) / 100
		});
		expect(debits()).toEqual([
			{
				user_id: 'user-1',
				amount: cents,
				entry_side: 'debit',
				reason: 'generation-charge'
			}
		]);
		expect(
			db
				.prepare(
					"SELECT g.id FROM generations g JOIN ledger_entries l ON l.id = g.ledger_entry_id WHERE g.id = 'job-1' AND l.user_id = g.user_id"
				)
				.first()
		).toEqual({ id: 'job-1' });
		expect(console.warn).toHaveBeenCalledTimes(cost > 12 ? 1 : 0);
	});

	it.each([Infinity, Number.MAX_SAFE_INTEGER / 100 + 1])(
		'rejects an unsafe stored job cost %s',
		async (cost) => {
			await createJob(cost);
			await expect(completeJob()).rejects.toThrow();
			expect(debits()).toEqual([]);
			expect(await get(db, 'user-1', 'job-1')).toMatchObject({ status: 'processing' });
		}
	);

	it.each([0, 13])(
		'records cost %s once for concurrent duplicate completion and keeps the original result',
		async (cost) => {
			await createJob(cost);
			const [first, second] = await Promise.all([completeJob(), completeJob()]);
			expect(first).toEqual(second);
			expect(first.balanceAfter).toBe(12 - cost);
			expect(debits()).toHaveLength(1);
			expect(console.warn).toHaveBeenCalledTimes(cost > 12 ? 1 : 0);
		}
	);

	it.each([0, 0.03])(
		'rolls back every write for cost %s when the generation insert fails',
		async (cost) => {
			await createJob(cost);
			await expect(completeJob('job-1', -1)).rejects.toThrow();
			expect(debits()).toEqual([]);
			expect(db.prepare('SELECT COUNT(*) AS count FROM generations').first()).toEqual({ count: 0 });
			expect(await get(db, 'user-1', 'job-1')).toMatchObject({
				status: 'processing',
				outputMediaId: null,
				completedAt: null,
				balanceAfter: null
			});
		}
	);

	it('rejects missing credit access without completing or charging', async () => {
		await createJob();
		await db.run(sql`DELETE FROM credits WHERE user_id = 'user-1'`);
		await expect(completeJob()).rejects.toThrow('completion failed');
		expect(debits()).toEqual([]);
		expect(await get(db, 'user-1', 'job-1')).toMatchObject({ status: 'processing' });
	});

	it('rejects completion by another user without changing the job', async () => {
		await createJob();
		await expect(complete(db, 'user-2', 'job-1', resultMediaId, 20, 2, 3, 4, 5)).rejects.toThrow(
			'not found'
		);
		expect(debits()).toEqual([]);
		expect(await get(db, 'user-1', 'job-1')).toMatchObject({ status: 'processing' });
	});

	it('leaves failed jobs uncharged on subsequent completion', async () => {
		await createJob();
		await fail(db, 'user-1', 'job-1', 'provider_failed', 20, 2, 3);
		expect(await completeJob()).toMatchObject({ status: 'failed', balanceAfter: null });
		expect(debits()).toEqual([]);
	});

	it('preserves the completion balance after later charges, credits, and generation deletion', async () => {
		await createJob(2);
		await completeJob();
		await createJob(3, 'job-2');
		await completeJob('job-2');
		await db.run(
			sql`INSERT INTO ledger_entries (user_id, amount, entry_side, reason, created_at) VALUES ('user-1', 1000, 'credit', 'top-up', 1)`
		);
		await db.run(sql`DELETE FROM generations WHERE id = 'job-1'`);
		expect(await get(db, 'user-1', 'job-1')).toMatchObject({
			status: 'completed',
			balanceAfter: 10
		});
		expect(await get(db, 'user-1', 'job-2')).toMatchObject({
			status: 'completed',
			balanceAfter: 7
		});
		expect(debits()).toHaveLength(2);
	});

	it('records concurrent distinct jobs with full debits', async () => {
		await createJob(7);
		await createJob(7, 'job-2');
		const results = await Promise.all([completeJob(), completeJob('job-2')]);
		expect(results.map((job) => job.balanceAfter).sort()).toEqual([-2, 5]);
		expect(debits()).toHaveLength(2);
		expect(console.warn).toHaveBeenCalledOnce();
	});
});
