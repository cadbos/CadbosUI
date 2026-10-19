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

import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { D1Database } from '@cloudflare/workers-types';
import { expect, test as base, type APIRequestContext } from '@playwright/test';
import type { Server, SSRManifest } from '@sveltejs/kit';
import { getRequest, setResponse } from '@sveltejs/kit/node';
import { SESSION_COOKIE } from '$lib/server/auth/config';
import { closeD1, makeD1 } from '$lib/server/testing/d1-shim';

interface InvoiceApi {
	db: D1Database;
	request: APIRequestContext;
	platform: App.Platform;
	rate: { available: boolean; value: number; requests: number };
}

export const test = base.extend<{ invoiceApi: InvoiceApi }>({
	invoiceApi: async ({ playwright }, use) => {
		const db = makeD1();
		const originalFetch = globalThis.fetch;
		const unexpectedRequests: string[] = [];
		const serverErrors: unknown[] = [];
		const rate = { available: true, value: 82.5, requests: 0 };
		try {
			const now = Date.now();
			for (const [id, pubkey] of [
				['owner', 'a'.repeat(64)],
				['foreign', 'b'.repeat(64)]
			]) {
				await db
					.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
					.bind(id, pubkey, now)
					.run();
				await db
					.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
					.bind(id + '-auth', id, now, now + 3_600_000)
					.run();
				await db.prepare('INSERT INTO credits (user_id, enabled) VALUES (?, 1)').bind(id).run();
			}
			globalThis.fetch = async (input, init) => {
				const request = new Request(input, init);
				const url = new URL(request.url);
				if (url.href === 'https://www.cbr-xml-daily.ru/daily_json.js') {
					rate.requests++;
					return rate.available
						? Response.json({
								Date: '2026-10-19T00:00:00Z',
								Valute: { USD: { Value: rate.value, Nominal: 1 } }
							})
						: new Response(null, { status: 503 });
				}
				unexpectedRequests.push(url.origin + url.pathname);
				throw new Error('Unexpected payment test provider request');
			};
			const { Server: BuiltServer } = (await import(
				new URL('../../.svelte-kit/output/server/index.js', import.meta.url).href
			)) as { Server: typeof Server };
			const { manifest } = (await import(
				new URL('../../.svelte-kit/output/server/manifest.js', import.meta.url).href
			)) as { manifest: SSRManifest };
			const app = new BuiltServer(manifest);
			await app.init({ env: {} });
			const platform = {
				env: {
					DB: db,
					ROBOKASSA_LOGIN: 'merchant',
					ROBOKASSA_PASSWORD1: 'production-one',
					ROBOKASSA_PASSWORD2: 'production-two',
					ROBOKASSA_TEST_PASSWORD1: 'test-one',
					ROBOKASSA_TEST_PASSWORD2: 'test-two',
					ROBOKASSA_IS_TEST: 'true',
					ROBOKASSA_HASH_ALGORITHM: 'md5'
				}
			} as App.Platform;
			const http = createServer((incoming, outgoing) => {
				void (async () => {
					const request = await getRequest({
						request: incoming,
						base: `http://${incoming.headers.host}`
					});
					await setResponse(
						outgoing,
						await app.respond(request, {
							platform,
							getClientAddress: () => '127.0.0.1'
						})
					);
				})().catch((error: unknown) => {
					serverErrors.push(error);
					console.error('Invoice API test server failed', {
						errorType: error instanceof Error ? error.name : typeof error
					});
					outgoing.destroy(
						error instanceof Error ? error : new Error('Invoice API test server failed')
					);
				});
			});
			try {
				http.listen(0, '127.0.0.1');
				await once(http, 'listening');
				const baseURL = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
				const request = await playwright.request.newContext({
					baseURL,
					extraHTTPHeaders: { cookie: `${SESSION_COOKIE}=owner-auth`, origin: baseURL }
				});
				try {
					await use({ db, request, platform, rate });
				} finally {
					await request.dispose();
				}
			} finally {
				await new Promise<void>((resolve, reject) =>
					http.close((error) => (error ? reject(error) : resolve()))
				);
			}
			expect(unexpectedRequests).toEqual([]);
			expect(serverErrors).toEqual([]);
		} finally {
			globalThis.fetch = originalFetch;
			closeD1(db);
		}
	}
});

export { expect };
