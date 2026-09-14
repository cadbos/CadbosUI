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
import type { ProModeJobResponse, SessionUser } from '$lib/api/contract';
import { ComfyUiError, type ComfyDownloadedImage } from '$lib/server/comfyui';
import { mediaKey, type Bucket } from '$lib/server/media';
import { createProModeJob, getProModeJob } from '$lib/server/pro-mode-jobs';
import { makeD1 } from '$lib/server/testing/d1-shim';
import {
	seedManagedMedia,
	setBucketUrl,
	TEST_S3_BUCKET
} from '$lib/server/testing/generation-fixtures';

const integration = vi.hoisted(() => ({
	cancel: vi.fn(),
	cost: 2,
	poll: vi.fn(),
	submit: vi.fn()
}));
const storage = vi.hoisted(() => ({
	putS3Object:
		vi.fn<
			(
				platform: App.Platform | undefined,
				bucket: Bucket,
				key: string,
				bytes: ArrayBuffer,
				mime: string
			) => Promise<void>
		>()
}));

vi.mock('$lib/server/pro-mode', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/pro-mode')>();
	return {
		...actual,
		cancelProMode: integration.cancel,
		proModeCost: vi.fn(() => integration.cost),
		pollProMode: integration.poll,
		submitProMode: integration.submit
	};
});

vi.mock('$lib/server/s3', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/s3')>()),
	putS3Object: storage.putS3Object
}));

const { POST } = await import('./+server');
const { GET } = await import('./[id]/+server');

const completedImage: ComfyDownloadedImage = {
	filename: 'result.png',
	subfolder: 'output',
	type: 'output',
	bytes: new TextEncoder().encode('result-image').buffer,
	contentType: 'image/png'
};

const SESSION_ID = '00000000-0000-4000-8000-000000000001';

function seedUser(db: D1Database, balance?: number): void {
	db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind('user-1', 'pubkey-1', Date.now())
		.run();
	if (balance !== undefined) {
		db.prepare('INSERT INTO credits (user_id, balance, updated_at, enabled) VALUES (?, ?, ?, 1)')
			.bind('user-1', balance, Date.now())
			.run();
	}
	const now = Date.now();
	db.prepare(
		'INSERT INTO projects (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
	)
		.bind('project-1', 'user-1', 'Test project', now, now)
		.run();
	db.prepare(
		'INSERT INTO project_sessions (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
	)
		.bind(SESSION_ID, 'project-1', 'Test session', now, now)
		.run();
	seedManagedMedia(db, 'scene.jpg');
	seedManagedMedia(db, 'reference.jpg');
}

function bucket(): { put: ReturnType<typeof vi.fn> } {
	return { put: vi.fn(async (_key: string, _bytes: ArrayBuffer, _metadata: unknown) => undefined) };
}

function platform(
	db: D1Database,
	uploadsBucket: ReturnType<typeof bucket> = bucket()
): App.Platform {
	storage.putS3Object.mockImplementation(async (_platform, _bucket, key, bytes, mime) => {
		const put = uploadsBucket.put as unknown as (
			key: string,
			bytes: ArrayBuffer,
			metadata: { httpMetadata: { contentType: string } }
		) => Promise<void>;
		await put(key, bytes, { httpMetadata: { contentType: mime } });
	});
	return {
		env: {
			DB: db,
			COMFYUI_BASE_URL: 'http://comfy.internal:8188',
			S3_ACCESS_KEY_ID: 'test-access-key',
			S3_SECRET_ACCESS_KEY: 'test-secret-key'
		}
	} as unknown as App.Platform;
}

type PostEvent = Parameters<typeof POST>[0];
type GetEvent = Parameters<typeof GET>[0];

function callPost(
	user: SessionUser | null,
	requestPlatform: App.Platform,
	bodyOverrides: Record<string, unknown> = {}
): ReturnType<typeof POST> {
	const body = {
		imageKey: mediaKey(TEST_S3_BUCKET.name, 'scene.jpg'),
		prompt: 'replace the pink sofa with a blue one',
		speedVsQuality: 0.5,
		sessionId: SESSION_ID,
		...bodyOverrides
	};
	return POST({
		request: new Request('https://cadbos.example/api/pro-mode', {
			method: 'POST',
			body: JSON.stringify(body)
		}),
		platform: requestPlatform,
		locals: { sessionLookupUnavailable: false, user },
		url: new URL('https://cadbos.example/api/pro-mode')
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
		locals: { sessionLookupUnavailable: false, user }
	} as GetEvent);
}

async function seedJob(db: D1Database, referenceMediaId?: number): Promise<void> {
	setBucketUrl(db, TEST_S3_BUCKET.name, 'https://cdn.example.test');
	await createProModeJob(db, {
		id: 'job-1',
		userId: 'user-1',
		comfyPromptId: 'prompt-1',
		sceneMediaId: 1,
		sessionId: SESSION_ID,
		referenceMediaId,
		prompt: 'replace the pink sofa with a blue one',
		cost: 2,
		createdAt: Date.now()
	});
}

beforeEach(() => {
	integration.cancel.mockReset().mockResolvedValue(undefined);
	integration.cost = 2;
	integration.poll.mockReset().mockResolvedValue(null);
	integration.submit.mockReset().mockResolvedValue('prompt-1');
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('POST /api/pro-mode', () => {
	it('requires authentication', async () => {
		const response = await callPost(null, platform(makeD1()));
		expect(response.status).toBe(401);
	});

	it('submits with a reference image when one is provided', async () => {
		const db = makeD1();
		seedUser(db, 12);

		const response = await callPost({ pubkey: 'pubkey-1' }, platform(db), {
			referenceImageKey: mediaKey(TEST_S3_BUCKET.name, 'reference.jpg')
		});
		const result = (await response.json()) as ProModeJobResponse;

		expect(response.status).toBe(202);
		expect(result.status).toBe('processing');
		expect(integration.submit).toHaveBeenCalledWith(
			expect.anything(),
			{
				image: expect.stringContaining('/scene.jpg?'),
				referenceImage: expect.stringContaining('/reference.jpg?'),
				prompt: 'replace the pink sofa with a blue one',
				speedVsQuality: 0.5
			},
			'https://cadbos.example',
			expect.any(String)
		);
	});

	it('submits with no reference image when none is provided', async () => {
		const db = makeD1();
		seedUser(db, 12);

		const response = await callPost({ pubkey: 'pubkey-1' }, platform(db));
		const result = (await response.json()) as ProModeJobResponse;

		expect(response.status).toBe(202);
		expect(result.status).toBe('processing');
		expect(integration.submit).toHaveBeenCalledWith(
			expect.anything(),
			{
				image: expect.stringContaining('/scene.jpg?'),
				referenceImage: undefined,
				prompt: 'replace the pink sofa with a blue one',
				speedVsQuality: 0.5
			},
			'https://cadbos.example',
			expect.any(String)
		);
	});

	it('requires an approved account with enough credit for the snapshotted tariff', async () => {
		const exhaustedDb = makeD1();
		seedUser(exhaustedDb, 0);
		const exhausted = await callPost({ pubkey: 'pubkey-1' }, platform(exhaustedDb));
		expect(exhausted.status).toBe(402);
		expect(integration.submit).not.toHaveBeenCalled();
	});

	it('maps provider submission failures without creating or charging a job', async () => {
		const db = makeD1();
		seedUser(db, 12);
		integration.submit.mockRejectedValue(
			new ComfyUiError('network_error', 'queue_workflow', 'private provider detail')
		);
		vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const response = await callPost({ pubkey: 'pubkey-1' }, platform(db));

		expect(response.status).toBe(502);
		const count = await db
			.prepare('SELECT COUNT(*) AS count FROM pro_mode_jobs')
			.first<{ count: number }>();
		expect(count?.count).toBe(0);
	});
});

describe('GET /api/pro-mode/[id]', () => {
	it('hides missing jobs and jobs owned by another account', async () => {
		const db = makeD1();
		seedUser(db, 12);
		db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
			.bind('user-2', 'pubkey-2', Date.now())
			.run();
		await seedJob(db);

		expect((await callGet({ pubkey: 'pubkey-1' }, platform(db), 'missing')).status).toBe(404);
		expect((await callGet({ pubkey: 'pubkey-2' }, platform(db), 'job-1')).status).toBe(404);
	});

	it('finalizes and charges a completed result exactly once', async () => {
		const db = makeD1();
		seedUser(db, 12);
		await seedJob(db);
		integration.poll.mockResolvedValue(completedImage);

		const response = await callGet({ pubkey: 'pubkey-1' }, platform(db), 'job-1');
		const result = (await response.json()) as ProModeJobResponse;

		expect(result).toEqual({
			id: 'job-1',
			status: 'completed',
			output: {
				key: mediaKey(TEST_S3_BUCKET.name, 'pro-mode/job-1.png'),
				url: expect.stringContaining('pro-mode/job-1.png')
			},
			cost: 2,
			balance: 10
		});
		await expect(getProModeJob(db, 'user-1', 'job-1')).resolves.toMatchObject({
			status: 'completed'
		});
	});

	it('marks provider execution failures terminal without charging', async () => {
		const db = makeD1();
		seedUser(db, 12);
		await seedJob(db);
		integration.poll.mockRejectedValue(
			new ComfyUiError('execution_failed', 'workflow', 'private provider detail')
		);

		const response = await callGet({ pubkey: 'pubkey-1' }, platform(db), 'job-1');
		const result = (await response.json()) as ProModeJobResponse;

		expect(result).toEqual({
			id: 'job-1',
			status: 'failed',
			error: { code: 'pro_mode_failed', message: 'Pro mode failed' }
		});
		const credit = await db
			.prepare('SELECT balance FROM credits WHERE user_id = ?')
			.bind('user-1')
			.first<{ balance: number }>();
		expect(credit?.balance).toBe(12);
	});
});
