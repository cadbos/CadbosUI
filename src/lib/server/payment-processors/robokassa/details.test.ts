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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RobokassaError } from '@robokassa/sdk';
import { getOperationDetails } from './operation';

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

const context = { env: credentials } as App.Platform;
const settings = { is_test: 0, hash_algorithm: 'md5' as const };

describe('Robokassa operation-response normalization', () => {
	const fetcher = vi.fn<typeof fetch>();
	beforeEach(() => {
		fetcher.mockReset();
	});

	it('normalizes complete operation fields', async () => {
		fetcher.mockResolvedValue(new Response(operationXml));
		const operation = await getOperationDetails(context, fetcher, 42, settings);
		expect(operation).toEqual({
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
	});

	it('normalizes operation not found', async () => {
		fetcher.mockResolvedValue(
			new Response(
				'<OperationStateResponse><Result><Code>3</Code></Result></OperationStateResponse>'
			)
		);
		await expect(getOperationDetails(context, fetcher, 42, settings)).resolves.toEqual({
			status: 'not-found'
		});
	});

	it.each([1, 2, 4, 1000, 9999])(
		'surfaces provider result code %s with sanitized diagnostics',
		async (code) => {
			fetcher.mockResolvedValue(
				new Response(
					`<OperationStateResponse><Result><Code>${code}</Code><Description>private-provider-data</Description></Result></OperationStateResponse>`
				)
			);
			await expect(getOperationDetails(context, fetcher, 42, settings)).rejects.toMatchObject({
				code: 'API_ERROR',
				message: `Robokassa operation lookup failed (result code ${code})`,
				operation: 'webService.opState',
				responseBody: undefined,
				cause: undefined
			});
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
		fetcher.mockResolvedValue(new Response(xml));
		await expect(getOperationDetails(context, fetcher, 42, settings)).rejects.toMatchObject({
			code: 'PARSE_ERROR',
			responseBody: undefined,
			cause: undefined
		});
	});

	it('accepts an operation state without optional provider fields', async () => {
		fetcher.mockResolvedValue(
			new Response(
				'<OperationStateResponse><Result><Code>0</Code></Result><State><Code>5</Code></State></OperationStateResponse>'
			)
		);
		const details = await getOperationDetails(context, fetcher, 42, settings);
		expect(details).toEqual({
			status: 'available',
			details: { Result: { Code: 0 }, State: { Code: 5 } }
		});
	});

	it.each(['http', 'network', 'timeout', 'http-5xx'] as const)(
		'surfaces %s failures without raw responses or transport causes',
		async (failure) => {
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
			await expect(getOperationDetails(context, fetcher, 42, settings)).rejects.toMatchObject({
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
		}
	);
});
