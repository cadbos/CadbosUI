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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import type { ObjectReplacementJobResponse, SessionUser } from '$lib/api/contract';
import { ComfyUiError, type ComfyDownloadedImage } from '$lib/server/comfyui';
import { DEMO_PUBKEY } from '$lib/server/demo';
import {
	createObjectReplacementJob,
	getObjectReplacementJob
} from '$lib/server/object-replacement-jobs';
import { RemoteImageImportError } from '$lib/server/remote-image';
import { makeD1 } from '$lib/server/testing/d1-shim';

const integration = vi.hoisted(() => ({
	cost: 2,
	costError: null as Error | null,
	poll: vi.fn(),
	submit: vi.fn()
}));
const jobStore = vi.hoisted(() => ({ failNextCreate: false }));

vi.mock('$lib/server/object-replacement', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/object-replacement')>();
	return {
		...actual,
		objectReplacementCost: vi.fn(() => {
			if (integration.costError) throw integration.costError;
			return integration.cost;
		}),
		pollObjectReplacement: integration.poll,
		submitObjectReplacement: integration.submit
	};
});

vi.mock('$lib/server/object-replacement-jobs', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/object-replacement-jobs')>();
	return {
		...actual,
		createObjectReplacementJob: vi.fn(
			(...args: Parameters<typeof actual.createObjectReplacementJob>) => {
				if (jobStore.failNextCreate) {
					jobStore.failNextCreate = false;
					return Promise.reject(new Error('private persistence detail'));
				}
				return actual.createObjectReplacementJob(...args);
			}
		)
	};
});

const { POST } = await import('./+server');
const { GET } = await import('./[id]/+server');

const requestBody = {
	image: 'https://cdn.example.test/scene.jpg',
	referenceImage: 'https://cdn.example.test/reference.jpg',
	replacementObject: 'sofa'
};
const completedImage: ComfyDownloadedImage = {
	filename: 'result.png',
	subfolder: 'output',
	type: 'output',
	bytes: new TextEncoder().encode('result-image').buffer,
	contentType: 'image/png'
};

function rejectionLog(status: number, reason: string): Record<string, unknown> {
	return {
		level: 'warn',
		area: 'object-replacement',
		event: 'request_rejected',
		status,
		reason
	};
}

function failureLog(
	status: number,
	reason: string,
	operation: string,
	detail: Record<string, unknown> = {}
): Record<string, unknown> {
	return {
		level: 'error',
		area: 'object-replacement',
		event: 'request_failed',
		status,
		reason,
		operation,
		...detail
	};
}

function expectSingleLog(messages: unknown[], expected: Record<string, unknown>): void {
	expect(messages).toEqual([JSON.stringify(expected)]);
}

function seedUser(db: D1Database, balance?: number): void {
	db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind('user-1', 'pubkey-1', Date.now())
		.run();
	if (balance !== undefined) {
		db.prepare('INSERT INTO credits (user_id, balance, updated_at, enabled) VALUES (?, ?, ?, 1)')
			.bind('user-1', balance, Date.now())
			.run();
	}
}

function bucket(): { put: ReturnType<typeof vi.fn> } {
	return { put: vi.fn(async () => undefined) };
}

function platform(
	db: D1Database,
	uploadsBucket: ReturnType<typeof bucket> = bucket()
): App.Platform {
	return {
		env: {
			DB: db,
			COMFYUI_BASE_URL: 'http://comfy.internal:8188',
			UPLOADS_BUCKET: uploadsBucket,
			UPLOADS_PUBLIC_URL: 'https://cdn.example.test/'
		}
	} as unknown as App.Platform;
}

type PostEvent = Parameters<typeof POST>[0];
type GetEvent = Parameters<typeof GET>[0];

function callPost(
	user: SessionUser | null,
	requestPlatform: App.Platform,
	body: unknown = requestBody
): ReturnType<typeof POST> {
	return POST({
		request: new Request('https://cadbos.example/api/object-replacement', {
			method: 'POST',
			body: JSON.stringify(body)
		}),
		platform: requestPlatform,
		locals: { user },
		url: new URL('https://cadbos.example/api/object-replacement')
	} as PostEvent);
}

function callGet(
	user: SessionUser | null,
	requestPlatform: App.Platform,
	id: string
): ReturnType<typeof GET> {
	return GET({
		params: { id },
		platform: requestPlatform,
		locals: { user }
	} as GetEvent);
}

async function seedJob(db: D1Database, createdAt = Date.now()): Promise<void> {
	await createObjectReplacementJob(db, {
		id: 'job-1',
		userId: 'user-1',
		comfyPromptId: 'prompt-1',
		sceneUrl: requestBody.image,
		referenceUrl: requestBody.referenceImage,
		replacementObject: requestBody.replacementObject,
		cost: 2,
		createdAt
	});
}

beforeEach(() => {
	integration.cost = 2;
	integration.costError = null;
	integration.poll.mockReset().mockResolvedValue(null);
	integration.submit.mockReset().mockResolvedValue('prompt-1');
	jobStore.failNextCreate = false;
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('POST /api/object-replacement', () => {
	it('requires authentication and a strict request body', async () => {
		const db = makeD1();
		const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		const unauthenticated = await callPost(null, platform(db));
		expect(unauthenticated.status).toBe(401);
		expect(await unauthenticated.json()).toEqual({
			error: { code: 'unauthorized', message: 'Authentication required' }
		});
		expectSingleLog(consoleWarn.mock.calls.flat(), rejectionLog(401, 'unauthorized'));
		consoleWarn.mockClear();

		seedUser(db, 12);
		const invalid = await callPost({ pubkey: 'pubkey-1' }, platform(db), {
			...requestBody,
			replacementObject: '',
			extra: true
		});
		expect(invalid.status).toBe(400);
		expect(integration.submit).not.toHaveBeenCalled();
		expect(consoleWarn).not.toHaveBeenCalled();
	});

	it('logs account lookup failures without user identifiers', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const expectedLog = failureLog(500, 'account_error', 'account_lookup');

		const missingAccount = await callPost({ pubkey: 'missing-pubkey' }, platform(makeD1()));
		expect(missingAccount.status).toBe(500);
		expect(await missingAccount.json()).toEqual({
			error: { code: 'account_error', message: 'Account record not found' }
		});
		expectSingleLog(consoleError.mock.calls.flat(), expectedLog);
		expect(JSON.stringify(expectedLog)).not.toContain('missing-pubkey');
		consoleError.mockClear();

		const demoAccount = await callPost({ pubkey: DEMO_PUBKEY }, platform(makeD1()));
		expect(demoAccount.status).toBe(500);
		expectSingleLog(consoleError.mock.calls.flat(), expectedLog);
		expect(JSON.stringify(expectedLog)).not.toContain(DEMO_PUBKEY);
	});

	it('requires an approved account with enough credit for the snapshotted tariff', async () => {
		const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const unapprovedDb = makeD1();
		seedUser(unapprovedDb);
		const unapproved = await callPost({ pubkey: 'pubkey-1' }, platform(unapprovedDb));
		expect(unapproved.status).toBe(403);
		expectSingleLog(consoleWarn.mock.calls.flat(), rejectionLog(403, 'generation_restricted'));
		consoleWarn.mockClear();

		const exhaustedDb = makeD1();
		seedUser(exhaustedDb, 0);
		const exhausted = await callPost({ pubkey: 'pubkey-1' }, platform(exhaustedDb));
		expect(exhausted.status).toBe(402);
		expectSingleLog(consoleWarn.mock.calls.flat(), rejectionLog(402, 'insufficient_credit'));
		consoleWarn.mockClear();

		const underfundedDb = makeD1();
		seedUser(underfundedDb, 1.5);
		const underfunded = await callPost({ pubkey: 'pubkey-1' }, platform(underfundedDb));
		expect(underfunded.status).toBe(402);
		expectSingleLog(consoleWarn.mock.calls.flat(), rejectionLog(402, 'insufficient_credit'));
		expect(integration.submit).not.toHaveBeenCalled();
	});

	it('logs billing pre-check failures without exception details', async () => {
		const db = makeD1();
		seedUser(db, 12);
		integration.costError = new Error('private billing detail');
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const response = await callPost({ pubkey: 'pubkey-1' }, platform(db));

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({
			error: { code: 'object_replacement_failed', message: 'Object replacement failed' }
		});
		expectSingleLog(
			consoleError.mock.calls.flat(),
			failureLog(500, 'object_replacement_failed', 'billing_precheck')
		);
		expect(consoleError.mock.calls.flat().join(' ')).not.toContain('private billing detail');
		expect(integration.submit).not.toHaveBeenCalled();
	});

	it('submits once and returns a persisted polling resource', async () => {
		const db = makeD1();
		seedUser(db, 12);
		integration.cost = 3.5;
		const id = '123e4567-e89b-12d3-a456-426614174000' as ReturnType<typeof crypto.randomUUID>;
		vi.spyOn(crypto, 'randomUUID').mockReturnValue(id);

		const response = await callPost({ pubkey: 'pubkey-1' }, platform(db));
		const result = (await response.json()) as ObjectReplacementJobResponse;

		expect(response.status).toBe(202);
		expect(response.headers.get('location')).toBe(`/api/object-replacement/${id}`);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(result).toEqual({ id, status: 'processing' });
		expect(integration.submit).toHaveBeenCalledWith(
			expect.anything(),
			requestBody,
			'https://cadbos.example',
			id
		);
		await expect(getObjectReplacementJob(db, 'user-1', id)).resolves.toMatchObject({
			comfyPromptId: 'prompt-1',
			cost: 3.5,
			status: 'processing'
		});
	});

	it.each([
		['network_error', 502, 503],
		['invalid_configuration', 500, undefined]
	] as const)(
		'maps %s submission failures without creating or charging a job',
		async (code, expectedStatus, providerStatus) => {
			const db = makeD1();
			seedUser(db, 12);
			integration.submit.mockRejectedValue(
				new ComfyUiError(code, 'queue_workflow', 'private provider detail', {
					status: providerStatus
				})
			);
			const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

			const response = await callPost({ pubkey: 'pubkey-1' }, platform(db));

			expect(response.status).toBe(expectedStatus);
			expect(await response.json()).toEqual({
				error: { code: 'object_replacement_failed', message: 'Object replacement failed' }
			});
			expectSingleLog(
				consoleError.mock.calls.flat(),
				failureLog(expectedStatus, 'object_replacement_failed', 'provider_submission', {
					providerCode: code,
					providerOperation: 'queue_workflow',
					...(providerStatus === undefined ? {} : { providerStatus })
				})
			);
			expect(consoleError.mock.calls.flat().join(' ')).not.toContain('private provider detail');
			const count = await db
				.prepare('SELECT COUNT(*) AS count FROM object_replacement_jobs')
				.first<{ count: number }>();
			const credit = await db
				.prepare('SELECT balance FROM credits WHERE user_id = ?')
				.bind('user-1')
				.first<{ balance: number }>();
			expect(count?.count).toBe(0);
			expect(credit?.balance).toBe(12);
		}
	);

	it('logs remote-image fetch failures at the route boundary', async () => {
		const db = makeD1();
		seedUser(db, 12);
		integration.submit.mockRejectedValue(new RemoteImageImportError('remote_fetch_failed'));
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const response = await callPost({ pubkey: 'pubkey-1' }, platform(db));

		expect(response.status).toBe(502);
		expect(await response.json()).toEqual({
			error: { code: 'remote_fetch_failed', message: 'Failed to fetch image' }
		});
		expectSingleLog(
			consoleError.mock.calls.flat(),
			failureLog(502, 'remote_fetch_failed', 'remote_image_import')
		);
	});

	it('logs unknown submission failures without exception details', async () => {
		const db = makeD1();
		seedUser(db, 12);
		integration.submit.mockRejectedValue(new Error('private submission detail'));
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const response = await callPost({ pubkey: 'pubkey-1' }, platform(db));

		expect(response.status).toBe(502);
		expectSingleLog(
			consoleError.mock.calls.flat(),
			failureLog(502, 'object_replacement_failed', 'provider_submission')
		);
		expect(consoleError.mock.calls.flat().join(' ')).not.toContain('private submission detail');
	});

	it('logs job persistence failures without stored request data', async () => {
		const db = makeD1();
		seedUser(db, 12);
		jobStore.failNextCreate = true;
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const response = await callPost({ pubkey: 'pubkey-1' }, platform(db));

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({
			error: { code: 'object_replacement_failed', message: 'Object replacement failed' }
		});
		expectSingleLog(
			consoleError.mock.calls.flat(),
			failureLog(500, 'object_replacement_failed', 'job_persistence')
		);
		const logged = consoleError.mock.calls.flat().join(' ');
		expect(logged).not.toContain(requestBody.image);
		expect(logged).not.toContain(requestBody.referenceImage);
		expect(logged).not.toContain(requestBody.replacementObject);
		expect(logged).not.toContain('private persistence detail');
	});

	it('rate-limits repeated paid submissions for one account', async () => {
		const db = makeD1();
		seedUser(db, 100);
		const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		integration.submit.mockImplementation(
			async () => `prompt-${integration.submit.mock.calls.length}`
		);

		for (let attempt = 0; attempt < 10; attempt += 1) {
			const response = await callPost({ pubkey: 'pubkey-1' }, platform(db));
			expect(response.status).toBe(202);
		}
		const limited = await callPost({ pubkey: 'pubkey-1' }, platform(db));
		expect(limited.status).toBe(429);
		expectSingleLog(consoleWarn.mock.calls.flat(), rejectionLog(429, 'rate_limited'));
		expect(integration.submit).toHaveBeenCalledTimes(10);
	});
});

describe('GET /api/object-replacement/[id]', () => {
	it('hides missing jobs and jobs owned by another account', async () => {
		const db = makeD1();
		seedUser(db, 12);
		db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
			.bind('user-2', 'pubkey-2', Date.now())
			.run();
		await seedJob(db);

		const missing = await callGet({ pubkey: 'pubkey-1' }, platform(db), 'missing');
		const otherUser = await callGet({ pubkey: 'pubkey-2' }, platform(db), 'job-1');

		expect(missing.status).toBe(404);
		expect(otherUser.status).toBe(404);
	});

	it('returns a retryable processing response without charging', async () => {
		const db = makeD1();
		seedUser(db, 12);
		await seedJob(db);

		const response = await callGet({ pubkey: 'pubkey-1' }, platform(db), 'job-1');
		const result = (await response.json()) as ObjectReplacementJobResponse;

		expect(response.status).toBe(200);
		expect(response.headers.get('retry-after')).toBe('2');
		expect(result).toEqual({ id: 'job-1', status: 'processing' });
	});

	it('finalizes and charges a completed result exactly once across concurrent polls', async () => {
		const db = makeD1();
		seedUser(db, 12);
		await seedJob(db);
		integration.poll.mockResolvedValue(completedImage);
		const uploadsBucket = bucket();
		const requestPlatform = platform(db, uploadsBucket);

		const responses = await Promise.all([
			callGet({ pubkey: 'pubkey-1' }, requestPlatform, 'job-1'),
			callGet({ pubkey: 'pubkey-1' }, requestPlatform, 'job-1')
		]);
		const results = (await Promise.all(
			responses.map((response) => response.json())
		)) as ObjectReplacementJobResponse[];

		expect(results).toEqual([
			{
				id: 'job-1',
				status: 'completed',
				outputUrl: 'https://cdn.example.test/object-replacements/job-1.png',
				cost: 2,
				balance: 10
			},
			{
				id: 'job-1',
				status: 'completed',
				outputUrl: 'https://cdn.example.test/object-replacements/job-1.png',
				cost: 2,
				balance: 10
			}
		]);
		const credit = await db
			.prepare('SELECT balance FROM credits WHERE user_id = ?')
			.bind('user-1')
			.first<{ balance: number }>();
		const generations = await db
			.prepare('SELECT COUNT(*) AS count FROM generations WHERE id = ?')
			.bind('job-1')
			.first<{ count: number }>();
		expect(credit?.balance).toBe(10);
		expect(generations?.count).toBe(1);
	});

	it('returns stored terminal results without polling ComfyUI again', async () => {
		const db = makeD1();
		seedUser(db, 12);
		await seedJob(db);
		integration.poll.mockResolvedValue(completedImage);
		const requestPlatform = platform(db);
		await callGet({ pubkey: 'pubkey-1' }, requestPlatform, 'job-1');
		integration.poll.mockClear();

		const response = await callGet({ pubkey: 'pubkey-1' }, requestPlatform, 'job-1');

		expect(response.status).toBe(200);
		expect(integration.poll).not.toHaveBeenCalled();
	});

	it('marks provider execution failures terminal without charging', async () => {
		const db = makeD1();
		seedUser(db, 12);
		await seedJob(db);
		integration.poll.mockRejectedValue(
			new ComfyUiError('execution_failed', 'workflow', 'private provider detail')
		);

		const response = await callGet({ pubkey: 'pubkey-1' }, platform(db), 'job-1');
		const result = (await response.json()) as ObjectReplacementJobResponse;

		expect(result).toEqual({
			id: 'job-1',
			status: 'failed',
			error: { code: 'object_replacement_failed', message: 'Object replacement failed' }
		});
		const credit = await db
			.prepare('SELECT balance FROM credits WHERE user_id = ?')
			.bind('user-1')
			.first<{ balance: number }>();
		expect(credit?.balance).toBe(12);
	});

	it('leaves transient provider and storage failures retryable', async () => {
		const db = makeD1();
		seedUser(db, 12);
		await seedJob(db);
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		integration.poll.mockRejectedValueOnce(
			new ComfyUiError('network_error', 'get_history', 'private provider detail')
		);
		const uploadsBucket = bucket();
		vi.mocked(uploadsBucket.put)
			.mockRejectedValueOnce(new Error('simulated R2 failure'))
			.mockResolvedValue(undefined);
		const requestPlatform = platform(db, uploadsBucket);

		const pollFailure = await callGet({ pubkey: 'pubkey-1' }, requestPlatform, 'job-1');
		expect(pollFailure.status).toBe(502);
		integration.poll.mockResolvedValue(completedImage);
		const storageFailure = await callGet({ pubkey: 'pubkey-1' }, requestPlatform, 'job-1');
		expect(storageFailure.status).toBe(500);
		const completed = await callGet({ pubkey: 'pubkey-1' }, requestPlatform, 'job-1');
		expect(completed.status).toBe(200);
		expect((await completed.json()).status).toBe('completed');
	});

	it('times out only after checking ComfyUI for a completed result', async () => {
		const db = makeD1();
		seedUser(db, 12);
		await seedJob(db, Date.now() - 11 * 60_000);

		const response = await callGet({ pubkey: 'pubkey-1' }, platform(db), 'job-1');
		const result = (await response.json()) as ObjectReplacementJobResponse;

		expect(integration.poll).toHaveBeenCalledWith(expect.anything(), 'prompt-1');
		expect(result).toEqual({
			id: 'job-1',
			status: 'failed',
			error: {
				code: 'object_replacement_timeout',
				message: 'Object replacement timed out'
			}
		});
	});
});
