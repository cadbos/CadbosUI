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

import type { D1Database } from '@cloudflare/workers-types';
import type { RequestEvent, ResolveOptions } from '@sveltejs/kit';
import { afterEach, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '$lib/server/auth/config';

vi.mock('$app/environment', () => ({ dev: false }));

const { handle } = await import('./hooks.server');

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

function sessionDb(first: () => Promise<unknown>): D1Database {
	return {
		prepare: vi.fn(() => ({
			bind: vi.fn(() => ({ first }))
		}))
	} as unknown as D1Database;
}

function sessionEvent(path: string, db: D1Database, sessionId: string = 'private-session-token') {
	const url = new URL(path, 'https://cadbos.example');
	const deleteCookie = vi.fn();
	const event = {
		cookies: { get: vi.fn(() => sessionId), delete: deleteCookie },
		locals: {},
		platform: { env: { DB: db } },
		request: new Request(url),
		route: { id: path },
		url
	} as unknown as RequestEvent;
	return { deleteCookie, event };
}

function okResolve(): Parameters<typeof handle>[0]['resolve'] {
	return vi.fn(async () => new Response('ok'));
}

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

it('renders a public page anonymously and preserves the session when D1 is unavailable', async () => {
	const sessionId = 'private-session-token';
	const { deleteCookie, event } = sessionEvent(
		'/',
		sessionDb(() =>
			Promise.reject(
				new Error(`D1_ERROR: internal error; session = ${sessionId}; reference = provider-ref`)
			)
		),
		sessionId
	);
	const resolve = okResolve();
	const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

	const response = await handle({ event, resolve });

	expect(response.status).toBe(200);
	expect(await response.text()).toBe('ok');
	expect(event.locals.user).toBeNull();
	expect(resolve).toHaveBeenCalledOnce();
	expect(deleteCookie).not.toHaveBeenCalled();
	expect(response.headers.get('cache-control')).toBe('no-store');
	expect(response.headers.get('x-content-type-options')).toBe('nosniff');
	expect(consoleError).toHaveBeenCalledOnce();
	const logEntry = String(consoleError.mock.calls[0]?.[0]);
	expect(logEntry).toContain('session_lookup_error');
	expect(logEntry).toContain('provider-ref');
	expect(logEntry).toContain('[redacted]');
	expect(logEntry).not.toContain(sessionId);
});

it('lets the health endpoint report D1 availability when session lookup fails', async () => {
	const { event } = sessionEvent(
		'/healthz',
		sessionDb(() => Promise.reject(new Error('D1_ERROR: internal error')))
	);
	const resolve = okResolve();
	vi.spyOn(console, 'error').mockImplementation(() => undefined);

	const response = await handle({ event, resolve });

	expect(response.status).toBe(200);
	expect(resolve).toHaveBeenCalledOnce();
	expect(response.headers.get('cache-control')).toBe('no-store');
});

it('lets the demo auth route resolve when session lookup fails', async () => {
	const { event } = sessionEvent(
		'/auth/demo',
		sessionDb(() => Promise.reject(new Error('D1_ERROR: internal error')))
	);
	const resolve = okResolve();
	vi.spyOn(console, 'error').mockImplementation(() => undefined);

	const response = await handle({ event, resolve });

	expect(response.status).toBe(200);
	expect(resolve).toHaveBeenCalledOnce();
	expect(response.headers.get('cache-control')).toBe('no-store');
});

it.each(['/api/render', '/auth/me'])(
	'returns a non-cacheable service-unavailable response for %s when session lookup fails',
	async (path) => {
		const { deleteCookie, event } = sessionEvent(
			path,
			sessionDb(() => Promise.reject(new Error('D1_ERROR: internal error')))
		);
		const resolve = okResolve();
		vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const response = await handle({ event, resolve });

		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({
			error: {
				code: 'authentication_unavailable',
				message: 'Authentication service temporarily unavailable'
			}
		});
		expect(response.headers.get('retry-after')).toBe('5');
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
		expect(resolve).not.toHaveBeenCalled();
		expect(deleteCookie).not.toHaveBeenCalled();
	}
);

it.each([
	['/', 200],
	['/api/render', 401]
] as const)('clears an invalid session cookie for %s', async (path, status) => {
	const { deleteCookie, event } = sessionEvent(
		path,
		sessionDb(() => Promise.resolve(null))
	);
	const resolve = okResolve();

	const response = await handle({ event, resolve });

	expect(response.status).toBe(status);
	expect(event.locals.user).toBeNull();
	expect(deleteCookie).toHaveBeenCalledWith(SESSION_COOKIE, { path: '/' });
});

it('continues with the authenticated user after a successful session lookup', async () => {
	const pubkey = 'a'.repeat(64);
	const { deleteCookie, event } = sessionEvent(
		'/',
		sessionDb(() => Promise.resolve({ pubkey, first_name: 'Ada', last_name: 'Lovelace' }))
	);
	const resolve = okResolve();

	const response = await handle({ event, resolve });

	expect(response.status).toBe(200);
	expect(event.locals.user).toEqual({ pubkey, firstName: 'Ada', lastName: 'Lovelace' });
	expect(deleteCookie).not.toHaveBeenCalled();
});

it('treats a missing D1 binding as authentication service unavailability', async () => {
	const url = new URL('https://cadbos.example/auth/me');
	const deleteCookie = vi.fn();
	const event = {
		cookies: { get: vi.fn(() => 'private-session-token'), delete: deleteCookie },
		locals: {},
		platform: { env: {} },
		request: new Request(url),
		route: { id: '/auth/me' },
		url
	} as unknown as RequestEvent;
	const resolve = okResolve();
	vi.spyOn(console, 'error').mockImplementation(() => undefined);

	const response = await handle({ event, resolve });

	expect(response.status).toBe(503);
	expect(response.headers.get('retry-after')).toBe('5');
	expect(resolve).not.toHaveBeenCalled();
	expect(deleteCookie).not.toHaveBeenCalled();
});
