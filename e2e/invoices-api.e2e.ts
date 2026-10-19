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
import { createRobokassaClient } from '$lib/server/payment-processors/robokassa/client';
import type { PaymentProcessorRegistration } from '$lib/server/payment-processors/registry';
import { expect, test } from './helpers/invoice-api';

const input: CreateInvoiceRequest = {
	id: '00000000-0000-4000-8000-000000000042',
	paymentProcessor: 'robokassa',
	amountMinor: 1000,
	currency: 'USD'
};

async function invoice(response: APIResponse, status = 200): Promise<InvoiceResponse> {
	expect(response.status()).toBe(status);
	expect(response.headers()['cache-control']).toBe('no-store');
	return response.json() as Promise<InvoiceResponse>;
}

function notification(id: string, outSum = '825.00', password = 'test-two'): string {
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
		...['42', '0', '01', '-1', '+1', '1.0', '1e3', '9007199254740992', 'abc'].map((id) => ({
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
			data: { ...input, id: crypto.randomUUID() }
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
		['GET', '/api/invoices/00000000-0000-4000-8000-000000000042'],
		['POST', '/api/invoices/00000000-0000-4000-8000-000000000042/checkout'],
		['POST', '/api/invoices/00000000-0000-4000-8000-000000000042/cancel']
	]) {
		const response = await api.request.fetch(path, {
			method,
			headers: { cookie: '' },
			...(method === 'POST' ? { data: input } : {})
		});
		expect(response.status()).toBe(401);
		expect(response.headers()['cache-control']).toBe('no-store');
	}
	for (const path of [
		'/api/invoices',
		'/api/invoices/00000000-0000-4000-8000-000000000042/checkout',
		'/api/invoices/00000000-0000-4000-8000-000000000042/cancel'
	]) {
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

test('rejects numeric Cadbos invoice IDs on every invoice path', async ({ invoiceApi: api }) => {
	for (const suffix of ['', '/checkout', '/cancel']) {
		const response = await api.request.fetch('/api/invoices/42' + suffix, {
			method: suffix ? 'POST' : 'GET',
			...(suffix ? { data: {} } : {})
		});
		expect(response.status()).toBe(400);
		expect(await response.json()).toMatchObject({ error: { code: 'invalid_request' } });
	}
	expect(api.rate.requests).toBe(0);
});

test('hides missing and foreign invoices before any provider interaction', async ({
	invoiceApi: api
}) => {
	await invoice(await api.request.post('/api/invoices', { data: input }), 201);
	for (const id of [
		'00000000-0000-4000-8000-000000000042',
		'00000000-0000-4000-8000-000000000043'
	]) {
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
	expect(
		(
			await api.request.post('/api/invoices', {
				data: { ...input, id: '00000000-0000-4000-8000-000000000043' }
			})
		).status()
	).toBe(403);
	expect(
		(
			await api.request.post('/api/invoices/00000000-0000-4000-8000-000000000042/checkout', {
				data: {}
			})
		).status()
	).toBe(403);
	await invoice(await api.request.get('/api/invoices/00000000-0000-4000-8000-000000000042'));
	await invoice(await api.request.post('/api/invoices', { data: input }));
	const cancelled = await invoice(
		await api.request.post('/api/invoices/00000000-0000-4000-8000-000000000042/cancel', {
			data: {}
		})
	);
	expect(cancelled.status).toBe('cancelled');
	expect(cancelled.checkout).toBeNull();
	expect(
		await invoice(
			await api.request.post('/api/invoices/00000000-0000-4000-8000-000000000042/cancel', {
				data: {}
			})
		)
	).toEqual(cancelled);
	expect(await invoice(await api.request.post('/api/invoices', { data: input }))).toEqual(
		cancelled
	);
	await api.db.prepare("DELETE FROM credits WHERE user_id = 'owner'").run();
	expect(
		(
			await api.request.post('/api/invoices', {
				data: { ...input, id: '00000000-0000-4000-8000-000000000044' }
			})
		).status()
	).toBe(403);
	expect(api.rate.requests).toBe(0);
});

test('reuses the frozen checkout and polls production invoices without a provider request', async ({
	invoiceApi: api
}) => {
	api.platform.env.ROBOKASSA_IS_TEST = 'false';
	await invoice(await api.request.post('/api/invoices', { data: input }), 201);
	const first = await invoice(
		await api.request.post('/api/invoices/00000000-0000-4000-8000-000000000042/checkout', {
			data: {}
		})
	);
	expect(first.checkout).toEqual({
		paymentUrl: expect.any(String),
		amountMinor: 82500,
		currency: 'RUB',
		isTest: false
	});
	const url = new URL(first.checkout!.paymentUrl);
	expect(url.origin).toBe('https://auth.robokassa.ru');
	expect(Number.isSafeInteger(Number(url.searchParams.get('InvId')))).toBe(true);
	expect(url.searchParams.get('InvId')).not.toBe(input.id);
	expect(url.searchParams.get('OutSum')).toBe('825.00');
	const savedQuote = await api.db.prepare('SELECT * FROM robokassa_invoice_details').first();
	api.rate.available = false;
	api.platform.env.ROBOKASSA_IS_TEST = 'true';
	api.platform.env.ROBOKASSA_HASH_ALGORITHM = 'sha256';
	for (const path of [
		'/api/invoices/00000000-0000-4000-8000-000000000042/checkout',
		'/api/invoices/00000000-0000-4000-8000-000000000042'
	]) {
		const response = path.endsWith('/checkout')
			? await api.request.post(path, { data: {} })
			: await api.request.get(path);
		expect(await invoice(response)).toEqual(first);
	}
	expect(api.rate.requests).toBe(1);
	expect(await api.db.prepare('SELECT * FROM robokassa_invoice_details').first()).toEqual(
		savedQuote
	);
	const override = await api.request.post(
		'/api/invoices/00000000-0000-4000-8000-000000000042/checkout',
		{
			data: { paymentProcessor: 'other' }
		}
	);
	expect(override.status()).toBe(400);
});

test('keeps failed checkout retryable and rejects unsafe converted amounts', async ({
	invoiceApi: api
}) => {
	await invoice(await api.request.post('/api/invoices', { data: input }), 201);
	api.rate.available = false;
	const failed = await api.request.post(
		'/api/invoices/00000000-0000-4000-8000-000000000042/checkout',
		{ data: {} }
	);
	expect(failed.status()).toBe(503);
	expect(failed.headers()['retry-after']).toBe('5');
	expect(
		await api.db.prepare('SELECT COUNT(*) AS count FROM robokassa_invoice_details').first('count')
	).toBe(0);
	expect(
		await invoice(await api.request.get('/api/invoices/00000000-0000-4000-8000-000000000042'))
	).toMatchObject({
		status: 'open',
		checkout: null
	});
	api.rate.available = true;
	expect(
		(
			await invoice(
				await api.request.post('/api/invoices/00000000-0000-4000-8000-000000000042/checkout', {
					data: {}
				})
			)
		).checkout
	).not.toBeNull();
	await invoice(
		await api.request.post('/api/invoices', {
			data: {
				...input,
				id: '00000000-0000-4000-8000-000000000043',
				amountMinor: Number.MAX_SAFE_INTEGER
			}
		}),
		201
	);
	const unsafe = await api.request.post(
		'/api/invoices/00000000-0000-4000-8000-000000000043/checkout',
		{ data: {} }
	);
	expect(unsafe.status()).toBe(400);
	expect(await unsafe.json()).toMatchObject({ error: { code: 'amount_out_of_range' } });
	expect(
		await api.db
			.prepare(
				"SELECT COUNT(*) AS count FROM robokassa_invoice_details WHERE invoice_id = '00000000-0000-4000-8000-000000000043'"
			)
			.first('count')
	).toBe(0);
});

test('settles a signed payment once after cancellation and refreshes the account credit', async ({
	invoiceApi: api
}) => {
	await invoice(await api.request.post('/api/invoices', { data: input }), 201);
	const checkout = await invoice(
		await api.request.post('/api/invoices/00000000-0000-4000-8000-000000000042/checkout', {
			data: {}
		})
	);
	const invId = new URL(checkout.checkout!.paymentUrl).searchParams.get('InvId')!;
	const cancelled = await invoice(
		await api.request.post('/api/invoices/00000000-0000-4000-8000-000000000042/cancel', {
			data: {}
		})
	);
	expect(cancelled.status).toBe('cancelled');
	expect(cancelled.checkout).toBeNull();
	expect(
		await invoice(await api.request.post('/api/invoices/' + input.id + '/cancel', { data: {} }))
	).toEqual(cancelled);
	expect(
		(
			await api.request.post('/api/invoices/00000000-0000-4000-8000-000000000042/checkout', {
				data: {}
			})
		).status()
	).toBe(409);
	for (const response of await Promise.all([
		api.request.get(notification(invId)),
		api.request.get(notification(invId)),
		api.request.get(notification(invId))
	])) {
		expect(response.status()).toBe(200);
		expect(await response.text()).toBe(`OK${invId}`);
	}
	const paid = await invoice(
		await api.request.get('/api/invoices/00000000-0000-4000-8000-000000000042')
	);
	expect(paid).toMatchObject({ status: 'paid', paidAt: expect.any(Number), checkout: null });
	expect(await invoice(await api.request.post('/api/invoices', { data: input }))).toEqual(paid);
	expect(
		(
			await api.request.post('/api/invoices/00000000-0000-4000-8000-000000000042/cancel', {
				data: {}
			})
		).status()
	).toBe(409);
	expect(
		(
			await api.request.post('/api/invoices/00000000-0000-4000-8000-000000000042/checkout', {
				data: {}
			})
		).status()
	).toBe(409);
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
		VALUES ('00000000-0000-4000-8000-000000000042', 'robokassa', 'owner', 1, 'USD', 1)`
		)
		.run();
	await api.db
		.prepare(
			`INSERT INTO robokassa_invoice_details
		(invoice_id, inv_id, payment_url, rub_amount_minor, rub_per_usd, rate_as_of, is_test, hash_algorithm)
		VALUES ('00000000-0000-4000-8000-000000000042', 42, 'https://example.test/payment', 83, '82.5', 1, 1, 'md5')`
		)
		.run();
	api.platform.env.ROBOKASSA_PASSWORD1 = '';
	const saved = await invoice(
		await api.request.get('/api/invoices/00000000-0000-4000-8000-000000000042')
	);
	expect(saved).toMatchObject({
		createdAt: 1,
		checkout: { amountMinor: 83, paymentUrl: 'https://example.test/payment' }
	});
	expect(
		(
			await api.request.post('/api/invoices/00000000-0000-4000-8000-000000000042/checkout', {
				data: {}
			})
		).status()
	).toBe(503);
	expect(
		(
			await api.request.post('/api/invoices', {
				data: { ...input, id: '00000000-0000-4000-8000-000000000043' }
			})
		).status()
	).toBe(503);
	expect(
		(
			await invoice(
				await api.request.post('/api/invoices/00000000-0000-4000-8000-000000000042/cancel', {
					data: {}
				})
			)
		).status
	).toBe('cancelled');
	expect(api.rate.requests).toBe(0);
});

test('returns retryable, sanitized errors when session or invoice storage fails', async ({
	invoiceApi: api
}) => {
	await invoice(await api.request.post('/api/invoices', { data: input }), 201);
	await api.db.prepare('ALTER TABLE sessions RENAME TO unavailable_sessions').run();
	const unavailable = await api.request.get('/api/invoices/00000000-0000-4000-8000-000000000042');
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
	const failure = await api.request.post('/api/invoices', {
		data: { ...input, id: '00000000-0000-4000-8000-000000000043' }
	});
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
		['checkout', 30, '/api/invoices/00000000-0000-4000-8000-000000000042/checkout', 'POST'],
		['cancel', 30, '/api/invoices/00000000-0000-4000-8000-000000000042/cancel', 'POST'],
		['read', 60, '/api/invoices/00000000-0000-4000-8000-000000000042', 'GET']
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
		data: { ...input, id: '00000000-0000-4000-8000-000000000043' },
		headers: { cookie: `${SESSION_COOKIE}=foreign-auth` }
	});
	await invoice(foreign, 201);
	await api.db.prepare('UPDATE rate_limits SET reset_at = 0').run();
	await invoice(await api.request.get('/api/invoices/00000000-0000-4000-8000-000000000042'));
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
	expect(calls).toEqual(['checkout:' + input.id, 'cancel:' + input.id]);
	expect(api.rate.requests).toBe(0);
});

async function withProviderIds(
	candidates: number[],
	run: (calls: () => number) => Promise<void>
): Promise<void> {
	const original = crypto.getRandomValues;
	let calls = 0;
	crypto.getRandomValues = (array) => {
		if (array instanceof Uint32Array && array.length === 2) {
			array.set([0, candidates[Math.min(calls++, candidates.length - 1)]]);
			return array;
		}
		return original.call(crypto, array);
	};
	try {
		await run(() => calls);
	} finally {
		crypto.getRandomValues = original;
	}
}

for (const [mode, hash] of [
	['true', 'md5'],
	['false', 'sha256']
] as const) {
	test(`persists a signed ${mode === 'true' ? 'test' : 'production'} checkout and its quote`, async ({
		invoiceApi: api
	}) => {
		api.platform.env.ROBOKASSA_IS_TEST = mode;
		api.platform.env.ROBOKASSA_HASH_ALGORITHM = hash;
		await invoice(await api.request.post('/api/invoices', { data: input }), 201);
		const result = await invoice(
			await api.request.post(`/api/invoices/${input.id}/checkout`, { data: {} })
		);
		const url = new URL(result.checkout!.paymentUrl);
		const invId = url.searchParams.get('InvId')!;
		expect(url.origin + url.pathname).toBe('https://auth.robokassa.ru/Merchant/Index.aspx');
		expect(url.searchParams.get('MerchantLogin')).toBe('merchant');
		expect(url.searchParams.get('OutSum')).toBe('825.00');
		expect(url.searchParams.get('Description')).toBe(`Cadbos #${input.id}`);
		expect(url.searchParams.get('IsTest')).toBe(mode === 'true' ? '1' : null);
		expect(url.searchParams.get('SignatureValue')).toBe(
			createHash(hash)
				.update(`merchant:825.00:${invId}:${mode === 'true' ? 'test-one' : 'production-one'}`)
				.digest('hex')
		);
		expect(await api.db.prepare('SELECT * FROM robokassa_invoice_details').first()).toMatchObject({
			invoice_id: input.id,
			inv_id: Number(invId),
			payment_url: url.href,
			is_test: mode === 'true' ? 1 : 0,
			hash_algorithm: hash,
			rub_amount_minor: 82500,
			rub_per_usd: '82.5',
			rate_as_of: Date.parse('2026-10-19T00:00:00Z'),
			result_out_sum: null,
			result_fee: null,
			payer_email: null,
			payment_method: null,
			inc_curr_label: null
		});
	});
}

test('persists the settings used to sign checkout without rereading configuration', async ({
	invoiceApi: api
}) => {
	await invoice(await api.request.post('/api/invoices', { data: input }), 201);
	let modeReads = 0;
	let hashReads = 0;
	Object.defineProperties(api.platform.env, {
		ROBOKASSA_IS_TEST: {
			get: () => (++modeReads === 1 ? 'true' : 'false')
		},
		ROBOKASSA_HASH_ALGORITHM: {
			get: () => (++hashReads === 1 ? 'md5' : 'sha512')
		}
	});
	const { url: paymentUrl } = await createRobokassaClient(api.platform).createInvoice(input);
	const url = new URL(paymentUrl);
	const invId = url.searchParams.get('InvId');
	expect(url.searchParams.get('IsTest')).toBe('1');
	expect(url.searchParams.get('SignatureValue')).toBe(
		createHash('md5').update(`merchant:825.00:${invId}:test-one`).digest('hex')
	);
	expect(await api.db.prepare('SELECT * FROM robokassa_invoice_details').first()).toMatchObject({
		invoice_id: input.id,
		payment_url: paymentUrl,
		is_test: 1,
		hash_algorithm: 'md5'
	});
	expect(modeReads).toBe(1);
	expect(hashReads).toBe(1);
});

for (const outcome of ['retry', 'exhausted', 'database failure'] as const) {
	test(`handles provider ID allocation: ${outcome}`, async ({ invoiceApi: api }) => {
		await invoice(await api.request.post('/api/invoices', { data: input }), 201);
		await withProviderIds([42], async () => {
			await invoice(await api.request.post(`/api/invoices/${input.id}/checkout`, { data: {} }));
		});
		const initial = await api.db.prepare('SELECT * FROM robokassa_invoice_details').first();
		const next = { ...input, id: '00000000-0000-4000-8000-000000000043' };
		await invoice(await api.request.post('/api/invoices', { data: next }), 201);
		if (outcome === 'database failure') {
			await api.db
				.prepare(
					`CREATE TRIGGER quote_failure BEFORE INSERT ON robokassa_invoice_details
			BEGIN SELECT RAISE(ABORT, 'quote allocation write failed'); END`
				)
				.run();
		}
		await withProviderIds(outcome === 'retry' ? [42, 43] : [42], async (calls) => {
			const response = await api.request.post(`/api/invoices/${next.id}/checkout`, { data: {} });
			if (outcome === 'retry') {
				const result = await invoice(response);
				expect(new URL(result.checkout!.paymentUrl).searchParams.get('InvId')).toBe('43');
			} else {
				expect(response.status()).toBe(503);
				expect(await response.json()).toMatchObject({
					error: { code: outcome === 'exhausted' ? 'payment_unavailable' : 'account_unavailable' }
				});
			}
			expect(calls()).toBe(outcome === 'retry' ? 2 : outcome === 'exhausted' ? 3 : 1);
		});
		expect(
			await api.db
				.prepare('SELECT * FROM robokassa_invoice_details WHERE invoice_id = ?')
				.bind(input.id)
				.first()
		).toEqual(initial);
		expect(
			await api.db.prepare('SELECT COUNT(*) AS count FROM robokassa_invoice_details').first('count')
		).toBe(outcome === 'retry' ? 2 : 1);
	});
}

test('stores the first winning quote for concurrent HTTP checkouts', async ({
	invoiceApi: api
}) => {
	await invoice(await api.request.post('/api/invoices', { data: input }), 201);
	const pending: ((response: Response) => void)[] = [];
	api.rate.respond = () => new Promise<Response>((resolve) => pending.push(resolve));
	const first = api.request.post(`/api/invoices/${input.id}/checkout`, { data: {} });
	let second: Promise<APIResponse> | undefined;
	try {
		await expect.poll(() => pending.length).toBe(1);
		second = api.request.post(`/api/invoices/${input.id}/checkout`, { data: {} });
		await expect.poll(() => pending.length).toBe(2);
		pending[1](Response.json({ Date: '2026-10-14', Valute: { USD: { Value: 90, Nominal: 1 } } }));
		const winner = await invoice(await second);
		pending[0](Response.json({ Date: '2026-10-15', Valute: { USD: { Value: 100, Nominal: 1 } } }));
		expect(await invoice(await first)).toEqual(winner);
		expect(
			await api.db
				.prepare('SELECT rub_amount_minor, rub_per_usd, rate_as_of FROM robokassa_invoice_details')
				.first()
		).toEqual({
			rub_amount_minor: 90000,
			rub_per_usd: '90',
			rate_as_of: Date.parse('2026-10-14')
		});
		expect(
			await api.db.prepare('SELECT COUNT(*) AS count FROM robokassa_invoice_details').first('count')
		).toBe(1);
	} finally {
		api.rate.respond = async () => new Response(null, { status: 503 });
		for (const resolve of pending) resolve(new Response(null, { status: 503 }));
		await Promise.all([first, second]);
	}
});

for (const assignment of [
	'amount_minor = 1001',
	"user_id = 'foreign'",
	"payment_processor = 'other'",
	"status = 'cancelled'"
]) {
	test(`rejects invoice changes during HTTP checkout: ${assignment}`, async ({
		invoiceApi: api
	}) => {
		await invoice(await api.request.post('/api/invoices', { data: input }), 201);
		api.rate.respond = async () => {
			await api.db.prepare(`UPDATE invoices SET ${assignment} WHERE id = ?`).bind(input.id).run();
			return Response.json({ Date: '2026-10-19', Valute: { USD: { Value: 82.5, Nominal: 1 } } });
		};
		const response = await api.request.post(`/api/invoices/${input.id}/checkout`, { data: {} });
		expect(response.status()).toBe(
			assignment.startsWith('user_id') ? 404 : assignment.startsWith('status') ? 409 : 503
		);
		expect(
			await api.db.prepare('SELECT COUNT(*) AS count FROM robokassa_invoice_details').first('count')
		).toBe(0);
	});
}

test('validates processor inputs and reuses a stored quote without rates or credentials', async ({
	invoiceApi: api
}) => {
	await invoice(await api.request.post('/api/invoices', { data: input }), 201);
	const client = createRobokassaClient(api.platform);
	for (const amountMinor of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
		await expect(client.createInvoice({ ...input, amountMinor })).rejects.toThrow('USD cents');
	}
	await expect(client.createInvoice({ ...input, id: 'abc' })).rejects.toThrow('UUID');
	await expect(client.createInvoice({ ...input, amountMinor: 1001 })).rejects.toThrow(
		'missing, changed'
	);
	await expect(
		client.createInvoice({ ...input, id: '00000000-0000-4000-8000-000000000043' })
	).rejects.toThrow('missing, changed');
	const checkout = await invoice(
		await api.request.post(`/api/invoices/${input.id}/checkout`, { data: {} })
	);
	const before = await api.db.prepare('SELECT * FROM robokassa_invoice_details').first();
	api.rate.available = false;
	const changed = {
		env: { DB: api.db, ROBOKASSA_IS_TEST: 'invalid', ROBOKASSA_HASH_ALGORITHM: 'invalid' }
	} as App.Platform;
	await expect(createRobokassaClient(changed).createInvoice(input)).resolves.toEqual({
		url: checkout.checkout!.paymentUrl
	});
	expect(await api.db.prepare('SELECT * FROM robokassa_invoice_details').first()).toEqual(before);
	expect(api.rate.requests).toBe(1);
});

for (const settings of [{ ROBOKASSA_IS_TEST: '1' }, { ROBOKASSA_HASH_ALGORITHM: 'sha1' }]) {
	test(`rejects invalid checkout configuration ${JSON.stringify(settings)}`, async ({
		invoiceApi: api
	}) => {
		await invoice(await api.request.post('/api/invoices', { data: input }), 201);
		Object.assign(api.platform.env, settings);
		const response = await api.request.post(`/api/invoices/${input.id}/checkout`, { data: {} });
		expect(response.status()).toBe(503);
		expect(api.rate.requests).toBe(0);
		expect(
			await api.db.prepare('SELECT COUNT(*) AS count FROM robokassa_invoice_details').first('count')
		).toBe(0);
	});
}
