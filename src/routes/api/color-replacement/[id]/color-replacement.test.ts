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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ComfyUiError } from '$lib/server/comfyui';
import type { ColorReplacementJob } from '$lib/server/color-replacement-jobs';

const integration = vi.hoisted(() => ({ poll: vi.fn() }));
const jobs = vi.hoisted(() => ({ complete: vi.fn(), fail: vi.fn(), get: vi.fn() }));
const uploads = vi.hoisted(() => ({ upload: vi.fn() }));

vi.mock('$lib/server/billing', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/billing')>();
	return { ...actual, getUserIdByPubkey: vi.fn(() => Promise.resolve('user-1')) };
});

vi.mock('$lib/server/color-replacement', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/color-replacement')>();
	return { ...actual, pollColorReplacement: integration.poll };
});

vi.mock('$lib/server/color-replacement-jobs', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/color-replacement-jobs')>();
	return {
		...actual,
		completeColorReplacementJob: jobs.complete,
		failColorReplacementJob: jobs.fail,
		getColorReplacementJob: jobs.get
	};
});

vi.mock('$lib/server/uploads', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/uploads')>();
	return { ...actual, uploadImageBytes: uploads.upload };
});

const { GET } = await import('./+server');
const JOB_ID = '123e4567-e89b-42d3-a456-426614174000';

function processingJob(createdAt = Date.now()): ColorReplacementJob {
	return {
		id: JOB_ID,
		userId: 'user-1',
		comfyPromptId: 'prompt-1',
		sceneUrl: 'https://cdn.example.test/scene.webp',
		targetObject: 'sofa',
		color: '#aabbcc',
		cost: 2,
		status: 'processing',
		outputUrl: null,
		errorCode: null,
		balanceAfter: null,
		createdAt,
		updatedAt: createdAt,
		completedAt: null
	};
}

type GetEvent = Parameters<typeof GET>[0];

function callGet(authenticated = true): ReturnType<typeof GET> {
	return GET({
		params: { id: JOB_ID },
		platform: { env: { DB: {} } } as unknown as App.Platform,
		locals: { user: authenticated ? { pubkey: 'pubkey-1' } : null }
	} as GetEvent);
}

beforeEach(() => {
	integration.poll.mockReset().mockResolvedValue(null);
	jobs.get.mockReset().mockResolvedValue(processingJob());
	jobs.fail.mockReset();
	jobs.complete.mockReset();
	uploads.upload.mockReset();
});

describe('GET /api/color-replacement/[id]', () => {
	it('requires authentication and owner-scoped job lookup', async () => {
		expect((await callGet(false)).status).toBe(401);
		jobs.get.mockResolvedValueOnce(null);

		const missing = await callGet();

		expect(missing.status).toBe(404);
		expect(jobs.get).toHaveBeenCalledWith(expect.anything(), 'user-1', JOB_ID);
	});

	it('returns processing with retry guidance while ComfyUI is still running', async () => {
		const response = await callGet();

		expect(response.status).toBe(200);
		expect(response.headers.get('retry-after')).toBe('2');
		expect(await response.json()).toEqual({ id: JOB_ID, status: 'processing' });
	});

	it('marks an overdue processing job as timed out', async () => {
		const failed = {
			...processingJob(0),
			status: 'failed' as const,
			errorCode: 'color_replacement_timeout',
			completedAt: Date.now()
		};
		jobs.get.mockResolvedValueOnce(processingJob(0));
		jobs.fail.mockResolvedValueOnce(failed);

		const response = await callGet();

		expect(await response.json()).toEqual({
			id: JOB_ID,
			status: 'failed',
			error: {
				code: 'color_replacement_timeout',
				message: 'Color replacement timed out'
			}
		});
	});

	it('stores and atomically completes a produced image', async () => {
		integration.poll.mockResolvedValueOnce({
			filename: 'output.png',
			subfolder: '',
			type: 'output',
			bytes: new TextEncoder().encode('image').buffer,
			contentType: 'image/png'
		});
		uploads.upload.mockResolvedValueOnce({ url: 'https://cdn.example.test/recolored.png' });
		jobs.complete.mockResolvedValueOnce({
			...processingJob(),
			status: 'completed',
			outputUrl: 'https://cdn.example.test/recolored.png',
			balanceAfter: 10,
			completedAt: Date.now()
		});

		const response = await callGet();

		expect(uploads.upload).toHaveBeenCalledWith(
			expect.anything(),
			expect.any(ArrayBuffer),
			'image/png',
			`color-replacements/${JOB_ID}.png`
		);
		expect(jobs.complete).toHaveBeenCalledWith(
			expect.anything(),
			'user-1',
			JOB_ID,
			'https://cdn.example.test/recolored.png',
			expect.any(Number)
		);
		expect(await response.json()).toEqual({
			id: JOB_ID,
			status: 'completed',
			outputUrl: 'https://cdn.example.test/recolored.png',
			cost: 2,
			balance: 10
		});
	});

	it('persists a terminal workflow failure without exposing provider details', async () => {
		integration.poll.mockRejectedValueOnce(
			new ComfyUiError('execution_failed', 'workflow', 'provider details')
		);
		jobs.fail.mockResolvedValueOnce({
			...processingJob(),
			status: 'failed',
			errorCode: 'color_replacement_failed',
			completedAt: Date.now()
		});

		const response = await callGet();

		expect(await response.json()).toEqual({
			id: JOB_ID,
			status: 'failed',
			error: {
				code: 'color_replacement_failed',
				message: 'Color replacement failed'
			}
		});
	});
});
