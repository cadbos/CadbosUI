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

import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { D1Database } from '@cloudflare/workers-types';
import { expect, test as base, type APIRequestContext } from '@playwright/test';
import type { Server, SSRManifest } from '@sveltejs/kit';
import { getRequest, setResponse } from '@sveltejs/kit/node';

import { closeD1, makeD1 } from '$lib/server/testing/d1-shim';

const test = base.extend<{ paymentApi: { db: D1Database; request: APIRequestContext } }>({
	paymentApi: async ({ playwright }, use) => {
		const db = makeD1();
		const originalFetch = globalThis.fetch;
		const unexpectedRequests: string[] = [];
		const serverErrors: unknown[] = [];
		try {
			await db
				.prepare("INSERT INTO users (id, pubkey, created_at) VALUES ('owner', 'payment-pubkey', 1)")
				.run();
			await db.prepare("INSERT INTO credits (user_id, enabled) VALUES ('owner', 0)").run();
			await db
				.prepare(
					`INSERT INTO invoices (id, payment_processor, user_id, amount_minor, currency, created_at)
    VALUES ('42', 'robokassa', 'owner', 1, 'USD', 1)`
				)
				.run();
			await db
				.prepare(
					`INSERT INTO robokassa_invoice_details (invoice_id, payment_url, rub_amount_minor, rub_per_usd, rate_as_of, is_test, hash_algorithm)
    VALUES ('42', 'https://example.test/payment', 83, '82.5', 1, 1, 'md5')`
				)
				.run();
			globalThis.fetch = async () => {
				unexpectedRequests.push('Unexpected outbound fetch during notification');
				throw new Error('Unexpected outbound fetch during notification');
			};
			const { Server: BuiltServer } = (await import(
				new URL('../.svelte-kit/output/server/index.js', import.meta.url).href
			)) as { Server: typeof Server };
			const { manifest } = (await import(
				new URL('../.svelte-kit/output/server/manifest.js', import.meta.url).href
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
					ROBOKASSA_IS_TEST: 'false',
					ROBOKASSA_HASH_ALGORITHM: 'sha512'
				}
			} as App.Platform;
			const http = createServer((incoming, outgoing) => {
				void (async () => {
					expect(incoming.headers.cookie).toBeUndefined();
					expect(incoming.headers.origin).toBeUndefined();
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
					console.error('Payment API test server failed', {
						errorType: error instanceof Error ? error.name : typeof error
					});
					outgoing.destroy(
						error instanceof Error ? error : new Error('Payment API test server failed')
					);
				});
			});
			try {
				http.listen(0, '127.0.0.1');
				await once(http, 'listening');
				const { port } = http.address() as AddressInfo;
				const request = await playwright.request.newContext({
					baseURL: `http://127.0.0.1:${port}`
				});
				try {
					await use({ db, request });
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

function notification(signature?: string): string {
	return (
		'/api/robokassa/result?' +
		new URLSearchParams({
			InvId: '42',
			OutSum: '0.83',
			SignatureValue: signature ?? createHash('md5').update('0.83:42:test-two').digest('hex')
		})
	);
}

test('GET settles without cookies or Origin, acknowledges duplicates and leaves access unchanged', async ({
	paymentApi: { db, request }
}) => {
	const head = await request.head(notification());
	expect(head.status()).toBe(405);
	expect(head.headers()['cache-control']).toBe('no-store');
	expect(await db.prepare('SELECT * FROM ledger_entries').all()).toMatchObject({ results: [] });
	expect(await db.prepare('SELECT status FROM invoices').first('status')).toBe('open');
	let settledInvoice: Record<string, unknown> | null = null;
	for (let attempt = 0; attempt < 2; attempt++) {
		const response = await request.get(notification());
		expect(response.status()).toBe(200);
		expect(await response.text()).toBe('OK42');
		expect(response.headers()['cache-control']).toBe('no-store');
		const invoice = await db.prepare('SELECT * FROM invoices').first();
		expect(invoice).toMatchObject({ status: 'paid', created_at: 1 });
		if (settledInvoice) expect(invoice).toEqual(settledInvoice);
		else settledInvoice = invoice;
	}
	expect(
		await db
			.prepare(
				`SELECT l.amount, l.user_id, l.entry_side, l.reason, i.status, d.result_out_sum
  FROM invoices i JOIN ledger_entries l ON l.id = i.ledger_entry_id JOIN robokassa_invoice_details d ON d.invoice_id = i.id`
			)
			.all()
	).toMatchObject({
		results: [
			{
				amount: 1,
				user_id: 'owner',
				entry_side: 'credit',
				reason: 'top-up',
				status: 'paid',
				result_out_sum: '0.83'
			}
		]
	});
	expect(await db.prepare('SELECT COUNT(*) AS count FROM ledger_entries').first('count')).toBe(1);
	expect(await db.prepare('SELECT enabled FROM credits').first('enabled')).toBe(0);
	await expect(db.prepare('UPDATE invoices SET created_at = 0').run()).rejects.toThrow(
		'paid invoices are immutable'
	);
	await expect(db.prepare('UPDATE invoices SET amount_minor = 2').run()).rejects.toThrow();
	await expect(db.prepare('DELETE FROM invoices').run()).rejects.toThrow(
		'paid invoices are immutable'
	);
	expect(await db.prepare('SELECT * FROM invoices').first()).toEqual(settledInvoice);
	expect(await db.prepare('SELECT COUNT(*) AS count FROM ledger_entries').first('count')).toBe(1);
});

test('GET rejects an invalid signature without crediting and is uncached', async ({
	paymentApi: { db, request }
}) => {
	const response = await request.get(notification('0'.repeat(32)));
	expect(response.status()).toBe(400);
	expect(response.headers()['cache-control']).toBe('no-store');
	expect(await response.text()).toBe('Invalid notification');
	expect(await db.prepare('SELECT * FROM ledger_entries').all()).toMatchObject({ results: [] });
	expect(await db.prepare('SELECT status FROM invoices').first('status')).toBe('open');
});
