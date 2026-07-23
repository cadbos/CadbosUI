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
import { ComfyUiError } from '$lib/server/comfyui';
import { makeD1 } from '$lib/server/testing/d1-shim';

const integration = vi.hoisted(() => ({
	cancel: vi.fn(),
	submit: vi.fn()
}));
const jobs = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('$lib/server/texture-replacement', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/texture-replacement')>();
	return {
		...actual,
		cancelTextureReplacement: integration.cancel,
		submitTextureReplacement: integration.submit,
		textureReplacementCost: vi.fn(() => 2)
	};
});

vi.mock('$lib/server/texture-replacement-jobs', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/texture-replacement-jobs')>();
	return { ...actual, createTextureReplacementJob: jobs.create };
});

const { POST } = await import('./+server');

const requestBody = {
	image: 'https://cdn.example.test/scene.jpg',
	referenceImage: 'https://cdn.example.test/reference.jpg',
	replacementSurface: 'floor'
};

function rejectionLog(status: number, reason: string): Record<string, unknown> {
	return {
		level: 'warn',
		area: 'texture-replacement',
		event: 'request_rejected',
		status,
		reason
	};
}

function expectSingleLog(messages: unknown[], expected: Record<string, unknown>): void {
	expect(messages).toEqual([JSON.stringify(expected)]);
}

function seedUser(
	db: D1Database,
	id = 'user-1',
	pubkey = 'pubkey-1',
	balance: number | null = 12
): void {
	db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind(id, pubkey, Date.now())
		.run();
	if (balance !== null) {
		db.prepare('INSERT INTO credits (user_id, balance, updated_at, enabled) VALUES (?, ?, ?, 1)')
			.bind(id, balance, Date.now())
			.run();
	}
}

function platform(db: D1Database): App.Platform {
	return { env: { DB: db } } as unknown as App.Platform;
}

type PostEvent = Parameters<typeof POST>[0];

function callPost(
	requestPlatform: App.Platform,
	pubkey: string | null = 'pubkey-1'
): ReturnType<typeof POST> {
	return POST({
		request: new Request('https://cadbos.example/api/texture-replacement', {
			method: 'POST',
			body: JSON.stringify(requestBody)
		}),
		platform: requestPlatform,
		locals: { user: pubkey === null ? null : { pubkey } },
		url: new URL('https://cadbos.example/api/texture-replacement')
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

describe('POST /api/texture-replacement', () => {
	it('logs authentication rejection without changing the API error', async () => {
		const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		const response = await callPost(platform(makeD1()), null);

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({
			error: { code: 'unauthorized', message: 'Authentication required' }
		});
		expectSingleLog(consoleWarn.mock.calls.flat(), rejectionLog(401, 'unauthorized'));
	});

	it('logs quota rejections without changing their API errors', async () => {
		const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const unapprovedDb = makeD1();
		seedUser(unapprovedDb, 'user-1', 'pubkey-1', null);

		const unapproved = await callPost(platform(unapprovedDb));
		expect(unapproved.status).toBe(403);
		expect(await unapproved.json()).toEqual({
			error: {
				code: 'generation_restricted',
				message: 'Generation is limited to approved accounts'
			}
		});
		expectSingleLog(consoleWarn.mock.calls.flat(), rejectionLog(403, 'generation_restricted'));
		consoleWarn.mockClear();

		const exhaustedDb = makeD1();
		seedUser(exhaustedDb, 'user-1', 'pubkey-1', 0);
		const exhausted = await callPost(platform(exhaustedDb));
		expect(exhausted.status).toBe(402);
		expect(await exhausted.json()).toEqual({
			error: { code: 'insufficient_credit', message: 'Test balance exhausted' }
		});
		expectSingleLog(consoleWarn.mock.calls.flat(), rejectionLog(402, 'insufficient_credit'));
		consoleWarn.mockClear();

		const underfundedDb = makeD1();
		seedUser(underfundedDb, 'user-1', 'pubkey-1', 1);
		const underfunded = await callPost(platform(underfundedDb));
		expect(underfunded.status).toBe(402);
		expect(await underfunded.json()).toEqual({
			error: { code: 'insufficient_credit', message: 'Test balance exhausted' }
		});
		expectSingleLog(consoleWarn.mock.calls.flat(), rejectionLog(402, 'insufficient_credit'));
		expect(integration.submit).not.toHaveBeenCalled();
	});

	it('logs rate-limit rejection without changing the API error', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1', 100);
		const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		for (let attempt = 0; attempt < 10; attempt += 1) {
			expect((await callPost(platform(db))).status).toBe(202);
		}
		const limited = await callPost(platform(db));

		expect(limited.status).toBe(429);
		expect(await limited.json()).toEqual({
			error: { code: 'rate_limited', message: 'Too many requests' }
		});
		expectSingleLog(consoleWarn.mock.calls.flat(), rejectionLog(429, 'rate_limited'));
		expect(integration.submit).toHaveBeenCalledTimes(10);
	});

	it('rejects a concurrent submission for the same account and isolates the guard by pubkey', async () => {
		const db = makeD1();
		seedUser(db);
		seedUser(db, 'user-2', 'pubkey-2');
		let resolveSubmission!: (promptId: string) => void;
		integration.submit.mockImplementationOnce(
			() =>
				new Promise<string>((resolve) => {
					resolveSubmission = resolve;
				})
		);
		const requestPlatform = platform(db);

		const first = callPost(requestPlatform);
		await vi.waitFor(() => expect(integration.submit).toHaveBeenCalledTimes(1));

		const duplicate = await callPost(requestPlatform);
		expect(duplicate.status).toBe(409);
		expect(await duplicate.json()).toEqual({
			error: {
				code: 'request_in_progress',
				message: 'Texture replacement request already in progress'
			}
		});
		expect(integration.submit).toHaveBeenCalledTimes(1);
		const rateLimit = await db
			.prepare('SELECT count FROM rate_limits WHERE bucket = ?')
			.bind('texture-replacement:pubkey-1')
			.first<{ count: number }>();
		expect(rateLimit?.count).toBe(1);

		const otherAccount = await callPost(requestPlatform, 'pubkey-2');
		expect(otherAccount.status).toBe(202);

		resolveSubmission('prompt-1');
		expect((await first).status).toBe(202);
		expect((await callPost(requestPlatform)).status).toBe(202);
	});

	it('releases the in-flight guard when submission fails', async () => {
		const db = makeD1();
		seedUser(db);
		let rejectSubmission!: (error: Error) => void;
		integration.submit.mockImplementationOnce(
			() =>
				new Promise<string>((_resolve, reject) => {
					rejectSubmission = reject;
				})
		);
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const requestPlatform = platform(db);

		const first = callPost(requestPlatform);
		await vi.waitFor(() => expect(integration.submit).toHaveBeenCalledTimes(1));
		expect((await callPost(requestPlatform)).status).toBe(409);

		rejectSubmission(new Error('private submission detail'));
		expect((await first).status).toBe(502);
		expect((await callPost(requestPlatform)).status).toBe(202);
	});

	it('preserves the accepted response without cancelling a persisted prompt', async () => {
		const db = makeD1();
		seedUser(db);

		const response = await callPost(platform(db));

		expect(response.status).toBe(202);
		expect(integration.cancel).not.toHaveBeenCalled();
	});

	it('preserves submission errors without attempting cleanup', async () => {
		const db = makeD1();
		seedUser(db);
		integration.submit.mockRejectedValue(
			new ComfyUiError('network_error', 'queue_workflow', 'private provider detail')
		);
		vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const response = await callPost(platform(db));

		expect(response.status).toBe(502);
		expect(jobs.create).not.toHaveBeenCalled();
		expect(integration.cancel).not.toHaveBeenCalled();
	});

	it('cancels an accepted prompt when job persistence fails', async () => {
		const db = makeD1();
		seedUser(db);
		jobs.create.mockRejectedValue(new Error('private persistence detail'));
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const requestPlatform = platform(db);

		const response = await callPost(requestPlatform);

		expect(response.status).toBe(500);
		expect(integration.cancel).toHaveBeenCalledWith(requestPlatform, 'prompt-1');
		expect(console.error).toHaveBeenCalledWith('Texture replacement job persistence failed');
	});

	it('surfaces a sanitized log when persistence cleanup also fails', async () => {
		const db = makeD1();
		seedUser(db);
		jobs.create.mockRejectedValue(new Error('private persistence detail'));
		integration.cancel.mockRejectedValue(
			new ComfyUiError('network_error', 'cancel_workflow', 'private cleanup detail')
		);
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const response = await callPost(platform(db));

		expect(response.status).toBe(500);
		expect(consoleError).toHaveBeenCalledWith('ComfyUI texture replacement cleanup failed:', {
			code: 'network_error',
			operation: 'cancel_workflow',
			status: undefined
		});
		expect(consoleError.mock.calls.flat().join(' ')).not.toContain('private cleanup detail');
		expect(consoleError.mock.calls.flat().join(' ')).not.toContain('private persistence detail');
	});
});
