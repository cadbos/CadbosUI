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

import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { D1Database } from '@cloudflare/workers-types';
import { test as base, expect, type APIRequestContext } from '@playwright/test';
import type { Server, SSRManifest } from '@sveltejs/kit';
import { getRequest, setResponse } from '@sveltejs/kit/node';
import { SESSION_COOKIE } from '$lib/server/auth/config';
import { createDb } from '$lib/server/db';
import { closeD1, makeD1 } from '$lib/server/testing/d1-shim';
import { seedManagedMedia, TEST_S3_ENV } from '$lib/server/testing/generation-fixtures';

export const USER_ID = 'generation-user';
export const SESSION_ID = '00000000-0000-4000-8000-000000000001';

interface GenerationApi {
	env: App.Platform['env'];
	db: D1Database;
	request: APIRequestContext;
	submissions: string[];
}

export const test = base.extend<{
	generationApi: GenerationApi;
	generationEnv: Partial<App.Platform['env']>;
	comfyCompletion: 'after-first-poll' | 'pending' | 'completed';
}>({
	generationEnv: [{}, { option: true }],
	comfyCompletion: ['after-first-poll', { option: true }],
	generationApi: async ({ playwright, generationEnv, comfyCompletion }, use) => {
		const db = makeD1();
		const originalFetch = globalThis.fetch;
		try {
			const now = Date.now();
			await db
				.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
				.bind(USER_ID, 'a'.repeat(64), now)
				.run();
			await db
				.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
				.bind('generation-auth', USER_ID, now, now + 60_000)
				.run();
			await db
				.prepare(
					'INSERT INTO projects (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
				)
				.bind('generation-project', USER_ID, 'Test project', now, now)
				.run();
			await db
				.prepare(
					'INSERT INTO project_sessions (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
				)
				.bind(SESSION_ID, 'generation-project', 'Test session', now, now)
				.run();
			await seedManagedMedia(createDb(db), 'scene.png');
			await seedManagedMedia(createDb(db), 'reference.png');

			const image = await readFile(new URL('../../static/icon-192.png', import.meta.url));
			const submissions: string[] = [];
			const unexpectedRequests: string[] = [];
			const serverErrors: unknown[] = [];
			let historyReads = 0;
			const externalFetch: typeof fetch = async (input, init) => {
				const request = new Request(input, init);
				const url = new URL(request.url);
				if (url.origin === 'http://localhost:8188') {
					if (request.method === 'POST' && url.pathname === '/upload/image') {
						const file = (await request.formData()).get('image');
						if (!(file instanceof File)) throw new Error('ComfyUI image upload is missing');
						return Response.json({ name: file.name, subfolder: '', type: 'input' });
					}
					if (request.method === 'POST' && url.pathname === '/prompt') {
						submissions.push('object-replacement');
						return Response.json({ prompt_id: 'free-job', number: 0 });
					}
					if (request.method === 'GET' && url.pathname === '/history/free-job') {
						historyReads += 1;
						return Response.json(
							comfyCompletion === 'pending' ||
								(comfyCompletion === 'after-first-poll' && historyReads === 1)
								? {}
								: {
										'free-job': {
											status: { completed: true, status_str: 'success', messages: [] },
											outputs: Object.fromEntries(
												['9', '17', '100'].map((node) => [
													node,
													{ images: [{ filename: 'result.png', subfolder: '', type: 'output' }] }
												])
											)
										}
									}
						);
					}
					if (request.method === 'GET' && url.pathname === '/queue') {
						return Response.json({
							queue_running: [[0, 'other-job', {}, {}, []]],
							queue_pending: [[1, 'free-job', {}, {}, []]]
						});
					}
					if (request.method === 'GET' && url.pathname === '/view') {
						return new Response(image, { headers: { 'content-type': 'image/png' } });
					}
				}
				if (
					request.method === 'POST' &&
					url.href === 'https://archai.example.test/render/interior'
				) {
					submissions.push('render');
					return Response.json({
						output: ['https://images.example.test/result.png'],
						cost: 0,
						balance: 48
					});
				}
				if (
					request.method === 'GET' &&
					((url.origin === 'https://uploads.cadbos.example' &&
						['/scene.png', '/reference.png'].includes(url.pathname)) ||
						url.href === 'https://images.example.test/result.png')
				) {
					return new Response(image, { headers: { 'content-type': 'image/png' } });
				}
				if (request.method === 'PUT' && url.origin === 'https://uploads.cadbos.example') {
					return new Response(null, { status: 200 });
				}
				const message = `Unexpected external request: ${request.method} ${url.origin}${url.pathname}`;
				unexpectedRequests.push(message);
				throw new Error(message);
			};
			globalThis.fetch = externalFetch;
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
					...TEST_S3_ENV,
					OBJECT_REPLACEMENT_COST: '0',
					COMFYUI_BASE_URL: { fetch: externalFetch },
					ARCHAI_API_KEY: 'test-archai-key',
					ARCHAI_API_URL: 'https://archai.example.test',
					...generationEnv
				}
			} as unknown as App.Platform;
			const http = createServer((incoming, outgoing) => {
				void (async () => {
					const request = await getRequest({
						request: incoming,
						base: `http://${incoming.headers.host}`
					});
					const response = await app.respond(request, {
						platform,
						getClientAddress: () => '127.0.0.1'
					});
					await setResponse(outgoing, response);
				})().catch((error: unknown) => {
					serverErrors.push(error);
					console.error('Generation API test server failed:', error);
					outgoing.destroy(error instanceof Error ? error : new Error(String(error)));
				});
			});
			try {
				http.listen(0, '127.0.0.1');
				await once(http, 'listening');
				const { port } = http.address() as AddressInfo;
				const request = await playwright.request.newContext({
					baseURL: `http://127.0.0.1:${port}`,
					extraHTTPHeaders: {
						cookie: `${SESSION_COOKIE}=generation-auth`,
						origin: `http://127.0.0.1:${port}`
					}
				});
				try {
					await use({ db, env: platform.env, request, submissions });
				} finally {
					await request.dispose();
				}
			} finally {
				await new Promise<void>((resolve, reject) => {
					http.close((error) => (error ? reject(error) : resolve()));
				});
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
