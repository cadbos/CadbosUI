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

import { createRobokassaClient } from '$lib/server/payment-processors/robokassa/client';
import type { RobokassaSettings } from '$lib/server/payment-processors/robokassa/sdk';
import { closeD1, makeD1 } from '$lib/server/testing/d1-shim';

interface PaymentApi {
	db: D1Database;
	request: APIRequestContext;
	platform: App.Platform;
	operation: { requests: Request[]; respond?: () => Promise<Response> };
}

const test = base.extend<{ paymentApi: PaymentApi; quoteSettings: RobokassaSettings }>({
	quoteSettings: [{ is_test: 0, hash_algorithm: 'md5' }, { option: true }],
	paymentApi: async ({ playwright, quoteSettings }, use) => {
		const db = makeD1();
		const originalFetch = globalThis.fetch;
		const unexpectedRequests: string[] = [];
		const serverErrors: unknown[] = [];
		const operation: PaymentApi['operation'] = { requests: [] };
		try {
			await db
				.prepare("INSERT INTO users (id, pubkey, created_at) VALUES ('owner', 'payment-pubkey', 1)")
				.run();
			await db.prepare("INSERT INTO credits (user_id, enabled) VALUES ('owner', 0)").run();
			await db
				.prepare(
					`INSERT INTO invoices (id, payment_processor, user_id, amount_minor, currency, created_at)
    VALUES ('00000000-0000-4000-8000-000000000042', 'robokassa', 'owner', 1, 'USD', 1)`
				)
				.run();
			await db
				.prepare(
					`INSERT INTO robokassa_invoice_details (invoice_id, inv_id, payment_url, rub_amount_minor, rub_per_usd, rate_as_of, is_test, hash_algorithm)
    VALUES ('00000000-0000-4000-8000-000000000042', 42, 'https://example.test/payment', 83, '82.5', 1, ?, ?)`
				)
				.bind(quoteSettings.is_test, quoteSettings.hash_algorithm)
				.run();
			globalThis.fetch = async (input, init) => {
				const request = new Request(input, init);
				const url = new URL(request.url);
				if (
					url.origin + url.pathname ===
						'https://auth.robokassa.ru/Merchant/WebService/Service.asmx/OpStateExt' &&
					operation.respond
				) {
					operation.requests.push(request);
					return operation.respond();
				}
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
					await use({ db, request, platform, operation });
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

const invoiceId = '00000000-0000-4000-8000-000000000042';

function notification(
	fields: Record<string, string> = {},
	hash = 'md5',
	password = 'production-two'
): string {
	const values = { InvId: '42', OutSum: '0.83', ...fields };
	return (
		'/api/robokassa/result?' +
		new URLSearchParams({
			...values,
			SignatureValue:
				fields.SignatureValue ??
				createHash(hash).update(`${values.OutSum}:${values.InvId}:${password}`).digest('hex')
		})
	);
}

async function snapshot(db: D1Database): Promise<unknown[]> {
	return Promise.all([
		db.prepare('SELECT * FROM invoices ORDER BY id').all(),
		db.prepare('SELECT * FROM robokassa_invoice_details ORDER BY invoice_id').all(),
		db.prepare('SELECT * FROM ledger_entries ORDER BY id').all(),
		db.prepare('SELECT * FROM credits ORDER BY user_id').all(),
		db.prepare('SELECT * FROM balances').all()
	]);
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
	expect(
		await db
			.prepare(
				'SELECT result_fee, payer_email, payment_method, inc_curr_label FROM robokassa_invoice_details'
			)
			.first()
	).toEqual({ result_fee: null, payer_email: null, payment_method: null, inc_curr_label: null });
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

for (const method of ['HEAD', 'POST']) {
	test(`rejects ${method} without changing payment state`, async ({
		paymentApi: { db, request }
	}) => {
		const before = await snapshot(db);
		const response = await request.fetch(notification(), { method });
		expect(response.status()).toBe(405);
		if (method === 'HEAD') expect(response.headers()['cache-control']).toBe('no-store');
		expect(await snapshot(db)).toEqual(before);
	});
}

for (const [label, fields] of [
	['amount mismatch', { OutSum: '0.84' }],
	['unknown invoice', { InvId: '43' }],
	['bad signature', { SignatureValue: '0'.repeat(32) }]
] as const) {
	test(`rejects ${label} without altering invoice or account data`, async ({
		paymentApi: { db, request }
	}) => {
		const before = await snapshot(db);
		const response = await request.get(notification(fields));
		expect(response.status()).toBe(400);
		expect(response.headers()['cache-control']).toBe('no-store');
		expect(await response.text()).toBe('Invalid notification');
		expect(await snapshot(db)).toEqual(before);
	});
}

test('does not acknowledge payment without a stored quote', async ({
	paymentApi: { db, request }
}) => {
	await db.prepare('DELETE FROM robokassa_invoice_details').run();
	const before = await snapshot(db);
	expect((await request.get(notification())).status()).toBe(400);
	expect(await snapshot(db)).toEqual(before);
});

test('keeps the first notification metadata and payment timestamps on duplicates', async ({
	paymentApi: { db, request }
}) => {
	const first = await request.get(
		notification({
			OutSum: '0.830000',
			Fee: '0.30',
			EMail: 'payer@example.com',
			PaymentMethod: 'BankCard',
			IncCurrLabel: 'BankCard'
		})
	);
	expect(first.status()).toBe(200);
	expect(await first.text()).toBe('OK42');
	expect(
		await db
			.prepare(
				'SELECT result_out_sum, result_fee, payer_email, payment_method, inc_curr_label FROM robokassa_invoice_details'
			)
			.first()
	).toEqual({
		result_out_sum: '0.830000',
		result_fee: '0.30',
		payer_email: 'payer@example.com',
		payment_method: 'BankCard',
		inc_curr_label: 'BankCard'
	});
	const before = await snapshot(db);
	const second = await request.get(notification({ Fee: '0.50', EMail: 'other@example.com' }));
	expect(second.status()).toBe(200);
	expect(await second.text()).toBe('OK42');
	expect(await snapshot(db)).toEqual(before);
});

test('credits concurrent duplicate and separate invoices once in USD cents', async ({
	paymentApi: { db, request }
}) => {
	await db
		.prepare(
			`INSERT INTO invoices (id, payment_processor, user_id, amount_minor, currency, created_at)
	VALUES ('00000000-0000-4000-8000-000000000043', 'robokassa', 'owner', 1000, 'USD', 1)`
		)
		.run();
	await db
		.prepare(
			`INSERT INTO robokassa_invoice_details
	(invoice_id, inv_id, payment_url, rub_amount_minor, rub_per_usd, rate_as_of, is_test, hash_algorithm)
	VALUES ('00000000-0000-4000-8000-000000000043', 43, 'https://example.test/payment/43', 82500, '82.5', 1, 0, 'md5')`
		)
		.run();
	const paths = [
		notification(),
		notification(),
		notification({ InvId: '43', OutSum: '825.00' }),
		notification({ InvId: '43', OutSum: '825.00' })
	];
	const responses = await Promise.all(paths.map((path) => request.get(path)));
	for (const [index, response] of responses.entries()) {
		expect(response.status()).toBe(200);
		expect(await response.text()).toBe(index < 2 ? 'OK42' : 'OK43');
	}
	expect(
		(
			await db
				.prepare(
					`SELECT i.amount_minor, i.status, l.amount, l.user_id, l.entry_side, l.reason
	FROM invoices i JOIN ledger_entries l ON l.id = i.ledger_entry_id ORDER BY i.id`
				)
				.all()
		).results
	).toEqual([
		{
			amount_minor: 1,
			status: 'paid',
			amount: 1,
			user_id: 'owner',
			entry_side: 'credit',
			reason: 'top-up'
		},
		{
			amount_minor: 1000,
			status: 'paid',
			amount: 1000,
			user_id: 'owner',
			entry_side: 'credit',
			reason: 'top-up'
		}
	]);
	expect(await db.prepare('SELECT COUNT(*) AS count FROM ledger_entries').first('count')).toBe(2);
});

for (const enabled of [1, 0, null]) {
	test(`funding preserves approval ${enabled} and the provider wallet`, async ({
		paymentApi: { db, request }
	}) => {
		if (enabled === null) await db.prepare('DELETE FROM credits').run();
		else await db.prepare('UPDATE credits SET enabled = ?').bind(enabled).run();
		const credits = await db.prepare('SELECT * FROM credits').all();
		const wallet = await db.prepare('SELECT * FROM balances').all();
		expect((await request.get(notification({ Fee: '100' }))).status()).toBe(200);
		expect(await db.prepare('SELECT amount FROM ledger_entries').first('amount')).toBe(1);
		expect(await db.prepare('SELECT * FROM credits').all()).toEqual(credits);
		expect(await db.prepare('SELECT * FROM balances').all()).toEqual(wallet);
	});
}

for (const [name, trigger] of [
	['ledger', 'BEFORE INSERT ON ledger_entries'],
	['link', 'BEFORE UPDATE ON invoices'],
	['metadata', 'BEFORE UPDATE ON robokassa_invoice_details']
]) {
	test(`rolls back ${name} failure completely and settles on retry`, async ({
		paymentApi: { db, request }
	}) => {
		await db
			.prepare(
				`CREATE TRIGGER settlement_failure ${trigger} BEGIN SELECT RAISE(ABORT, 'injected failure'); END`
			)
			.run();
		const before = await snapshot(db);
		const failed = await request.get(notification());
		expect(failed.status()).toBe(500);
		expect(failed.headers()['cache-control']).toBe('no-store');
		expect(await failed.text()).toBe('Payment notification unavailable');
		expect(await snapshot(db)).toEqual(before);
		await db.prepare('DROP TRIGGER settlement_failure').run();
		const retry = await request.get(notification());
		expect(retry.status()).toBe(200);
		expect(await retry.text()).toBe('OK42');
		expect(await db.prepare('SELECT COUNT(*) AS count FROM ledger_entries').first('count')).toBe(1);
		expect(
			await db.prepare('SELECT status, paid_at, ledger_entry_id FROM invoices').first()
		).toMatchObject({
			status: 'paid',
			paid_at: expect.any(Number),
			ledger_entry_id: expect.any(Number)
		});
		expect(
			await db
				.prepare('SELECT result_out_sum FROM robokassa_invoice_details')
				.first('result_out_sum')
		).toBe('0.83');
	});
}

test('returns a retryable sanitized error when database access fails', async ({
	paymentApi: { db, request }
}) => {
	const before = await snapshot(db);
	await db.prepare('ALTER TABLE invoices RENAME TO unavailable_invoices').run();
	const response = await request.get(notification());
	expect(response.status()).toBe(500);
	expect(response.headers()['cache-control']).toBe('no-store');
	expect(await response.text()).toBe('Payment notification unavailable');
	await db.prepare('ALTER TABLE unavailable_invoices RENAME TO invoices').run();
	expect(await snapshot(db)).toEqual(before);
});

for (const name of [
	'ROBOKASSA_LOGIN',
	'ROBOKASSA_PASSWORD1',
	'ROBOKASSA_PASSWORD2',
	'ROBOKASSA_TEST_PASSWORD1',
	'ROBOKASSA_TEST_PASSWORD2'
] as const) {
	test(`returns a retryable error for missing ${name}`, async ({
		paymentApi: { db, request, platform }
	}) => {
		platform.env[name] = '';
		const before = await snapshot(db);
		const response = await request.get(notification());
		expect(response.status()).toBe(500);
		expect(response.headers()['cache-control']).toBe('no-store');
		expect(await response.text()).toBe('Payment notification unavailable');
		expect(await snapshot(db)).toEqual(before);
	});
}

test.describe('test notification verification', () => {
	test.use({ quoteSettings: { is_test: 1, hash_algorithm: 'md5' } });
	for (const isTest of ['0', '1']) {
		for (const mode of ['false', undefined, 'invalid', 'TRUE', '']) {
			test(`rejects test quote with mode ${JSON.stringify(mode)} and IsTest=${isTest}`, async ({
				paymentApi: { db, request, platform }
			}) => {
				platform.env.ROBOKASSA_IS_TEST = mode;
				const before = await snapshot(db);
				const response = await request.get(notification({ IsTest: isTest }, 'md5', 'test-two'));
				expect(response.status()).toBe(400);
				expect(response.headers()['cache-control']).toBe('no-store');
				expect(await response.text()).toBe('Invalid notification');
				expect(await snapshot(db)).toEqual(before);
				expect(
					await db.prepare('SELECT COUNT(*) AS count FROM ledger_entries').first('count')
				).toBe(0);
			});
		}
		test(`settles an explicitly enabled test quote with IsTest=${isTest}`, async ({
			paymentApi: { db, request, platform }
		}) => {
			platform.env.ROBOKASSA_IS_TEST = 'true';
			const response = await request.get(notification({ IsTest: isTest }, 'md5', 'test-two'));
			expect(response.status()).toBe(200);
			expect(await response.text()).toBe('OK42');
			expect(await db.prepare('SELECT COUNT(*) AS count FROM ledger_entries').first('count')).toBe(
				1
			);
		});
	}
	test('rejects disabled test quotes before resolving SDK credentials', async ({
		paymentApi: { db, request, platform }
	}) => {
		platform.env.ROBOKASSA_LOGIN = '';
		const before = await snapshot(db);
		const response = await request.get(notification({}, 'md5', 'test-two'));
		expect(response.status()).toBe(400);
		expect(await response.text()).toBe('Invalid notification');
		expect(await snapshot(db)).toEqual(before);
	});
});

test.describe('production notification verification', () => {
	test.use({ quoteSettings: { is_test: 0, hash_algorithm: 'sha256' } });
	test('verifies saved production credentials and sha256 despite a forged test flag', async ({
		paymentApi: { request, platform }
	}) => {
		platform.env.ROBOKASSA_IS_TEST = 'true';
		platform.env.ROBOKASSA_HASH_ALGORITHM = 'md5';
		const response = await request.get(notification({ IsTest: '1' }, 'sha256', 'production-two'));
		expect(response.status()).toBe(200);
		expect(await response.text()).toBe('OK42');
	});
});

const operationXml = `<OperationStateResponse>
	<Result><Code>0</Code></Result>
	<State><Code>100</Code><RequestDate>2026-10-19T12:00:00+03:00</RequestDate><StateDate>2026-10-19T11:00:00+03:00</StateDate></State>
	<Info><IncCurrLabel>BankCard</IncCurrLabel><IncSum>825.25</IncSum><IncAccount>account</IncAccount>
	<PaymentMethod><Code>1</Code><Description>Card</Description></PaymentMethod>
	<OutCurrLabel>RUB</OutCurrLabel><OutSum>825.00</OutSum><OpKey>operation-key</OpKey><BankCardRRN>123456789</BankCardRRN></Info>
	<UserFields><Field><Name>order</Name><Value>room</Value></Field></UserFields>
</OperationStateResponse>`;

test('maps an unquoted invoice without credentials or provider requests', async ({
	paymentApi: { db, platform, operation }
}) => {
	await db.prepare('DELETE FROM robokassa_invoice_details').run();
	const row = await db.prepare('SELECT * FROM invoices').first();
	const before = await snapshot(db);
	const client = createRobokassaClient({ env: { DB: platform.env.DB } } as App.Platform);
	expect('handleWebhook' in client).toBe(false);
	await expect(client.getInvoiceDetails(invoiceId)).resolves.toEqual({
		id: invoiceId,
		paymentProcessor: 'robokassa',
		userId: 'owner',
		ledgerEntryId: null,
		amountMinor: 1,
		currency: 'USD',
		status: 'open',
		createdAt: 1,
		updatedAt: row?.updated_at,
		paidAt: null,
		processorData: { quote: null, notification: null, operation: { status: 'not-quoted' } }
	});
	expect(operation.requests).toHaveLength(0);
	expect(await snapshot(db)).toEqual(before);
});

test.describe('test invoice diagnostics', () => {
	test.use({ quoteSettings: { is_test: 1, hash_algorithm: 'md5' } });
	for (const status of ['open', 'cancelled', 'paid'] as const) {
		test(`maps every stored field for a quoted ${status} invoice without live lookup`, async ({
			paymentApi: { db, request, platform, operation }
		}) => {
			platform.env.ROBOKASSA_IS_TEST = 'true';
			if (status === 'cancelled')
				await db.prepare("UPDATE invoices SET status = 'cancelled'").run();
			if (status === 'paid')
				expect((await request.get(notification({}, 'md5', 'test-two'))).status()).toBe(200);
			const row = await db.prepare('SELECT * FROM invoices').first();
			const before = await snapshot(db);
			const details = await createRobokassaClient({
				env: { DB: db, ROBOKASSA_IS_TEST: 'false' }
			} as App.Platform).getInvoiceDetails(invoiceId);
			expect(details).toEqual({
				id: invoiceId,
				paymentProcessor: 'robokassa',
				userId: 'owner',
				ledgerEntryId: row?.ledger_entry_id,
				amountMinor: 1,
				currency: 'USD',
				status,
				createdAt: 1,
				updatedAt: row?.updated_at,
				paidAt: row?.paid_at,
				processorData: {
					quote: {
						invId: '42',
						paymentUrl: 'https://example.test/payment',
						rubAmountMinor: 83,
						rubPerUsd: '82.5',
						rateAsOf: 1,
						isTest: true,
						hashAlgorithm: 'md5'
					},
					notification:
						status === 'paid'
							? {
									outSum: '0.83',
									fee: null,
									payerEmail: null,
									paymentMethod: null,
									incCurrLabel: null
								}
							: null,
					operation: { status: 'unavailable-for-test' }
				}
			});
			expect(operation.requests).toHaveLength(0);
			expect(await snapshot(db)).toEqual(before);
		});
	}

	test('maps optional notification metadata without live lookup', async ({
		paymentApi: { db, request, platform, operation }
	}) => {
		platform.env.ROBOKASSA_IS_TEST = 'true';
		expect(
			(
				await request.get(
					notification(
						{
							Fee: '0.30',
							EMail: 'payer@example.com',
							PaymentMethod: 'BankCard',
							IncCurrLabel: 'RUB'
						},
						'md5',
						'test-two'
					)
				)
			).status()
		).toBe(200);
		const before = await snapshot(db);
		const details = await createRobokassaClient(platform).getInvoiceDetails(invoiceId);
		expect(details.processorData.notification).toEqual({
			outSum: '0.83',
			fee: '0.30',
			payerEmail: 'payer@example.com',
			paymentMethod: 'BankCard',
			incCurrLabel: 'RUB'
		});
		expect(operation.requests).toHaveLength(0);
		expect(await snapshot(db)).toEqual(before);
	});
});

for (const hash of ['md5', 'sha256', 'sha512'] as const) {
	test.describe(`production lookup ${hash}`, () => {
		test.use({ quoteSettings: { is_test: 0, hash_algorithm: hash } });
		test(`signs production lookup using saved ${hash} and production Password 2`, async ({
			paymentApi: { db, platform, operation }
		}) => {
			platform.env.ROBOKASSA_IS_TEST = 'invalid';
			platform.env.ROBOKASSA_HASH_ALGORITHM = 'invalid';
			operation.respond = async () => new Response(operationXml);
			const before = await snapshot(db);
			const details = await createRobokassaClient(platform).getInvoiceDetails(invoiceId);
			expect(operation.requests).toHaveLength(1);
			const request = operation.requests[0];
			const url = new URL(request.url);
			expect(url.origin + url.pathname).toBe(
				'https://auth.robokassa.ru/Merchant/WebService/Service.asmx/OpStateExt'
			);
			expect(Object.fromEntries(url.searchParams)).toEqual({
				MerchantLogin: 'merchant',
				InvoiceID: '42',
				Signature: createHash(hash).update('merchant:42:production-two').digest('hex')
			});
			expect(request.method).toBe('GET');
			expect(details.status).toBe('open');
			expect(details.ledgerEntryId).toBeNull();
			expect(details.processorData.notification).toBeNull();
			expect(details.processorData.operation).toMatchObject({
				status: 'available',
				details: { State: { Code: 100 } }
			});
			expect(await snapshot(db)).toEqual(before);
		});
	});
}

test.describe('production diagnostic observations', () => {
	test.use({ quoteSettings: { is_test: 0, hash_algorithm: 'md5' } });

	for (const status of ['cancelled', 'paid'] as const) {
		test(`preserves ${status} history when live provider status disagrees`, async ({
			paymentApi: { db, request, platform, operation }
		}) => {
			if (status === 'cancelled')
				await db.prepare("UPDATE invoices SET status = 'cancelled'").run();
			else
				expect(
					(await request.get(notification({ Fee: '0.30' }, 'md5', 'production-two'))).status()
				).toBe(200);
			operation.respond = async () =>
				new Response(
					operationXml.replace('<Code>100</Code>', `<Code>${status === 'paid' ? 10 : 100}</Code>`)
				);
			const before = await snapshot(db);
			const details = await createRobokassaClient(platform).getInvoiceDetails(invoiceId);
			expect(details.status).toBe(status);
			expect(details.processorData.operation).toMatchObject({
				status: 'available',
				details: { State: { Code: status === 'paid' ? 10 : 100 } }
			});
			expect(await snapshot(db)).toEqual(before);
		});
	}

	test('keeps local history when the provider reports operation not found', async ({
		paymentApi: { db, platform, operation }
	}) => {
		operation.respond = async () =>
			new Response(
				'<OperationStateResponse><Result><Code>3</Code><Description>Operation not found</Description></Result></OperationStateResponse>'
			);
		const before = await snapshot(db);
		const details = await createRobokassaClient(platform).getInvoiceDetails(invoiceId);
		expect(details.status).toBe('open');
		expect(details.processorData.quote).not.toBeNull();
		expect(details.processorData.operation).toEqual({ status: 'not-found' });
		expect(await snapshot(db)).toEqual(before);
	});

	for (const failure of ['provider result', 'malformed XML', 'HTTP', 'network'] as const) {
		test(`preserves local history after diagnostic ${failure} failure`, async ({
			paymentApi: { db, platform, operation }
		}) => {
			operation.respond = async () => {
				if (failure === 'network') throw new Error('private URL and signature');
				if (failure === 'HTTP') return new Response('private-provider-data', { status: 401 });
				return new Response(
					failure === 'malformed XML'
						? 'not xml'
						: '<OperationStateResponse><Result><Code>1</Code><Description>private-provider-data</Description></Result></OperationStateResponse>'
				);
			};
			const before = await snapshot(db);
			await expect(
				createRobokassaClient(platform).getInvoiceDetails(invoiceId)
			).rejects.toMatchObject({
				code:
					failure === 'provider result'
						? 'API_ERROR'
						: failure === 'malformed XML'
							? 'PARSE_ERROR'
							: failure === 'HTTP'
								? 'HTTP_ERROR'
								: 'NETWORK_ERROR',
				responseBody: undefined,
				cause: undefined
			});
			expect(await snapshot(db)).toEqual(before);
		});
	}
});

for (const id of ['', '0', '01', '-1', '1.5', '9007199254740992', 'abc', '42\n', ' 42', '4.2e1']) {
	test(`rejects diagnostic invoice ID ${JSON.stringify(id)} without lookup`, async ({
		paymentApi: { platform, operation }
	}) => {
		await expect(createRobokassaClient(platform).getInvoiceDetails(id)).rejects.toThrow('UUID');
		expect(operation.requests).toHaveLength(0);
	});
}

for (const kind of ['missing', 'another processor']) {
	test(`rejects a ${kind} diagnostic invoice without lookup`, async ({
		paymentApi: { db, platform, operation }
	}) => {
		if (kind === 'another processor')
			await db
				.prepare(
					`INSERT INTO invoices (id, payment_processor, user_id, amount_minor, currency, created_at) VALUES ('00000000-0000-4000-8000-000000000043', 'other', 'owner', 1, 'USD', 1)`
				)
				.run();
		await expect(
			createRobokassaClient(platform).getInvoiceDetails('00000000-0000-4000-8000-000000000043')
		).rejects.toThrow('Robokassa invoice not found');
		expect(operation.requests).toHaveLength(0);
	});
}
