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

import type { RequestEvent, ResolveOptions } from '@sveltejs/kit';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('$app/environment', () => ({ dev: false }));

const { handle } = await import('./hooks.server');

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

it('renders the failed integrity state when the asset manifest fetch stalls', async () => {
	vi.useFakeTimers();
	vi.spyOn(console, 'error').mockImplementation(() => undefined);

	let receivedSignal: AbortSignal | undefined;
	const assetFetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
		return new Promise<Response>((_resolve, reject) => {
			const signal = init?.signal;
			if (!signal) {
				reject(new Error('Expected the asset fetch to receive an abort signal'));
				return;
			}
			receivedSignal = signal;
			signal.addEventListener('abort', () => reject(signal.reason), { once: true });
		});
	});
	const event = {
		cookies: { get: vi.fn(() => undefined) },
		locals: {},
		platform: { env: { ASSETS: { fetch: assetFetch } } },
		url: new URL('https://cadbos.example/create/interior')
	} as unknown as RequestEvent;
	const resolve = vi.fn(async (_event: RequestEvent, options?: ResolveOptions) => {
		const html = await options?.transformPageChunk?.({
			html: '<html data-client-integrity="%client.integrityState%">',
			done: true
		});
		return new Response(html);
	});

	const responsePromise = handle({ event, resolve });
	await vi.runAllTimersAsync();
	const response = await responsePromise;

	expect(assetFetch).toHaveBeenCalledWith(
		'https://cadbos.example/_app/client-integrity.json',
		expect.objectContaining({ signal: expect.any(AbortSignal) })
	);
	expect(receivedSignal?.aborted).toBe(true);
	expect(await response.text()).toContain('data-client-integrity="failed"');
});
