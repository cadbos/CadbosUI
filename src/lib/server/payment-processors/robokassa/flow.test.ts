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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { closeD1, makeD1 } from '$lib/server/testing/d1-shim';
import { createRobokassaClient } from './client';
import type { PaymentProcessor } from '../interface';

const credentials = {
	ROBOKASSA_LOGIN: 'demo-shop',
	ROBOKASSA_PASSWORD1: 'production-one',
	ROBOKASSA_PASSWORD2: 'production-two',
	ROBOKASSA_TEST_PASSWORD1: 'test',
	ROBOKASSA_TEST_PASSWORD2: 'test'
};
const invoice = { id: '42', amountMinor: 1000, currency: 'USD' as const };

function platform(db: D1Database = makeD1()): App.Platform {
	return { env: { ...credentials, DB: db } } as App.Platform;
}

const rateFetch = vi.fn<typeof fetch>();
function processor(context: App.Platform): PaymentProcessor {
	return createRobokassaClient(context, rateFetch);
}

async function insertInvoice(
	platformValue: App.Platform,
	value: {
		id: string;
		amountMinor: number;
		currency: string;
		status?: 'open' | 'cancelled';
	} = invoice
): Promise<void> {
	const now = Date.now();
	await platformValue.env.DB.prepare(
		"INSERT OR IGNORE INTO users (id, pubkey, created_at) VALUES ('owner', 'pubkey', 1)"
	).run();
	await platformValue.env.DB.prepare(
		`INSERT INTO invoices (id, payment_processor, user_id, amount_minor, currency, status, created_at, updated_at)
		 VALUES (?, 'robokassa', 'owner', ?, ?, ?, ?, ?)`
	)
		.bind(value.id, value.amountMinor, value.currency, value.status ?? 'open', now, now)
		.run();
}

async function invoiceState(
	platformValue: App.Platform
): Promise<{ status: string; paid_at: number | null } | null> {
	return platformValue.env.DB.prepare('SELECT status, paid_at FROM invoices WHERE id = ?')
		.bind(invoice.id)
		.first<{ status: string; paid_at: number | null }>();
}

interface InvoiceDetails {
	payment_url: string;
	is_test: number;
	hash_algorithm: string;
	result_out_sum: string | null;
	result_fee: string | null;
	payer_email: string | null;
	payment_method: string | null;
	inc_curr_label: string | null;
}

async function invoiceDetails(platformValue: App.Platform): Promise<InvoiceDetails | null> {
	return platformValue.env.DB.prepare(
		'SELECT * FROM robokassa_invoice_details WHERE invoice_id = ?'
	)
		.bind(invoice.id)
		.first<InvoiceDetails>();
}

function resultRequest(outSum = '825.00', fields: Record<string, string> = {}): Request {
	const invId = fields.InvId ?? '42';
	const signature = createHash('md5').update(`${outSum}:${invId}:test`).digest('hex');
	return new Request(
		`https://app.cadbos.com/api/robokassa/result?${new URLSearchParams({ OutSum: outSum, InvId: '42', SignatureValue: signature, ...fields })}`
	);
}

describe('Robokassa payment flow', () => {
	let context: App.Platform;

	beforeEach(async () => {
		rateFetch.mockReset().mockImplementation(async () =>
			Response.json({
				Date: '2026-10-14T00:00:00.000Z',
				Valute: { USD: { Value: 82.5, Nominal: 1 } }
			})
		);
		context = platform();
		await insertInvoice(context);
		await processor(context).createInvoice(invoice);
	});

	afterEach(() => {
		closeD1(context.env.DB);
	});

	it('builds a signed test payment URL for an existing USD invoice', async () => {
		const paymentUrl = (await processor(context).createInvoice(invoice)).url;
		const url = new URL(paymentUrl);
		expect(`${url.origin}${url.pathname}`).toBe('https://auth.robokassa.ru/Merchant/Index.aspx');
		expect(url.searchParams.get('MerchantLogin')).toBe('demo-shop');
		expect(url.searchParams.get('OutSum')).toBe('825.00');
		expect(url.searchParams.get('InvId')).toBe('42');
		expect(url.searchParams.get('Description')).toBe('Cadbos #42');
		expect(url.searchParams.get('IsTest')).toBe('1');
		expect(url.searchParams.get('SignatureValue')).toBe(
			createHash('md5').update('demo-shop:825.00:42:test').digest('hex')
		);
		await expect(invoiceDetails(context)).resolves.toMatchObject({
			payment_url: paymentUrl,
			is_test: 1,
			hash_algorithm: 'md5',
			rub_amount_minor: 82500,
			rub_per_usd: '82.5',
			rate_as_of: Date.parse('2026-10-14T00:00:00.000Z'),
			result_out_sum: null,
			result_fee: null,
			payer_email: null,
			payment_method: null,
			inc_curr_label: null
		});
	});

	it('keeps the first payment URL and settings when configuration changes', async () => {
		const first = await invoiceDetails(context);
		const changedConfig = {
			env: {
				...context.env,
				ROBOKASSA_IS_TEST: 'false',
				ROBOKASSA_HASH_ALGORITHM: 'sha256'
			}
		} as App.Platform;
		await expect(processor(changedConfig).createInvoice(invoice)).resolves.toEqual({
			url: first?.payment_url
		});
		await expect(invoiceDetails(context)).resolves.toEqual(first);
	});

	it('records production mode and the selected hash for a new invoice', async () => {
		const otherInvoice = { ...invoice, id: '43' };
		await insertInvoice(context, otherInvoice);
		const production = {
			env: {
				...context.env,
				ROBOKASSA_IS_TEST: 'false',
				ROBOKASSA_HASH_ALGORITHM: 'sha256'
			}
		} as App.Platform;
		const paymentUrl = (await processor(production).createInvoice(otherInvoice)).url;
		const details = await context.env.DB.prepare(
			'SELECT payment_url, is_test, hash_algorithm FROM robokassa_invoice_details WHERE invoice_id = ?'
		)
			.bind(otherInvoice.id)
			.first<{ payment_url: string; is_test: number; hash_algorithm: string }>();
		expect(details).toEqual({ payment_url: paymentUrl, is_test: 0, hash_algorithm: 'sha256' });
		expect(new URL(paymentUrl).searchParams.has('IsTest')).toBe(false);
	});

	it('rejects unsupported or inconsistent invoices', async () => {
		const client = processor(context);
		await expect(client.createInvoice({ ...invoice, id: 'abc' })).rejects.toThrow(
			'positive safe integer'
		);

		await expect(client.createInvoice({ ...invoice, amountMinor: 1001 })).rejects.toThrow(
			'missing, changed'
		);
		await expect(client.createInvoice({ ...invoice, id: '43' })).rejects.toThrow(
			'missing, changed'
		);
	});

	it('cancels locally and accepts a later verified payment', async () => {
		const client = processor(context);
		await expect(client.cancelInvoice(invoice)).resolves.toEqual({ ok: true, cause: undefined });
		await expect(client.cancelInvoice(invoice)).resolves.toEqual({ ok: true, cause: undefined });
		await expect(invoiceState(context)).resolves.toMatchObject({
			status: 'cancelled',
			paid_at: null
		});
		await expect(client.createInvoice(invoice)).rejects.toThrow('no longer open');
		const response = await client.handleWebhook(resultRequest());
		expect(response.status).toBe(200);
		await expect(response.text()).resolves.toBe('OK42');
		await expect(invoiceState(context)).resolves.toMatchObject({
			status: 'paid',
			paid_at: expect.any(Number)
		});
		const cancelled = await client.cancelInvoice(invoice);
		expect(cancelled.ok).toBe(false);
		expect(cancelled.cause?.message).toBe('Robokassa invoice cannot be cancelled');
	});

	it('acknowledges duplicate notifications without changing the payment time', async () => {
		const client = processor(context);
		const first = await client.handleWebhook(
			resultRequest('825.000000', {
				Fee: '0.30',
				EMail: 'payer@example.com',
				PaymentMethod: 'BankCard',
				IncCurrLabel: 'BankCard'
			})
		);
		expect(first.status).toBe(200);
		await expect(first.text()).resolves.toBe('OK42');
		const state = await invoiceState(context);
		const details = await invoiceDetails(context);
		expect(details).toMatchObject({
			result_out_sum: '825.000000',
			result_fee: '0.30',
			payer_email: 'payer@example.com',
			payment_method: 'BankCard',
			inc_curr_label: 'BankCard'
		});
		const second = await client.handleWebhook(
			resultRequest('825.00', { Fee: '0.50', EMail: 'other@example.com' })
		);
		expect(second.status).toBe(200);
		await expect(second.text()).resolves.toBe('OK42');
		await expect(invoiceState(context)).resolves.toEqual(state);
		await expect(invoiceDetails(context)).resolves.toEqual(details);
	});

	it('stores absent optional notification fields as null', async () => {
		const response = await processor(context).handleWebhook(resultRequest());
		expect(response.status).toBe(200);
		await expect(invoiceDetails(context)).resolves.toMatchObject({
			result_out_sum: '825.00',
			result_fee: null,
			payer_email: null,
			payment_method: null,
			inc_curr_label: null
		});
	});

	it.each([
		['bad signature', '825.00', { SignatureValue: '0'.repeat(32) }],
		['amount mismatch', '825.01', {}],
		['sub-kopeck amount', '825.001', {}],
		['malformed amount', '1e1', {}],
		['unknown invoice', '825.00', { InvId: '43' }]
	])('rejects %s without marking the invoice paid', async (_label, outSum, fields) => {
		const response = await processor(context).handleWebhook(resultRequest(outSum, fields));
		expect(response.status).toBe(400);
		await expect(invoiceState(context)).resolves.toMatchObject({ status: 'open', paid_at: null });
		await expect(invoiceDetails(context)).resolves.toMatchObject({ result_out_sum: null });
	});

	it.each(['&OutSum=825.00', '&extra=' + 'a'.repeat(16384), '&%4FutSum=825.00'])(
		'rejects duplicate or oversized query %s',
		async (suffix) => {
			const result = await processor(context).handleWebhook(
				new Request(resultRequest().url + suffix)
			);
			expect(result.status).toBe(400);
			expect(result.headers.get('cache-control')).toBe('no-store');
			await expect(invoiceState(context)).resolves.toMatchObject({ status: 'open' });
		}
	);
	it.each(['HEAD', 'POST'])('rejects %s without settling', async (method) => {
		expect(
			(await processor(context).handleWebhook(new Request(resultRequest().url, { method }))).status
		).toBe(405);
		await expect(invoiceState(context)).resolves.toMatchObject({ status: 'open' });
	});

	it('does not acknowledge a payment without invoice details', async () => {
		await context.env.DB.prepare('DELETE FROM robokassa_invoice_details WHERE invoice_id = ?')
			.bind(invoice.id)
			.run();
		const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			const response = await processor(context).handleWebhook(resultRequest());
			expect(response.status).toBe(500);
			await expect(invoiceState(context)).resolves.toMatchObject({ status: 'open', paid_at: null });
			await expect(invoiceDetails(context)).resolves.toBeNull();
		} finally {
			errorLog.mockRestore();
		}
	});

	it('rolls back payment status when saving notification details fails', async () => {
		await context.env.DB.prepare(
			`CREATE TRIGGER reject_result_details BEFORE UPDATE ON robokassa_invoice_details
			 BEGIN SELECT RAISE(ABORT, 'detail write failed'); END`
		).run();
		const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			const response = await processor(context).handleWebhook(resultRequest());
			expect(response.status).toBe(500);
			await expect(invoiceState(context)).resolves.toMatchObject({ status: 'open', paid_at: null });
			await expect(invoiceDetails(context)).resolves.toMatchObject({ result_out_sum: null });
		} finally {
			errorLog.mockRestore();
		}
	});

	it('returns a retryable error when the database is unavailable', async () => {
		const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			const withoutDb = { env: credentials } as App.Platform;
			const response = await createRobokassaClient(withoutDb).handleWebhook(resultRequest());
			expect(response.status).toBe(500);
			expect(errorLog).toHaveBeenCalledWith('Robokassa webhook processing failed', {
				invoiceId: '42',
				errorType: 'Error'
			});
		} finally {
			errorLog.mockRestore();
		}
	});
	it('reuses a stored quote when rates and credentials are unavailable', async () => {
		rateFetch.mockRejectedValue(new Error('offline'));
		const changed = {
			env: { DB: context.env.DB, ROBOKASSA_IS_TEST: 'invalid', ROBOKASSA_HASH_ALGORITHM: 'invalid' }
		} as App.Platform;
		const before = await invoiceDetails(context);
		await expect(processor(changed).createInvoice(invoice)).resolves.toEqual({
			url: before?.payment_url
		});
		expect(rateFetch).toHaveBeenCalledTimes(1);
	});

	it('surfaces a failed rate fetch without storing a quote, then retries', async () => {
		const next = { ...invoice, id: '43' };
		await insertInvoice(context, next);
		rateFetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
		const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			await expect(processor(context).createInvoice(next)).rejects.toThrow(
				'Exchange rate unavailable'
			);
			expect(
				await context.env.DB.prepare(
					"SELECT * FROM robokassa_invoice_details WHERE invoice_id = '43'"
				).first()
			).toBeNull();
			const url = await processor(context).createInvoice(next);
			expect(new URL(url.url).searchParams.get('OutSum')).toBe('825.00');
		} finally {
			log.mockRestore();
		}
	});

	it('stores the first winning quote for concurrent checkout candidates', async () => {
		const next = { ...invoice, id: '43' };
		await insertInvoice(context, next);
		const pending: ((value: Response) => void)[] = [];
		rateFetch.mockImplementation(() => new Promise<Response>((resolve) => pending.push(resolve)));
		const first = processor(context).createInvoice(next);
		const second = processor(context).createInvoice(next);
		await vi.waitFor(() => expect(pending).toHaveLength(2));
		pending[1](Response.json({ Date: '2026-10-14', Valute: { USD: { Value: 90, Nominal: 1 } } }));
		const winner = await second;
		pending[0](Response.json({ Date: '2026-10-15', Valute: { USD: { Value: 100, Nominal: 1 } } }));
		await expect(first).resolves.toEqual(winner);
		expect(
			await context.env.DB.prepare(
				"SELECT rub_amount_minor, rub_per_usd FROM robokassa_invoice_details WHERE invoice_id = '43'"
			).first()
		).toEqual({ rub_amount_minor: 90000, rub_per_usd: '90' });
	});

	it.each([
		'amount_minor = 1001',
		"user_id = 'other'",
		"payment_processor = 'other'",
		"status = 'cancelled'"
	])('rejects changed terms during the rate request: %s', async (assignment) => {
		const next = { ...invoice, id: '43' };
		await insertInvoice(context, next);
		await context.env.DB.prepare(
			"INSERT INTO users (id, pubkey, created_at) VALUES ('other', 'other', 1)"
		).run();
		rateFetch.mockImplementationOnce(async () => {
			await context.env.DB.prepare(`UPDATE invoices SET ${assignment} WHERE id = '43'`).run();
			return Response.json({ Date: '2026-10-14', Valute: { USD: { Value: 82.5, Nominal: 1 } } });
		});
		await expect(processor(context).createInvoice(next)).rejects.toThrow(
			'missing, changed, or no longer open'
		);
		expect(
			await context.env.DB.prepare(
				"SELECT * FROM robokassa_invoice_details WHERE invoice_id = '43'"
			).first()
		).toBeNull();
	});

	it('credits USD cents once for concurrent duplicate and separate invoices belonging to the same owner', async () => {
		const next = { ...invoice, id: '43', amountMinor: 1 };
		await insertInvoice(context, next);
		const url = await processor(context).createInvoice(next);
		expect(new URL(url.url).searchParams.get('OutSum')).toBe('0.83');
		rateFetch.mockClear();
		const responses = await Promise.all([
			processor(context).handleWebhook(resultRequest()),
			processor(context).handleWebhook(resultRequest()),
			processor(context).handleWebhook(resultRequest('0.83', { InvId: '43' })),
			processor(context).handleWebhook(resultRequest('0.83', { InvId: '43' }))
		]);
		expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200]);
		expect(
			await context.env.DB.prepare(
				`SELECT i.id, i.amount_minor, l.amount, l.user_id, l.entry_side, l.reason
   FROM invoices i JOIN ledger_entries l ON l.id = i.ledger_entry_id ORDER BY i.id`
			).all()
		).toMatchObject({
			results: [
				{
					id: '42',
					amount_minor: 1000,
					amount: 1000,
					user_id: 'owner',
					entry_side: 'credit',
					reason: 'top-up'
				},
				{
					id: '43',
					amount_minor: 1,
					amount: 1,
					user_id: 'owner',
					entry_side: 'credit',
					reason: 'top-up'
				}
			]
		});
		expect(
			await context.env.DB.prepare('SELECT COUNT(*) AS count FROM ledger_entries').first('count')
		).toBe(2);
		expect(rateFetch).not.toHaveBeenCalled();
	});

	it.each([1, 0, null])(
		'funding preserves approval %s and the provider wallet',
		async (enabled) => {
			if (enabled !== null)
				await context.env.DB.prepare("INSERT INTO credits (user_id, enabled) VALUES ('owner', ?)")
					.bind(enabled)
					.run();
			const wallet = await context.env.DB.prepare('SELECT * FROM balances').all();
			expect(
				(await processor(context).handleWebhook(resultRequest('825.00', { Fee: '100' }))).status
			).toBe(200);
			expect(await context.env.DB.prepare('SELECT * FROM credits').all()).toMatchObject({
				results: enabled === null ? [] : [{ user_id: 'owner', enabled }]
			});
			expect(
				await context.env.DB.prepare('SELECT amount FROM ledger_entries').first('amount')
			).toBe(1000);
			expect(await context.env.DB.prepare('SELECT * FROM balances').all()).toEqual(wallet);
		}
	);

	it.each([
		['ledger', 'BEFORE INSERT ON ledger_entries'],
		['link', 'BEFORE UPDATE ON invoices'],
		['metadata', 'BEFORE UPDATE ON robokassa_invoice_details']
	])('rolls back %s failures completely and settles on retry', async (_name, trigger) => {
		await context.env.DB.prepare(
			`CREATE TRIGGER settlement_failure ${trigger} BEGIN SELECT RAISE(ABORT, 'injected failure'); END`
		).run();
		const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			const response = await processor(context).handleWebhook(resultRequest());
			expect(response.status).toBe(500);
			expect(response.headers.get('cache-control')).toBe('no-store');
			expect(await context.env.DB.prepare('SELECT * FROM ledger_entries').all()).toMatchObject({
				results: []
			});
			await expect(invoiceState(context)).resolves.toMatchObject({ status: 'open', paid_at: null });
			await expect(invoiceDetails(context)).resolves.toMatchObject({ result_out_sum: null });
			await context.env.DB.prepare('DROP TRIGGER settlement_failure').run();
			expect((await processor(context).handleWebhook(resultRequest())).status).toBe(200);
			expect(
				await context.env.DB.prepare('SELECT COUNT(*) AS count FROM ledger_entries').first('count')
			).toBe(1);
		} finally {
			log.mockRestore();
		}
	});

	it.each(['false', 'invalid'])(
		'verifies saved settings after deployment defaults become %s',
		async (mode) => {
			const changed = {
				env: { ...context.env, ROBOKASSA_IS_TEST: mode, ROBOKASSA_HASH_ALGORITHM: 'sha512' }
			} as App.Platform;
			expect(
				(await processor(changed).handleWebhook(resultRequest('825.00', { IsTest: '0' }))).status
			).toBe(200);
		}
	);

	it('uses saved production password and sha256 despite changed defaults and a forged test flag', async () => {
		const next = { ...invoice, id: '43' };
		await insertInvoice(context, next);
		const production = {
			env: { ...context.env, ROBOKASSA_IS_TEST: 'false', ROBOKASSA_HASH_ALGORITHM: 'sha256' }
		} as App.Platform;
		await processor(production).createInvoice(next);
		const signature = createHash('sha256').update('825.00:43:production-two').digest('hex');
		const response = await processor(context).handleWebhook(
			resultRequest('825.00', { InvId: '43', IsTest: '1', SignatureValue: signature })
		);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe('OK43');
	});

	it.each(['InvId', 'OutSum', 'SignatureValue'])('rejects missing %s', async (key) => {
		const url = new URL(resultRequest().url);
		url.searchParams.delete(key);
		expect((await processor(context).handleWebhook(new Request(url))).status).toBe(400);
	});
	it.each(['0', '01', '-1', '1.5', '9007199254740992', 'abc'])(
		'rejects malformed invoice ID %s',
		async (InvId) => {
			expect(
				(await processor(context).handleWebhook(resultRequest('825.00', { InvId }))).status
			).toBe(400);
		}
	);
	it.each([0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])(
		'rejects invalid USD cents %s',
		async (amountMinor) => {
			await expect(processor(context).createInvoice({ ...invoice, amountMinor })).rejects.toThrow(
				'USD cents'
			);
		}
	);
	it.each([
		'ROBOKASSA_LOGIN',
		'ROBOKASSA_PASSWORD1',
		'ROBOKASSA_PASSWORD2',
		'ROBOKASSA_TEST_PASSWORD1',
		'ROBOKASSA_TEST_PASSWORD2'
	])('surfaces missing %s as a retryable webhook error', async (name) => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			const changed = { env: { ...context.env, [name]: '' } } as App.Platform;
			const result = await processor(changed).handleWebhook(resultRequest());
			expect(result.status).toBe(500);
			expect(result.headers.get('cache-control')).toBe('no-store');
			expect(await context.env.DB.prepare('SELECT * FROM ledger_entries').all()).toMatchObject({
				results: []
			});
		} finally {
			log.mockRestore();
		}
	});
	it.each([{ ROBOKASSA_IS_TEST: '1' }, { ROBOKASSA_HASH_ALGORITHM: 'sha1' }])(
		'rejects invalid new-checkout settings %j',
		async (settings) => {
			const next = { ...invoice, id: '43' };
			await insertInvoice(context, next);
			await expect(
				processor({ env: { ...context.env, ...settings } } as App.Platform).createInvoice(next)
			).rejects.toThrow('must be');
		}
	);
});
