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

import { decode } from 'light-bolt11-decoder';
import { z } from 'zod';

const REQUEST_TIMEOUT_MS = 15_000;
const MSATS_PER_SAT = 1000;

const paymentHashSchema = z.string().regex(/^[0-9a-f]{64}$/i);
const createInvoiceResponseSchema = z.looseObject({
	payment_hash: paymentHashSchema,
	payment_request: z.string().min(1),
	checking_id: z.string().min(1)
});
const paymentDetailsSchema = z.looseObject({
	checking_id: z.string().min(1),
	payment_hash: paymentHashSchema,
	amount: z.number().int(),
	status: z.enum(['pending', 'success', 'failed'])
});
const paymentStatusResponseSchema = z.looseObject({
	paid: z.boolean(),
	details: paymentDetailsSchema
});
const listedPaymentSchema = z.looseObject({
	checking_id: z.string().min(1),
	payment_hash: paymentHashSchema.optional(),
	bolt11: z.string().min(1),
	amount: z.number().int(),
	status: z.enum(['pending', 'success', 'failed']),
	extra: z.record(z.string(), z.unknown()).default({})
});
const listedPaymentsSchema = z.array(listedPaymentSchema);
const exchangeRateSchema = z.looseObject({ rate: z.number().positive() });

export interface LnbitsConfig {
	baseUrl: string;
	invoiceKey: string;
	webhookUrl?: string;
}

export class LnbitsError extends Error {
	readonly outcome: 'explicit_failure' | 'ambiguous';
	readonly operation: string;

	constructor(operation: string, outcome: 'explicit_failure' | 'ambiguous', message: string) {
		super(message);
		this.name = 'LnbitsError';
		this.operation = operation;
		this.outcome = outcome;
	}
}

export interface LnbitsInvoice {
	checkingId: string;
	paymentHash: string;
	bolt11: string;
	satsAmount: number;
}

export type LnbitsPaymentState = 'pending' | 'paid' | 'failed';

export interface LnbitsPaymentStatus {
	checkingId: string;
	paymentHash: string;
	state: LnbitsPaymentState;
	satsAmount: number;
	paid: boolean;
	status: 'pending' | 'success' | 'failed';
}

export type LnbitsFetch = typeof fetch;

function endpoint(config: LnbitsConfig, path: string): URL {
	const baseUrl = new URL(config.baseUrl);
	if (baseUrl.protocol !== 'https:') {
		throw new LnbitsError('configuration', 'explicit_failure', 'invalid LNbits URL protocol');
	}
	return new URL(path, `${baseUrl.toString().replace(/\/$/, '')}/`);
}

async function request(
	config: LnbitsConfig,
	operation: string,
	path: string,
	init: RequestInit = {},
	fetcher: LnbitsFetch = fetch
): Promise<unknown> {
	let response: Response;
	try {
		response = await fetcher(endpoint(config, path), {
			...init,
			headers: {
				accept: 'application/json',
				'X-Api-Key': config.invoiceKey,
				...init.headers
			},
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
		});
	} catch {
		throw new LnbitsError(operation, 'ambiguous', 'LNbits request failed');
	}
	if (!response.ok) {
		throw new LnbitsError(
			operation,
			response.status >= 500 ? 'ambiguous' : 'explicit_failure',
			`LNbits returned HTTP ${response.status}`
		);
	}
	try {
		return await response.json();
	} catch {
		throw new LnbitsError(operation, 'ambiguous', 'LNbits returned invalid JSON');
	}
}

function decodeInvoice(bolt11: string, expectedSats?: number): LnbitsInvoice {
	let decoded: ReturnType<typeof decode>;
	try {
		decoded = decode(bolt11);
	} catch {
		throw new LnbitsError('decode_invoice', 'explicit_failure', 'LNbits returned invalid BOLT11');
	}
	const amount = decoded.sections.find((section) => section.name === 'amount');
	const paymentHash = decoded.sections.find((section) => section.name === 'payment_hash');
	const amountMsats = amount ? Number(amount.value) : Number.NaN;
	if (!Number.isSafeInteger(amountMsats) || amountMsats <= 0 || amountMsats % MSATS_PER_SAT !== 0) {
		throw new LnbitsError('decode_invoice', 'explicit_failure', 'BOLT11 has an invalid amount');
	}
	const satsAmount = amountMsats / MSATS_PER_SAT;
	if (expectedSats !== undefined && satsAmount !== expectedSats) {
		throw new LnbitsError('decode_invoice', 'explicit_failure', 'BOLT11 amount mismatch');
	}
	if (!paymentHash || !paymentHashSchema.safeParse(paymentHash.value).success) {
		throw new LnbitsError('decode_invoice', 'explicit_failure', 'BOLT11 payment hash is invalid');
	}
	return {
		checkingId: '',
		paymentHash: paymentHash.value.toLowerCase(),
		bolt11,
		satsAmount
	};
}

function msatsToSats(amount: number, operation: string): number {
	if (amount <= 0 || amount % MSATS_PER_SAT !== 0) {
		throw new LnbitsError(operation, 'explicit_failure', 'LNbits payment amount is invalid');
	}
	return amount / MSATS_PER_SAT;
}

export async function createLnbitsInvoice(
	config: LnbitsConfig,
	input: { attemptId: string; satsAmount: number; memo: string; expirySeconds: number },
	fetcher: LnbitsFetch = fetch
): Promise<LnbitsInvoice> {
	const body = {
		out: false,
		amount: input.satsAmount,
		memo: input.memo,
		expiry: input.expirySeconds,
		extra: { cadbos_attempt_id: input.attemptId },
		...(config.webhookUrl ? { webhook: config.webhookUrl } : {})
	};
	const parsed = createInvoiceResponseSchema.safeParse(
		await request(
			config,
			'create_invoice',
			'api/v1/payments',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			},
			fetcher
		)
	);
	if (!parsed.success) {
		throw new LnbitsError('create_invoice', 'ambiguous', 'LNbits invoice response is invalid');
	}
	const invoice = decodeInvoice(parsed.data.payment_request, input.satsAmount);
	if (invoice.paymentHash !== parsed.data.payment_hash.toLowerCase()) {
		throw new LnbitsError('create_invoice', 'explicit_failure', 'LNbits payment hash mismatch');
	}
	return { ...invoice, checkingId: parsed.data.checking_id };
}

export async function lookupLnbitsPayment(
	config: LnbitsConfig,
	paymentHash: string,
	fetcher: LnbitsFetch = fetch
): Promise<LnbitsPaymentStatus> {
	const normalizedPaymentHash = paymentHash.toLowerCase();
	const parsed = paymentStatusResponseSchema.safeParse(
		await request(
			config,
			'lookup_payment',
			`api/v1/payments/${encodeURIComponent(normalizedPaymentHash)}`,
			{},
			fetcher
		)
	);
	if (!parsed.success) {
		throw new LnbitsError(
			'lookup_payment',
			'explicit_failure',
			'LNbits payment response is invalid'
		);
	}
	const details = parsed.data.details;
	if (details.payment_hash.toLowerCase() !== normalizedPaymentHash) {
		throw new LnbitsError('lookup_payment', 'explicit_failure', 'LNbits payment hash mismatch');
	}
	const consistent =
		(parsed.data.paid && details.status === 'success') ||
		(!parsed.data.paid && (details.status === 'pending' || details.status === 'failed'));
	if (!consistent) {
		throw new LnbitsError('lookup_payment', 'explicit_failure', 'LNbits payment state mismatch');
	}
	const state: LnbitsPaymentState = parsed.data.paid
		? 'paid'
		: details.status === 'failed'
			? 'failed'
			: 'pending';
	return {
		checkingId: details.checking_id,
		paymentHash: normalizedPaymentHash,
		state,
		satsAmount: msatsToSats(details.amount, 'lookup_payment'),
		paid: parsed.data.paid,
		status: details.status
	};
}

export async function findLnbitsInvoiceByAttempt(
	config: LnbitsConfig,
	attemptId: string,
	fetcher: LnbitsFetch = fetch
): Promise<LnbitsInvoice | null> {
	for (let offset = 0; offset < 500; offset += 100) {
		const parsed = listedPaymentsSchema.safeParse(
			await request(
				config,
				'list_payments',
				`api/v1/payments?limit=100&offset=${offset}`,
				{},
				fetcher
			)
		);
		if (!parsed.success) {
			throw new LnbitsError('list_payments', 'ambiguous', 'LNbits payment list is invalid');
		}
		const match = parsed.data.find((payment) => payment.extra.cadbos_attempt_id === attemptId);
		if (match) {
			const invoice = decodeInvoice(match.bolt11);
			if (match.payment_hash && invoice.paymentHash !== match.payment_hash.toLowerCase()) {
				throw new LnbitsError('list_payments', 'explicit_failure', 'LNbits payment hash mismatch');
			}
			return { ...invoice, checkingId: match.checking_id };
		}
		if (parsed.data.length < 100) return null;
	}
	throw new LnbitsError('list_payments', 'ambiguous', 'LNbits recovery window was exceeded');
}

export async function getLnbitsUsdPerBtc(
	config: LnbitsConfig,
	fetcher: LnbitsFetch = fetch
): Promise<number> {
	const parsed = exchangeRateSchema.safeParse(
		await request(config, 'exchange_rate', 'api/v1/rate/USD', {}, fetcher)
	);
	if (!parsed.success) {
		throw new LnbitsError('exchange_rate', 'ambiguous', 'LNbits rate response is invalid');
	}
	return parsed.data.rate;
}
