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
import { makeD1 } from '$lib/server/testing/d1-shim';

const integration = vi.hoisted(() => ({ cancel: vi.fn(), submit: vi.fn() }));
const jobs = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('$lib/server/color-replacement', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/color-replacement')>();
	return {
		...actual,
		cancelColorReplacement: integration.cancel,
		submitColorReplacement: integration.submit,
		colorReplacementCost: vi.fn(() => 2)
	};
});

vi.mock('$lib/server/color-replacement-jobs', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/color-replacement-jobs')>();
	return { ...actual, createColorReplacementJob: jobs.create };
});

const { POST } = await import('./+server');

const requestBody = {
	image: 'https://cdn.example.test/scene.jpg',
	targetObject: 'sofa upholstery',
	color: 'NCS S 3020-Y20R'
};

function seedUser(db: D1Database, balance: number | null = 12): void {
	db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind('user-1', 'pubkey-1', Date.now())
		.run();
	if (balance !== null) {
		db.prepare('INSERT INTO credits (user_id, balance, updated_at, enabled) VALUES (?, ?, ?, 1)')
			.bind('user-1', balance, Date.now())
			.run();
	}
}

function platform(db: D1Database): App.Platform {
	return { env: { DB: db } } as unknown as App.Platform;
}

type PostEvent = Parameters<typeof POST>[0];

function callPost(
	requestPlatform: App.Platform,
	body: unknown = requestBody,
	pubkey: string | null = 'pubkey-1'
): ReturnType<typeof POST> {
	return POST({
		request: new Request('https://cadbos.example/api/color-replacement', {
			method: 'POST',
			body: JSON.stringify(body)
		}),
		platform: requestPlatform,
		locals: { user: pubkey === null ? null : { pubkey } },
		url: new URL('https://cadbos.example/api/color-replacement')
	} as PostEvent);
}

beforeEach(() => {
	integration.cancel.mockReset().mockResolvedValue(undefined);
	integration.submit.mockReset().mockResolvedValue('prompt-1');
	jobs.create.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('POST /api/color-replacement', () => {
	it('requires authentication and strict valid inputs', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const unauthenticated = await callPost(platform(makeD1()), requestBody, null);
		expect(unauthenticated.status).toBe(401);
		expect(await unauthenticated.json()).toEqual({
			error: { code: 'unauthorized', message: 'Authentication required' }
		});

		const db = makeD1();
		seedUser(db);
		const invalid = await callPost(platform(db), { ...requestBody, color: '   ', extra: true });
		expect(invalid.status).toBe(400);
		expect(integration.submit).not.toHaveBeenCalled();
	});

	it('checks available credit before submitting', async () => {
		const db = makeD1();
		seedUser(db, 1);
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		const response = await callPost(platform(db));

		expect(response.status).toBe(402);
		expect(await response.json()).toEqual({
			error: { code: 'insufficient_credit', message: 'Test balance exhausted' }
		});
		expect(integration.submit).not.toHaveBeenCalled();
	});

	it('submits and persists a processing job with trimmed values', async () => {
		const db = makeD1();
		seedUser(db);

		const response = await callPost(platform(db), {
			image: requestBody.image,
			targetObject: '  sofa upholstery  ',
			color: '  #aabbcc  '
		});
		const result = await response.json();

		expect(response.status).toBe(202);
		expect(response.headers.get('location')).toMatch(/^\/api\/color-replacement\//);
		expect(result).toEqual({ id: expect.any(String), status: 'processing' });
		expect(integration.submit).toHaveBeenCalledWith(
			expect.anything(),
			{ image: requestBody.image, targetObject: 'sofa upholstery', color: '#aabbcc' },
			'https://cadbos.example',
			result.id
		);
		expect(jobs.create).toHaveBeenCalledWith(
			db,
			expect.objectContaining({
				id: result.id,
				comfyPromptId: 'prompt-1',
				targetObject: 'sofa upholstery',
				color: '#aabbcc',
				cost: 2
			})
		);
	});

	it('cancels the queued workflow when job persistence fails', async () => {
		const db = makeD1();
		seedUser(db);
		jobs.create.mockRejectedValueOnce(new Error('database unavailable'));
		vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const response = await callPost(platform(db));

		expect(response.status).toBe(500);
		expect(integration.cancel).toHaveBeenCalledWith(expect.anything(), 'prompt-1');
	});
});
