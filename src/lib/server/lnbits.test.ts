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

import { describe, expect, it, vi } from 'vitest';
import {
	findLnbitsInvoiceByAttempt,
	getLnbitsUsdPerBtc,
	lookupLnbitsPayment,
	type LnbitsFetch
} from './lnbits';

const config = { baseUrl: 'https://lnbits.example.test', invoiceKey: 'invoice-key' };
const paymentHash = 'a'.repeat(64);
const recoveryPaymentHash = 'f5636521e98000697a6700b979c288ddad56cb3995a2eb07550872c466ccc3e5';
const recoveryBolt11 =
	'lnbc20u1p3y0x3hpp5743k2g0fsqqxj7n8qzuhns5gmkk4djeejk3wkp64ppevgekvc0jsdqcve5kzar2v9nr5gpqd4hkuetesp5ez2g297jduwc20t6lmqlsg3man0vf2jfd8ar9fh8fhn2g8yttfkqxqy9gcqcqzys9qrsgqrzjqtx3k77yrrav9hye7zar2rtqlfkytl094dsp0ms5majzth6gt7ca6uhdkxl983uywgqqqqlgqqqvx5qqjqrzjqd98kxkpyw0l9tyy8r8q57k7zpy9zjmh6sez752wj6gcumqnj3yxzhdsmg6qq56utgqqqqqqqqqqqeqqjq7jd56882gtxhrjm03c93aacyfy306m4fq0tskf83c0nmet8zc2lxyyg3saz8x6vwcp26xnrlagf9semau3qm2glysp7sv95693fphvsp54l567';

function listedPayment(
	time: number,
	overrides: Record<string, unknown> = {}
): Record<string, unknown> {
	return {
		checking_id: 'listed-checking',
		bolt11: recoveryBolt11,
		amount: 2_000_000,
		status: 'pending',
		time,
		extra: {},
		...overrides
	};
}

function requestUrl(input: Parameters<LnbitsFetch>[0]): URL {
	return new URL(input instanceof Request ? input.url : input);
}

function paymentResponse(overrides: Record<string, unknown> = {}): Response {
	return Response.json({
		paid: true,
		details: {
			checking_id: 'checking-1',
			payment_hash: paymentHash,
			amount: 1_200_000,
			status: 'success',
			...overrides
		}
	});
}

describe('LNbits client', () => {
	it('stops after reaching payments older than the attempt while retaining same-second records', async () => {
		const attemptCreatedAt = 1_800_000_000_900;
		const request = vi
			.fn<LnbitsFetch>()
			.mockResolvedValueOnce(
				Response.json(Array.from({ length: 100 }, () => listedPayment(1_800_000_000)))
			)
			.mockResolvedValueOnce(
				Response.json(Array.from({ length: 100 }, () => listedPayment(1_799_999_999)))
			);

		await expect(
			findLnbitsInvoiceByAttempt(config, 'attempt-1', attemptCreatedAt, request)
		).resolves.toBeNull();
		expect(request).toHaveBeenCalledTimes(2);
	});

	it('stops after 2,000 listed payments and requests descending timestamp order', async () => {
		const request = vi
			.fn<LnbitsFetch>()
			.mockImplementation(async () =>
				Response.json(Array.from({ length: 100 }, () => listedPayment(1_800_000_001)))
			);

		await expect(
			findLnbitsInvoiceByAttempt(config, 'attempt-1', 1_800_000_000_000, request)
		).resolves.toBeNull();
		expect(request).toHaveBeenCalledTimes(20);
		expect(request.mock.calls.map(([url]) => requestUrl(url).searchParams.get('offset'))).toEqual(
			Array.from({ length: 20 }, (_, index) => String(index * 100))
		);
		for (const [url] of request.mock.calls) {
			const search = requestUrl(url).searchParams;
			expect(search.get('limit')).toBe('100');
			expect(search.get('sortby')).toBe('time');
			expect(search.get('direction')).toBe('desc');
		}
	});

	it('returns a matching invoice from the final permitted page', async () => {
		const request = vi.fn<LnbitsFetch>().mockImplementation(async (url) => {
			const offset = requestUrl(url).searchParams.get('offset');
			const payments = Array.from({ length: 100 }, () => listedPayment(1_800_000_001));
			if (offset === '1900') {
				payments[99] = listedPayment(1_800_000_001, {
					checking_id: 'recovered-checking',
					payment_hash: recoveryPaymentHash,
					extra: { cadbos_attempt_id: 'attempt-1' }
				});
			}
			return Response.json(payments);
		});

		await expect(
			findLnbitsInvoiceByAttempt(config, 'attempt-1', 1_800_000_000_000, request)
		).resolves.toEqual({
			checkingId: 'recovered-checking',
			paymentHash: recoveryPaymentHash,
			bolt11: recoveryBolt11,
			satsAmount: 2_000
		});
		expect(request).toHaveBeenCalledTimes(20);
	});

	it('looks up the official status endpoint by payment hash and validates a paid response', async () => {
		const request = vi.fn<LnbitsFetch>().mockResolvedValue(paymentResponse());

		await expect(lookupLnbitsPayment(config, paymentHash, request)).resolves.toEqual({
			checkingId: 'checking-1',
			paymentHash,
			state: 'paid',
			satsAmount: 1_200,
			paid: true,
			status: 'success'
		});
		expect(request).toHaveBeenCalledWith(
			new URL(`https://lnbits.example.test/api/v1/payments/${paymentHash}`),
			expect.objectContaining({ headers: expect.objectContaining({ 'X-Api-Key': 'invoice-key' }) })
		);
	});

	it.each(['http://lnbits.example.test', 'ftp://lnbits.example.test'])(
		'rejects a non-HTTPS endpoint before requesting %s',
		async (baseUrl) => {
			const request = vi.fn<LnbitsFetch>();

			await expect(getLnbitsUsdPerBtc({ ...config, baseUrl }, request)).rejects.toMatchObject({
				name: 'LnbitsError'
			});
			expect(request).not.toHaveBeenCalled();
		}
	);

	it.each([
		[true, 'pending'],
		[true, 'failed'],
		[false, 'success']
	] as const)('rejects contradictory paid=%s and status=%s fields', async (paid, status) => {
		const request = vi.fn<LnbitsFetch>().mockResolvedValue(
			Response.json({
				paid,
				details: {
					checking_id: 'checking-1',
					payment_hash: paymentHash,
					amount: 1_200_000,
					status
				}
			})
		);

		await expect(lookupLnbitsPayment(config, paymentHash, request)).rejects.toMatchObject({
			operation: 'lookup_payment',
			outcome: 'explicit_failure'
		});
	});

	it('rejects mismatched identities, malformed data, and invalid amounts', async () => {
		const mismatched = vi
			.fn<LnbitsFetch>()
			.mockResolvedValue(paymentResponse({ payment_hash: 'b'.repeat(64) }));
		await expect(lookupLnbitsPayment(config, paymentHash, mismatched)).rejects.toMatchObject({
			outcome: 'explicit_failure'
		});

		const malformed = vi.fn<LnbitsFetch>().mockResolvedValue(Response.json({ paid: true }));
		await expect(lookupLnbitsPayment(config, paymentHash, malformed)).rejects.toMatchObject({
			outcome: 'explicit_failure'
		});

		const invalidAmount = vi
			.fn<LnbitsFetch>()
			.mockResolvedValue(paymentResponse({ amount: 1_200_001 }));
		await expect(lookupLnbitsPayment(config, paymentHash, invalidAmount)).rejects.toMatchObject({
			outcome: 'explicit_failure'
		});
	});

	it('accepts the current exchange-rate response and rejects malformed data', async () => {
		const valid = vi
			.fn<LnbitsFetch>()
			.mockResolvedValue(Response.json({ rate: 100_000, price: 0.00001 }));
		await expect(getLnbitsUsdPerBtc(config, valid)).resolves.toBe(100_000);

		const malformed = vi.fn<LnbitsFetch>().mockResolvedValue(Response.json({ rate: '100000' }));
		await expect(getLnbitsUsdPerBtc(config, malformed)).rejects.toMatchObject({
			operation: 'exchange_rate',
			outcome: 'ambiguous'
		});
	});

	it('classifies timeouts and server errors as ambiguous, and client rejection as explicit', async () => {
		const timeout = vi
			.fn<LnbitsFetch>()
			.mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
		await expect(getLnbitsUsdPerBtc(config, timeout)).rejects.toMatchObject({
			operation: 'exchange_rate',
			outcome: 'ambiguous'
		});

		const serverError = vi.fn<LnbitsFetch>().mockResolvedValue(new Response(null, { status: 503 }));
		await expect(getLnbitsUsdPerBtc(config, serverError)).rejects.toMatchObject({
			outcome: 'ambiguous'
		});

		const clientError = vi.fn<LnbitsFetch>().mockResolvedValue(new Response(null, { status: 400 }));
		await expect(getLnbitsUsdPerBtc(config, clientError)).rejects.toMatchObject({
			outcome: 'explicit_failure'
		});
	});
});
