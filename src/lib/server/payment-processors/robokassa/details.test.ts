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
import { RobokassaError, type HashAlgorithm } from '@robokassa/sdk';

import { closeD1, makeD1 } from '$lib/server/testing/d1-shim';
import { createRobokassaClient } from './client';
import { handleRobokassaResult } from './result';

const invoice = {
	id: '00000000-0000-4000-8000-000000000042',
	amountMinor: 1000,
	currency: 'USD' as const
};
const credentials = {
	ROBOKASSA_LOGIN: 'demo-shop',
	ROBOKASSA_PASSWORD1: 'production-one',
	ROBOKASSA_PASSWORD2: 'production-two',
	ROBOKASSA_TEST_PASSWORD1: 'test-one',
	ROBOKASSA_TEST_PASSWORD2: 'test-two'
};
const operationXml = `<OperationStateResponse>
	<Result><Code>0</Code></Result>
	<State><Code>100</Code><RequestDate>2026-10-19T12:00:00+03:00</RequestDate><StateDate>2026-10-19T11:00:00+03:00</StateDate></State>
	<Info><IncCurrLabel>BankCard</IncCurrLabel><IncSum>825.25</IncSum><IncAccount>account</IncAccount>
	<PaymentMethod><Code>1</Code><Description>Card</Description></PaymentMethod>
	<OutCurrLabel>RUB</OutCurrLabel><OutSum>825.00</OutSum><OpKey>operation-key</OpKey><BankCardRRN>123456789</BankCardRRN></Info>
	<UserFields><Field><Name>order</Name><Value>room</Value></Field></UserFields>
</OperationStateResponse>`;

function resultRequest(fields: Record<string, string> = {}, production = false): Request {
	const signature = createHash('md5')
		.update(
			`825.00:42:${production ? credentials.ROBOKASSA_PASSWORD2 : credentials.ROBOKASSA_TEST_PASSWORD2}`
		)
		.digest('hex');
	return new Request(
		`https://app.example/api/robokassa/result?${new URLSearchParams({
			InvId: '42',
			OutSum: '825.00',
			SignatureValue: signature,
			...fields
		})}`
	);
}

async function snapshot(context: App.Platform): Promise<unknown[]> {
	return Promise.all([
		context.env.DB.prepare('SELECT * FROM invoices ORDER BY id').all(),
		context.env.DB.prepare('SELECT * FROM robokassa_invoice_details ORDER BY invoice_id').all(),
		context.env.DB.prepare('SELECT * FROM ledger_entries ORDER BY id').all(),
		context.env.DB.prepare('SELECT * FROM credits ORDER BY user_id').all(),
		context.env.DB.prepare('SELECT * FROM balances').all()
	]);
}

describe('Robokassa invoice details', () => {
	let context: App.Platform;
	const fetcher = vi.fn<typeof fetch>();

	beforeEach(async () => {
		let nextInvId = 42;
		vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
			if (array instanceof Uint32Array) array.set([0, nextInvId++]);
			return array;
		});
		context = { env: { ...credentials, DB: makeD1() } } as App.Platform;
		fetcher.mockReset().mockImplementation(async () =>
			Response.json({
				Date: '2026-10-14T00:00:00.000Z',
				Valute: { USD: { Value: 82.5, Nominal: 1 } }
			})
		);
		await context.env.DB.prepare(
			"INSERT INTO users (id, pubkey, created_at) VALUES ('owner', 'pubkey', 1)"
		).run();
		await context.env.DB.prepare(
			`INSERT INTO invoices
			(id, payment_processor, user_id, amount_minor, currency, created_at, updated_at)
			VALUES ('00000000-0000-4000-8000-000000000042', 'robokassa', 'owner', 1000, 'USD', 10, 20)`
		).run();
	});

	afterEach(() => {
		closeD1(context.env.DB);
		vi.restoreAllMocks();
	});

	async function quote(production = false, hash: HashAlgorithm = 'md5'): Promise<string> {
		context = {
			env: {
				...context.env,
				ROBOKASSA_IS_TEST: production ? 'false' : 'true',
				ROBOKASSA_HASH_ALGORITHM: hash
			}
		} as App.Platform;
		const { url } = await createRobokassaClient(context, fetcher).createInvoice(invoice);
		fetcher.mockClear();
		return url;
	}

	it('returns a complete unquoted invoice without requiring credentials or making a request', async () => {
		const client = createRobokassaClient({ env: { DB: context.env.DB } } as App.Platform, fetcher);
		expect('handleWebhook' in client).toBe(false);
		await expect(client.getInvoiceDetails('00000000-0000-4000-8000-000000000042')).resolves.toEqual(
			{
				...invoice,
				paymentProcessor: 'robokassa',
				userId: 'owner',
				ledgerEntryId: null,
				status: 'open',
				createdAt: 10,
				updatedAt: 20,
				paidAt: null,
				processorData: { quote: null, notification: null, operation: { status: 'not-quoted' } }
			}
		);
		expect(fetcher).not.toHaveBeenCalled();
	});

	it.each(['open', 'cancelled', 'paid'] as const)(
		'maps every stored field for a quoted %s invoice',
		async (status) => {
			const url = await quote();
			const client = createRobokassaClient(context, fetcher);
			if (status === 'cancelled') expect((await client.cancelInvoice(invoice)).ok).toBe(true);
			if (status === 'paid')
				expect((await handleRobokassaResult(context, resultRequest())).status).toBe(200);
			const row = await context.env.DB.prepare('SELECT * FROM invoices WHERE id = ?')
				.bind('00000000-0000-4000-8000-000000000042')
				.first();
			expect(row).not.toBeNull();
			const before = await snapshot(context);
			const noCredentials = {
				env: { DB: context.env.DB, ROBOKASSA_IS_TEST: 'false' }
			} as App.Platform;
			await expect(
				createRobokassaClient(noCredentials, fetcher).getInvoiceDetails(
					'00000000-0000-4000-8000-000000000042'
				)
			).resolves.toEqual({
				...invoice,
				paymentProcessor: 'robokassa',
				userId: 'owner',
				ledgerEntryId: row?.ledger_entry_id,
				status,
				createdAt: 10,
				updatedAt: row?.updated_at,
				paidAt: row?.paid_at,
				processorData: {
					quote: {
						invId: '42',
						paymentUrl: url,
						rubAmountMinor: 82500,
						rubPerUsd: '82.5',
						rateAsOf: Date.parse('2026-10-14T00:00:00.000Z'),
						isTest: true,
						hashAlgorithm: 'md5'
					},
					notification:
						status === 'paid'
							? {
									outSum: '825.00',
									fee: null,
									payerEmail: null,
									paymentMethod: null,
									incCurrLabel: null
								}
							: null,
					operation: { status: 'unavailable-for-test' }
				}
			});
			expect(fetcher).not.toHaveBeenCalled();
			expect(await snapshot(context)).toEqual(before);
		}
	);

	it('maps optional notification metadata without treating it as live provider data', async () => {
		await quote();
		expect(
			(
				await handleRobokassaResult(
					context,
					resultRequest({
						Fee: '0.30',
						EMail: 'payer@example.com',
						PaymentMethod: 'BankCard',
						IncCurrLabel: 'RUB'
					})
				)
			).status
		).toBe(200);
		const details = await createRobokassaClient(context, fetcher).getInvoiceDetails(
			'00000000-0000-4000-8000-000000000042'
		);
		expect(details.processorData.notification).toEqual({
			outSum: '825.00',
			fee: '0.30',
			payerEmail: 'payer@example.com',
			paymentMethod: 'BankCard',
			incCurrLabel: 'RUB'
		});
		expect(fetcher).not.toHaveBeenCalled();
	});

	it.each(['md5', 'sha256', 'sha512'] as const)(
		'signs production lookup with saved %s and production Password 2',
		async (hash) => {
			await quote(true, hash);
			context = {
				env: { ...context.env, ROBOKASSA_IS_TEST: 'invalid', ROBOKASSA_HASH_ALGORITHM: 'invalid' }
			} as App.Platform;
			fetcher.mockResolvedValue(new Response(operationXml));
			const before = await snapshot(context);
			const details = await createRobokassaClient(context, fetcher).getInvoiceDetails(
				'00000000-0000-4000-8000-000000000042'
			);
			expect(fetcher).toHaveBeenCalledTimes(1);
			const [input, init] = fetcher.mock.calls[0];
			const url = new URL(String(input));
			expect(url.origin + url.pathname).toBe(
				'https://auth.robokassa.ru/Merchant/WebService/Service.asmx/OpStateExt'
			);
			expect(Object.fromEntries(url.searchParams)).toEqual({
				MerchantLogin: 'demo-shop',
				InvoiceID: '42',
				Signature: createHash(hash).update('demo-shop:42:production-two').digest('hex')
			});
			expect(init?.method).toBe('GET');
			expect(details.status).toBe('open');
			expect(details.ledgerEntryId).toBeNull();
			expect(details.processorData.operation).toEqual({
				status: 'available',
				details: {
					Result: { Code: 0 },
					State: {
						Code: 100,
						RequestDate: '2026-10-19T12:00:00+03:00',
						StateDate: '2026-10-19T11:00:00+03:00'
					},
					Info: {
						IncCurrLabel: 'BankCard',
						IncSum: '825.25',
						IncAccount: 'account',
						PaymentMethod: { Code: '1', Description: 'Card' },
						OutCurrLabel: 'RUB',
						OutSum: '825',
						OpKey: 'operation-key',
						BankCardRRN: '123456789'
					},
					UserFields: { Field: { Name: 'order', Value: 'room' } }
				}
			});
			expect(details.processorData.notification).toBeNull();
			expect(await snapshot(context)).toEqual(before);
		}
	);

	it.each(['cancelled', 'paid'] as const)(
		'preserves %s history when provider status disagrees',
		async (status) => {
			await quote(true);
			if (status === 'cancelled')
				expect((await createRobokassaClient(context, fetcher).cancelInvoice(invoice)).ok).toBe(
					true
				);
			else
				expect(
					(await handleRobokassaResult(context, resultRequest({ Fee: '0.30' }, true))).status
				).toBe(200);
			fetcher.mockResolvedValue(
				new Response(
					operationXml.replace('<Code>100</Code>', `<Code>${status === 'paid' ? 10 : 100}</Code>`)
				)
			);
			const before = await snapshot(context);
			const details = await createRobokassaClient(context, fetcher).getInvoiceDetails(
				'00000000-0000-4000-8000-000000000042'
			);
			expect(details.status).toBe(status);
			expect(details.processorData.operation).toMatchObject({
				status: 'available',
				details: { State: { Code: status === 'paid' ? 10 : 100 } }
			});
			expect(await snapshot(context)).toEqual(before);
		}
	);

	it('reports operation not found as an observation without changing local state', async () => {
		await quote(true);
		fetcher.mockResolvedValue(
			new Response(
				'<OperationStateResponse><Result><Code>3</Code><Description>Operation not found</Description></Result></OperationStateResponse>'
			)
		);
		const before = await snapshot(context);
		const details = await createRobokassaClient(context, fetcher).getInvoiceDetails(
			'00000000-0000-4000-8000-000000000042'
		);
		expect(details.status).toBe('open');
		expect(details.processorData.quote).not.toBeNull();
		expect(details.processorData.operation).toEqual({ status: 'not-found' });
		expect(await snapshot(context)).toEqual(before);
	});

	it.each([1, 2, 4, 1000, 9999])(
		'surfaces provider result code %s with sanitized diagnostics',
		async (code) => {
			await quote(true);
			fetcher.mockResolvedValue(
				new Response(
					`<OperationStateResponse><Result><Code>${code}</Code><Description>private-provider-data</Description></Result></OperationStateResponse>`
				)
			);
			const before = await snapshot(context);
			await expect(
				createRobokassaClient(context, fetcher).getInvoiceDetails(
					'00000000-0000-4000-8000-000000000042'
				)
			).rejects.toMatchObject({
				code: 'API_ERROR',
				message: `Robokassa operation lookup failed (result code ${code})`,
				operation: 'webService.opState',
				responseBody: undefined,
				cause: undefined
			});
			expect(await snapshot(context)).toEqual(before);
		}
	);

	it.each([
		'not xml',
		'<OperationStateResponse/>',
		'<OperationStateResponse><Result><Code>wrong</Code></Result></OperationStateResponse>',
		'<OperationStateResponse><Result><Code>0</Code></Result></OperationStateResponse>',
		'<OperationStateResponse><Result><Code>0</Code></Result><State><Code>wrong</Code></State></OperationStateResponse>',
		'<OperationStateResponse><Result><Code>0</Code></Result><State><Code>100</Code></State><Info><OutSum><nested>private</nested></OutSum></Info></OperationStateResponse>'
	])('rejects malformed operation responses: %s', async (xml) => {
		await quote(true);
		fetcher.mockResolvedValue(new Response(xml));
		await expect(
			createRobokassaClient(context, fetcher).getInvoiceDetails(
				'00000000-0000-4000-8000-000000000042'
			)
		).rejects.toMatchObject({ code: 'PARSE_ERROR', responseBody: undefined, cause: undefined });
	});

	it('accepts an operation state without optional provider fields', async () => {
		await quote(true);
		fetcher.mockResolvedValue(
			new Response(
				'<OperationStateResponse><Result><Code>0</Code></Result><State><Code>5</Code></State></OperationStateResponse>'
			)
		);
		const details = await createRobokassaClient(context, fetcher).getInvoiceDetails(
			'00000000-0000-4000-8000-000000000042'
		);
		expect(details.processorData.operation).toEqual({
			status: 'available',
			details: { Result: { Code: 0 }, State: { Code: 5 } }
		});
	});

	it.each(['http', 'network', 'timeout', 'http-5xx'] as const)(
		'surfaces %s failures without raw responses or transport causes',
		async (failure) => {
			await quote(true);
			if (failure === 'http')
				fetcher.mockResolvedValue(new Response('private-provider-data', { status: 401 }));
			if (failure === 'network') fetcher.mockRejectedValue(new Error('private URL and signature'));
			if (failure === 'timeout')
				fetcher.mockRejectedValue(
					new RobokassaError('TIMEOUT', 'private URL and signature', {
						responseBody: 'private-provider-data'
					})
				);
			if (failure === 'http-5xx')
				fetcher.mockResolvedValue(new Response('<private/>', { status: 502 }));
			const before = await snapshot(context);
			await expect(
				createRobokassaClient(context, fetcher).getInvoiceDetails(
					'00000000-0000-4000-8000-000000000042'
				)
			).rejects.toMatchObject({
				code:
					failure === 'network'
						? 'NETWORK_ERROR'
						: failure === 'timeout'
							? 'TIMEOUT'
							: 'HTTP_ERROR',
				message: 'Robokassa operation lookup failed',
				responseBody: undefined,
				cause: undefined,
				...(failure === 'http'
					? { statusCode: 401 }
					: failure === 'http-5xx'
						? { statusCode: 502 }
						: {})
			});
			expect(await snapshot(context)).toEqual(before);
		}
	);

	it.each(['', '0', '01', '-1', '1.5', '9007199254740992', 'abc', '42\n', ' 42', '4.2e1'])(
		'rejects invalid invoice ID %s without a provider request',
		async (id) => {
			await expect(createRobokassaClient(context, fetcher).getInvoiceDetails(id)).rejects.toThrow(
				'UUID'
			);
			expect(fetcher).not.toHaveBeenCalled();
		}
	);

	it.each(['missing', 'another processor'])(
		'rejects a %s invoice without a provider request',
		async (kind) => {
			if (kind === 'another processor')
				await context.env.DB.prepare(
					"UPDATE invoices SET payment_processor = 'other' WHERE id = '00000000-0000-4000-8000-000000000042'"
				).run();
			await expect(
				createRobokassaClient(context, fetcher).getInvoiceDetails(
					kind === 'missing'
						? '00000000-0000-4000-8000-000000000043'
						: '00000000-0000-4000-8000-000000000042'
				)
			).rejects.toThrow('Robokassa invoice not found');
			expect(fetcher).not.toHaveBeenCalled();
		}
	);
});
