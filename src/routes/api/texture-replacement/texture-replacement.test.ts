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

function seedUser(db: D1Database, id = 'user-1', pubkey = 'pubkey-1'): void {
	db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind(id, pubkey, Date.now())
		.run();
	db.prepare('INSERT INTO credits (user_id, balance, updated_at, enabled) VALUES (?, ?, ?, 1)')
		.bind(id, 12, Date.now())
		.run();
}

function platform(db: D1Database): App.Platform {
	return { env: { DB: db } } as unknown as App.Platform;
}

type PostEvent = Parameters<typeof POST>[0];

function callPost(requestPlatform: App.Platform, pubkey = 'pubkey-1'): ReturnType<typeof POST> {
	return POST({
		request: new Request('https://cadbos.example/api/texture-replacement', {
			method: 'POST',
			body: JSON.stringify(requestBody)
		}),
		platform: requestPlatform,
		locals: { user: { pubkey } },
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
