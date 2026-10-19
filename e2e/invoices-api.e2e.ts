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
import type { APIResponse } from '@playwright/test';
import type { CreateInvoiceRequest, InvoiceResponse } from '$lib/api/contract';
import { SESSION_COOKIE } from '$lib/server/auth/config';
import { createDb } from '$lib/server/db';
import { cancelInvoice, checkoutInvoice, createInvoice, getInvoice } from '$lib/server/invoices';
import type { PaymentProcessorRegistration } from '$lib/server/payment-processors/registry';
import { expect, test } from './helpers/invoice-api';

const input: CreateInvoiceRequest = {
	id: '42',
	paymentProcessor: 'robokassa',
	amountMinor: 1000,
	currency: 'USD'
};

async function invoice(response: APIResponse, status = 200): Promise<InvoiceResponse> {
	expect(response.status()).toBe(status);
	expect(response.headers()['cache-control']).toBe('no-store');
	return response.json() as Promise<InvoiceResponse>;
}

function notification(id = '42', outSum = '825.00', password = 'test-two'): string {
	return (
		'/api/robokassa/result?' +
		new URLSearchParams({
			InvId: id,
			OutSum: outSum,
			SignatureValue: createHash('md5').update(`${outSum}:${id}:${password}`).digest('hex'),
			Fee: '10.00',
			Email: 'payer@example.test'
		})
	);
}

test('discovers configured processors without external requests or secrets', async ({
	invoiceApi: api
}) => {
	const response = await api.request.get('/api/payment-processors');
	expect(response.status()).toBe(200);
	expect(response.headers()['cache-control']).toBe('no-store');
	expect(await response.json()).toEqual({
		paymentProcessors: [{ id: 'robokassa', invoiceCurrencies: ['USD'], paymentCurrencies: ['RUB'] }]
	});
	expect(api.rate.requests).toBe(0);
	for (const changes of [
		{ ROBOKASSA_LOGIN: '' },
		{ ROBOKASSA_PASSWORD1: '' },
		{ ROBOKASSA_PASSWORD2: '' },
		{ ROBOKASSA_TEST_PASSWORD1: '' },
		{ ROBOKASSA_TEST_PASSWORD2: '' },
		{ ROBOKASSA_IS_TEST: 'invalid' },
		{ ROBOKASSA_HASH_ALGORITHM: 'invalid' }
	]) {
		const original = { ...api.platform.env };
		Object.assign(api.platform.env, changes);
		const unavailable = await api.request.get('/api/payment-processors');
		expect(await unavailable.json()).toEqual({ paymentProcessors: [] });
		Object.assign(api.platform.env, original);
	}
});

test('creates once and returns the same invoice for concurrent matching retries', async ({
	invoiceApi: api
}) => {
	const responses = await Promise.all(
		Array.from({ length: 6 }, () => api.request.post('/api/invoices', { data: input }))
	);
	expect(responses.map((response) => response.status()).sort()).toEqual([
		200, 200, 200, 200, 200, 201
	]);
	const bodies = await Promise.all(
		responses.map((response) => invoice(response, response.status()))
	);
	for (const body of bodies) expect(body).toEqual(bodies[0]);
	expect(bodies[0]).toEqual({
		...input,
		status: 'open',
		createdAt: expect.any(Number),
		updatedAt: expect.any(Number),
		paidAt: null,
		checkout: null
	});
	expect(await api.db.prepare('SELECT COUNT(*) AS count FROM invoices').first('count')).toBe(1);
	expect(await api.db.prepare('SELECT COUNT(*) AS count FROM ledger_entries').first('count')).toBe(
		0
	);
	expect(api.rate.requests).toBe(0);
});

test('rejects changed terms and foreign-ID collisions without changing the invoice', async ({
	invoiceApi: api
}) => {
	await invoice(await api.request.post('/api/invoices', { data: input }), 201);
	const before = await api.db.prepare('SELECT * FROM invoices').all();
	for (const data of [
		{ ...input, amountMinor: 2000 },
		{ ...input, paymentProcessor: 'another-processor' }
	]) {
		const response = await api.request.post('/api/invoices', { data });
		expect(response.status()).toBe(409);
		expect(await response.json()).toEqual({
			error: {
				code: 'invoice_conflict',
				message: 'Invoice ID is already in use'
			}
		});
	}
	const response = await api.request.post('/api/invoices', {
		data: input,
		headers: { cookie: `${SESSION_COOKIE}=foreign-auth` }
	});
	expect(response.status()).toBe(409);
	expect(await response.json()).toEqual({
		error: {
			code: 'invoice_conflict',
			message: 'Invoice ID is already in use'
		}
	});
	expect(await api.db.prepare('SELECT * FROM invoices').all()).toEqual(before);
});

test('validates invoice IDs, amounts, currency, processor and server-owned fields', async ({
	invoiceApi: api
}) => {
	const invalid = [
		...['0', '01', '-1', '+1', '1.0', '1e3', '9007199254740992', 'abc'].map((id) => ({
			...input,
			id
		})),
		{ ...input, id: 42 },
		...[0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1].map((amountMinor) => ({ ...input, amountMinor })),
		{ ...input, currency: 'RUB' },
		{ ...input, paymentProcessor: 'unknown' },
		{ ...input, userId: 'foreign' },
		{ ...input, status: 'paid' },
		{ ...input, rubAmountMinor: 1 }
	];
	for (const data of invalid) {
		await api.db.prepare('DELETE FROM rate_limits').run();
		const response = await api.request.post('/api/invoices', { data });
		expect(response.status()).toBe(400);
		expect(response.headers()['cache-control']).toBe('no-store');
	}
	expect(await api.db.prepare('SELECT COUNT(*) AS count FROM invoices').first('count')).toBe(0);
	await invoice(
		await api.request.post('/api/invoices', {
			data: { ...input, id: String(Number.MAX_SAFE_INTEGER) }
		}),
		201
	);
});

test('authenticates all endpoints and requires same-origin JSON mutations', async ({
	invoiceApi: api
}) => {
	for (const [method, path] of [
		['GET', '/api/payment-processors'],
		['POST', '/api/invoices'],
		['GET', '/api/invoices/42'],
		['POST', '/api/invoices/42/checkout'],
		['POST', '/api/invoices/42/cancel']
	]) {
		const response = await api.request.fetch(path, {
			method,
			headers: { cookie: '' },
			...(method === 'POST' ? { data: input } : {})
		});
		expect(response.status()).toBe(401);
		expect(response.headers()['cache-control']).toBe('no-store');
	}
	for (const path of ['/api/invoices', '/api/invoices/42/checkout', '/api/invoices/42/cancel']) {
		const crossOrigin = await api.request.post(path, {
			data: input,
			headers: { origin: 'https://foreign.test' }
		});
		expect(crossOrigin.status()).toBe(403);
		expect(crossOrigin.headers()['cache-control']).toBe('no-store');
		const missingOrigin = await api.request.post(path, { data: input, headers: { origin: '' } });
		expect(missingOrigin.status()).toBe(403);
		const nonJson = await api.request.post(path, {
			data: '{}',
			headers: { 'content-type': 'application/octet-stream' }
		});
		expect(nonJson.status()).toBe(400);
	}
	const malformed = await api.request.post('/api/invoices', {
		data: '{',
		headers: { 'content-type': 'application/json' }
	});
	expect(malformed.status()).toBe(400);
});

test('hides missing and foreign invoices before any provider interaction', async ({
	invoiceApi: api
}) => {
	await invoice(await api.request.post('/api/invoices', { data: input }), 201);
	for (const id of ['42', '43']) {
		for (const suffix of ['', '/checkout', '/cancel']) {
			const response = await api.request.fetch('/api/invoices/' + id + suffix, {
				method: suffix ? 'POST' : 'GET',
				headers: { cookie: `${SESSION_COOKIE}=foreign-auth` },
				...(suffix ? { data: {} } : {})
			});
			expect(response.status()).toBe(404);
			expect(await response.json()).toEqual({
				error: { code: 'invoice_not_found', message: 'Invoice not found' }
			});
		}
	}
	expect(api.rate.requests).toBe(0);
});

test('allows zero-balance funding but preserves reads, retries and cancellation after disablement', async ({
	invoiceApi: api
}) => {
	expect(await api.db.prepare('SELECT COUNT(*) AS count FROM ledger_entries').first('count')).toBe(
		0
	);
	await invoice(await api.request.post('/api/invoices', { data: input }), 201);
	await api.db.prepare("UPDATE credits SET enabled = 0 WHERE user_id = 'owner'").run();
	expect((await api.request.post('/api/invoices', { data: { ...input, id: '43' } })).status()).toBe(
		403
	);
	expect((await api.request.post('/api/invoices/42/checkout', { data: {} })).status()).toBe(403);
	await invoice(await api.request.get('/api/invoices/42'));
	await invoice(await api.request.post('/api/invoices', { data: input }));
	const cancelled = await invoice(await api.request.post('/api/invoices/42/cancel', { data: {} }));
	expect(cancelled.status).toBe('cancelled');
	expect(cancelled.checkout).toBeNull();
	expect(await invoice(await api.request.post('/api/invoices/42/cancel', { data: {} }))).toEqual(
		cancelled
	);
	expect(await invoice(await api.request.post('/api/invoices', { data: input }))).toEqual(
		cancelled
	);
	await api.db.prepare("DELETE FROM credits WHERE user_id = 'owner'").run();
	expect((await api.request.post('/api/invoices', { data: { ...input, id: '44' } })).status()).toBe(
		403
	);
	expect(api.rate.requests).toBe(0);
});

test('reuses the frozen checkout and polls production invoices without a provider request', async ({
	invoiceApi: api
}) => {
	api.platform.env.ROBOKASSA_IS_TEST = 'false';
	await invoice(await api.request.post('/api/invoices', { data: input }), 201);
	const first = await invoice(await api.request.post('/api/invoices/42/checkout', { data: {} }));
	expect(first.checkout).toEqual({
		paymentUrl: expect.any(String),
		amountMinor: 82500,
		currency: 'RUB',
		isTest: false
	});
	const url = new URL(first.checkout!.paymentUrl);
	expect(url.origin).toBe('https://auth.robokassa.ru');
	expect(url.searchParams.get('InvId')).toBe('42');
	expect(url.searchParams.get('OutSum')).toBe('825.00');
	api.rate.available = false;
	for (const path of ['/api/invoices/42/checkout', '/api/invoices/42']) {
		const response = path.endsWith('/checkout')
			? await api.request.post(path, { data: {} })
			: await api.request.get(path);
		expect(await invoice(response)).toEqual(first);
	}
	expect(api.rate.requests).toBe(1);
	const override = await api.request.post('/api/invoices/42/checkout', {
		data: { paymentProcessor: 'other' }
	});
	expect(override.status()).toBe(400);
});

test('keeps failed checkout retryable and rejects unsafe converted amounts', async ({
	invoiceApi: api
}) => {
	await invoice(await api.request.post('/api/invoices', { data: input }), 201);
	api.rate.available = false;
	const failed = await api.request.post('/api/invoices/42/checkout', { data: {} });
	expect(failed.status()).toBe(503);
	expect(failed.headers()['retry-after']).toBe('5');
	expect(await invoice(await api.request.get('/api/invoices/42'))).toMatchObject({
		status: 'open',
		checkout: null
	});
	api.rate.available = true;
	expect(
		(await invoice(await api.request.post('/api/invoices/42/checkout', { data: {} }))).checkout
	).not.toBeNull();
	await invoice(
		await api.request.post('/api/invoices', {
			data: { ...input, id: '43', amountMinor: Number.MAX_SAFE_INTEGER }
		}),
		201
	);
	const unsafe = await api.request.post('/api/invoices/43/checkout', { data: {} });
	expect(unsafe.status()).toBe(400);
	expect(await unsafe.json()).toMatchObject({ error: { code: 'amount_out_of_range' } });
	expect(
		await api.db
			.prepare("SELECT COUNT(*) AS count FROM robokassa_invoice_details WHERE invoice_id = '43'")
			.first('count')
	).toBe(0);
});

test('settles a signed payment once after cancellation and refreshes the account credit', async ({
	invoiceApi: api
}) => {
	await invoice(await api.request.post('/api/invoices', { data: input }), 201);
	await invoice(await api.request.post('/api/invoices/42/checkout', { data: {} }));
	const cancelled = await invoice(await api.request.post('/api/invoices/42/cancel', { data: {} }));
	expect(cancelled.status).toBe('cancelled');
	expect(cancelled.checkout).toBeNull();
	expect((await api.request.post('/api/invoices/42/checkout', { data: {} })).status()).toBe(409);
	for (const response of await Promise.all([
		api.request.get(notification()),
		api.request.get(notification()),
		api.request.get(notification())
	])) {
		expect(response.status()).toBe(200);
		expect(await response.text()).toBe('OK42');
	}
	const paid = await invoice(await api.request.get('/api/invoices/42'));
	expect(paid).toMatchObject({ status: 'paid', paidAt: expect.any(Number), checkout: null });
	expect(await invoice(await api.request.post('/api/invoices', { data: input }))).toEqual(paid);
	expect((await api.request.post('/api/invoices/42/cancel', { data: {} })).status()).toBe(409);
	expect((await api.request.post('/api/invoices/42/checkout', { data: {} })).status()).toBe(409);
	expect(
		await api.db.prepare('SELECT amount, entry_side, reason FROM ledger_entries').all()
	).toMatchObject({
		results: [{ amount: 1000, entry_side: 'credit', reason: 'top-up' }]
	});
	expect(await api.db.prepare('SELECT COUNT(*) AS count FROM ledger_entries').first('count')).toBe(
		1
	);
	expect(
		await api.db.prepare("SELECT enabled FROM credits WHERE user_id = 'owner'").first('enabled')
	).toBe(1);
	const me = await api.request.get('/auth/me');
	expect(me.status()).toBe(200);
	expect(await me.json()).toMatchObject({ credit: { balance: 10 } });
	expect(await api.db.prepare('SELECT COUNT(*) AS count FROM balances').first('count')).toBe(0);
});

test('reads and cancels an existing quote without valid provider configuration', async ({
	invoiceApi: api
}) => {
	await api.db
		.prepare(
			`INSERT INTO invoices (id, payment_processor, user_id, amount_minor, currency, created_at)
		VALUES ('42', 'robokassa', 'owner', 1, 'USD', 1)`
		)
		.run();
	await api.db
		.prepare(
			`INSERT INTO robokassa_invoice_details
		(invoice_id, payment_url, rub_amount_minor, rub_per_usd, rate_as_of, is_test, hash_algorithm)
		VALUES ('42', 'https://example.test/payment', 83, '82.5', 1, 1, 'md5')`
		)
		.run();
	api.platform.env.ROBOKASSA_PASSWORD1 = '';
	const saved = await invoice(await api.request.get('/api/invoices/42'));
	expect(saved).toMatchObject({
		createdAt: 1,
		checkout: { amountMinor: 83, paymentUrl: 'https://example.test/payment' }
	});
	expect((await api.request.post('/api/invoices/42/checkout', { data: {} })).status()).toBe(503);
	expect((await api.request.post('/api/invoices', { data: { ...input, id: '43' } })).status()).toBe(
		503
	);
	expect(
		(await invoice(await api.request.post('/api/invoices/42/cancel', { data: {} }))).status
	).toBe('cancelled');
	expect(api.rate.requests).toBe(0);
});

test('returns retryable, sanitized errors when session or invoice storage fails', async ({
	invoiceApi: api
}) => {
	await invoice(await api.request.post('/api/invoices', { data: input }), 201);
	await api.db.prepare('ALTER TABLE sessions RENAME TO unavailable_sessions').run();
	const unavailable = await api.request.get('/api/invoices/42');
	expect(unavailable.status()).toBe(503);
	expect(unavailable.headers()['cache-control']).toBe('no-store');
	expect(unavailable.headers()['retry-after']).toBe('5');
	expect(await unavailable.json()).toMatchObject({ error: { code: 'authentication_unavailable' } });
	await api.db.prepare('ALTER TABLE unavailable_sessions RENAME TO sessions').run();
	await api.db
		.prepare(
			`CREATE TRIGGER reject_invoice_creation BEFORE INSERT ON invoices
		BEGIN SELECT RAISE(ABORT, 'private database diagnostic'); END`
		)
		.run();
	const failure = await api.request.post('/api/invoices', { data: { ...input, id: '43' } });
	expect(failure.status()).toBe(503);
	expect(await failure.json()).toEqual({
		error: { code: 'account_unavailable', message: 'Account data unavailable' }
	});
	expect(await api.db.prepare('SELECT COUNT(*) AS count FROM invoices').first('count')).toBe(1);
});

test('enforces independent per-user limits and allows requests after window expiry', async ({
	invoiceApi: api
}) => {
	await invoice(await api.request.post('/api/invoices', { data: input }), 201);
	for (const [operation, max, path, method] of [
		['create', 10, '/api/invoices', 'POST'],
		['checkout', 30, '/api/invoices/42/checkout', 'POST'],
		['cancel', 30, '/api/invoices/42/cancel', 'POST'],
		['read', 60, '/api/invoices/42', 'GET']
	] as const) {
		await api.db
			.prepare(
				`INSERT INTO rate_limits (bucket, count, reset_at) VALUES (?, ?, ?)
			ON CONFLICT(bucket) DO UPDATE SET count = excluded.count, reset_at = excluded.reset_at`
			)
			.bind('invoice:' + operation + ':owner', max, Date.now() + 60_000)
			.run();
		const response = await api.request.fetch(path, {
			method,
			...(method === 'POST' ? { data: operation === 'create' ? input : {} } : {})
		});
		expect(response.status()).toBe(429);
		expect(response.headers()['retry-after']).toBe('60');
		expect(response.headers()['cache-control']).toBe('no-store');
	}
	const foreign = await api.request.post('/api/invoices', {
		data: { ...input, id: '43' },
		headers: { cookie: `${SESSION_COOKIE}=foreign-auth` }
	});
	await invoice(foreign, 201);
	await api.db.prepare('UPDATE rate_limits SET reset_at = 0').run();
	await invoice(await api.request.get('/api/invoices/42'));
	await invoice(await api.request.post('/api/invoices', { data: input }));
});

test('dispatches to the stored processor using test factories without live diagnostics', async ({
	invoiceApi: api
}) => {
	const db = createDb(api.db);
	const calls: string[] = [];
	let quoted = false;
	const registry: PaymentProcessorRegistration[] = [
		{
			id: 'alternative',
			invoiceCurrencies: ['USD'],
			paymentCurrencies: ['EUR'],
			validateConfiguration: () => {},
			createClient: () => ({
				id: 'alternative',
				createInvoice: async (invoice) => {
					calls.push('checkout:' + invoice.id);
					quoted = true;
					return { url: 'https://alternative.test/pay' };
				},
				cancelInvoice: async (invoice) => {
					calls.push('cancel:' + invoice.id);
					await api.db
						.prepare("UPDATE invoices SET status = 'cancelled' WHERE id = ?")
						.bind(invoice.id)
						.run();
					return { ok: true, cause: undefined };
				},
				getInvoiceDetails: async () => {
					throw new Error('Live diagnostics must not be called');
				}
			}),
			getCheckout: async () =>
				quoted
					? {
							paymentUrl: 'https://alternative.test/pay',
							amountMinor: 950,
							currency: 'EUR',
							isTest: true
						}
					: null
		}
	];
	const created = await createInvoice(
		db,
		api.platform,
		'owner',
		{ ...input, paymentProcessor: 'alternative' },
		registry
	);
	expect(created.created).toBe(true);
	const checkout = await checkoutInvoice(db, api.platform, 'owner', input.id, registry);
	expect(checkout).toMatchObject({
		paymentProcessor: 'alternative',
		checkout: { currency: 'EUR' }
	});
	expect(await getInvoice(db, 'owner', input.id, registry)).toEqual(checkout);
	expect((await cancelInvoice(db, api.platform, 'owner', input.id, registry)).status).toBe(
		'cancelled'
	);
	expect(calls).toEqual(['checkout:42', 'cancel:42']);
	expect(api.rate.requests).toBe(0);
});
