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
import { getLnbitsUsdPerBtc, lookupLnbitsPayment, type LnbitsFetch } from './lnbits';

const config = { baseUrl: 'https://lnbits.example.test', invoiceKey: 'invoice-key' };
const paymentHash = 'a'.repeat(64);

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
