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

import {
	RobokassaClient,
	RobokassaSignatureError,
	RobokassaValidationError,
	type HashAlgorithm
} from '@robokassa/sdk';
import { sql } from 'drizzle-orm';

import { getDb } from '$lib/server/db';
import { getUsdRubRate } from '$lib/server/exchange-rate';
import { quoteRubAmount } from './quote';
import type { CancellationOutcome, InvoiceInput, PaymentProcessor, PaymentUrl } from '../interface';

const DEFAULT_HASH_METHOD = 'md5';
const ALLOWED_HASH_METHODS: HashAlgorithm[] = [DEFAULT_HASH_METHOD, 'sha256', 'sha512'];
const MAX_WEBHOOK_QUERY_LENGTH = 16_384;

interface InvoiceRow {
	id: string;
	user_id: string;
	amount_minor: number;
	currency: string;
	status: 'open' | 'paid' | 'cancelled';
	payment_url?: string | null;
}

function validateInvoice(invoice: InvoiceInput): void {
	if (!/^[1-9]\d*$/.test(invoice.id) || !Number.isSafeInteger(Number(invoice.id))) {
		throw new Error('Robokassa invoice ID must be a positive safe integer string');
	}
	if (!Number.isSafeInteger(invoice.amountMinor) || invoice.amountMinor <= 0) {
		throw new Error('Robokassa invoice amount must be a positive safe integer in USD cents');
	}
	if (invoice.currency !== 'USD') throw new Error('Robokassa only supports USD invoices');
}

function matchesInvoice(row: InvoiceRow | undefined, invoice: InvoiceInput): row is InvoiceRow {
	return (
		row?.id === invoice.id &&
		row.amount_minor === invoice.amountMinor &&
		row.currency === invoice.currency
	);
}

function amountInKopecks(value: string): bigint | null {
	const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
	if (!match) return null;
	const fraction = match[2] ?? '';
	if (/[1-9]/.test(fraction.slice(2))) return null;
	return BigInt(match[1]) * 100n + BigInt(fraction.slice(0, 2).padEnd(2, '0'));
}

function invalidNotification(): Response {
	return response('Invalid notification', 400);
}

function response(body: string, status = 200): Response {
	return new Response(body, {
		status,
		headers: { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' }
	});
}

interface QuoteRow {
	rub_amount_minor: number;
	is_test: number;
	hash_algorithm: HashAlgorithm;
}

function sdkClient(platform: App.Platform | undefined, saved?: QuoteRow): RobokassaClient {
	const env = platform?.env;
	for (const name of [
		'ROBOKASSA_LOGIN',
		'ROBOKASSA_PASSWORD1',
		'ROBOKASSA_PASSWORD2',
		'ROBOKASSA_TEST_PASSWORD1',
		'ROBOKASSA_TEST_PASSWORD2'
	] as const) {
		if (!env?.[name]?.trim()) throw new Error(`${name} not configured`);
	}
	const mode = env?.ROBOKASSA_IS_TEST;
	if (!saved && mode !== undefined && mode !== 'true' && mode !== 'false')
		throw new Error('ROBOKASSA_IS_TEST must be true or false');
	const hash = saved?.hash_algorithm ?? (env?.ROBOKASSA_HASH_ALGORITHM || DEFAULT_HASH_METHOD);
	if (!(ALLOWED_HASH_METHODS as string[]).includes(hash))
		throw new Error('ROBOKASSA_HASH_ALGORITHM must be md5, sha256, sha512');
	return new RobokassaClient({
		login: env!.ROBOKASSA_LOGIN!,
		password1: env!.ROBOKASSA_PASSWORD1!,
		password2: env!.ROBOKASSA_PASSWORD2!,
		testPassword1: env!.ROBOKASSA_TEST_PASSWORD1!,
		testPassword2: env!.ROBOKASSA_TEST_PASSWORD2!,
		isTest: saved ? saved.is_test === 1 : mode !== 'false',
		hashAlgorithm: hash as HashAlgorithm
	});
}

class RobokassaPaymentProcessor implements PaymentProcessor {
	readonly id = 'robokassa';
	constructor(
		private readonly platform: App.Platform | undefined,
		private readonly fetcher: typeof fetch
	) {}

	async createInvoice(invoice: InvoiceInput): Promise<PaymentUrl> {
		validateInvoice(invoice);
		const db = getDb(this.platform);
		const row = await db.get<InvoiceRow>(
			sql`SELECT i.id, i.user_id, i.amount_minor, i.currency, i.status, d.payment_url FROM invoices i
    LEFT JOIN robokassa_invoice_details d ON d.invoice_id = i.id
    WHERE i.id = ${invoice.id} AND i.payment_processor = ${this.id}`
		);
		if (!matchesInvoice(row ?? undefined, invoice) || row.status !== 'open') {
			throw new Error('Robokassa invoice is missing, changed, or no longer open');
		}

		if (row.payment_url) return { url: row.payment_url };
		const client = sdkClient(this.platform);
		const isTest = this.platform?.env.ROBOKASSA_IS_TEST !== 'false';
		const hashAlgorithm = this.platform?.env.ROBOKASSA_HASH_ALGORITHM || DEFAULT_HASH_METHOD;
		const rate = await getUsdRubRate(this.fetcher);
		const quote = quoteRubAmount(invoice.amountMinor, rate.rubPerUsd);
		const kopecks = BigInt(quote.amountMinor);
		const outSum = `${kopecks / 100n}.${String(kopecks % 100n).padStart(2, '0')}`;
		const paymentUrl = client.payment.buildPaymentURL({
			OutSum: outSum,
			InvID: invoice.id,
			Description: `Cadbos #${invoice.id}`
		});

		const inserted = await db.get<{ payment_url: string }>(
			sql`INSERT INTO robokassa_invoice_details (invoice_id, payment_url, rub_amount_minor, rub_per_usd, rate_as_of, is_test, hash_algorithm)
				SELECT id, ${paymentUrl}, ${quote.amountMinor}, ${quote.rubPerUsd}, ${Date.parse(rate.asOf)}, ${isTest ? 1 : 0}, ${hashAlgorithm}
				FROM invoices WHERE id = ${invoice.id} AND payment_processor = ${this.id}
				AND amount_minor = ${invoice.amountMinor} AND currency = ${invoice.currency}
				AND user_id = ${row.user_id} AND status = 'open'
				ON CONFLICT (invoice_id) DO NOTHING RETURNING payment_url`
		);
		if (inserted) return { url: inserted.payment_url };

		const existing = await db.get<{ payment_url: string }>(
			sql`SELECT details.payment_url FROM robokassa_invoice_details AS details
				JOIN invoices ON invoices.id = details.invoice_id
				WHERE invoices.id = ${invoice.id} AND invoices.payment_processor = ${this.id}
				AND invoices.amount_minor = ${invoice.amountMinor} AND invoices.currency = ${invoice.currency}
				AND invoices.user_id = ${row.user_id} AND invoices.status = 'open'`
		);
		if (!existing) throw new Error('Robokassa invoice is missing, changed, or no longer open');
		return { url: existing.payment_url };
	}

	async cancelInvoice(invoice: InvoiceInput): Promise<CancellationOutcome> {
		try {
			validateInvoice(invoice);
			const db = getDb(this.platform);
			const cancelled = await db.get<{ id: string }>(
				sql`UPDATE invoices SET status = 'cancelled', updated_at = MAX(updated_at, ${Date.now()})
					WHERE id = ${invoice.id} AND payment_processor = ${this.id}
					AND amount_minor = ${invoice.amountMinor} AND currency = ${invoice.currency}
					AND status = 'open' RETURNING id`
			);
			if (cancelled) return { ok: true, cause: undefined };

			const row = await db.get<InvoiceRow>(
				sql`SELECT id, user_id, amount_minor, currency, status FROM invoices
					WHERE id = ${invoice.id} AND payment_processor = ${this.id}`
			);
			if (matchesInvoice(row ?? undefined, invoice) && row.status === 'cancelled') {
				return { ok: true, cause: undefined };
			}
			return { ok: false, cause: new Error('Robokassa invoice cannot be cancelled') };
		} catch (error) {
			return {
				ok: false,
				cause:
					error instanceof Error
						? error
						: new Error('Robokassa cancellation failed', { cause: error })
			};
		}
	}

	async handleWebhook(request: Request): Promise<Response> {
		if (request.method !== 'GET') return response('Method not allowed', 405);
		let invoiceId: string | null = null;
		try {
			const url = new URL(request.url);
			if (new TextEncoder().encode(url.search.slice(1)).byteLength > MAX_WEBHOOK_QUERY_LENGTH)
				return invalidNotification();
			const params = url.searchParams;
			const keys = new Set<string>();
			for (const key of params.keys()) {
				if (keys.has(key)) return invalidNotification();
				keys.add(key);
			}
			const id = params.get('InvId') ?? '';
			const outSum = params.get('OutSum') ?? '';
			if (
				!/^[1-9]\d*$/.test(id) ||
				!Number.isSafeInteger(Number(id)) ||
				!params.get('SignatureValue')
			)
				return invalidNotification();
			const amount = amountInKopecks(outSum);
			if (amount === null || amount <= 0n || amount > BigInt(Number.MAX_SAFE_INTEGER))
				return invalidNotification();
			invoiceId = id;
			const db = getDb(this.platform);
			const row = await db.get<InvoiceRow>(
				sql`SELECT id, user_id, amount_minor, currency, status FROM invoices WHERE id = ${id} AND payment_processor = ${this.id}`
			);
			if (!row || row.currency !== 'USD') return invalidNotification();
			const quote = await db.get<QuoteRow>(
				sql`SELECT rub_amount_minor, is_test, hash_algorithm FROM robokassa_invoice_details WHERE invoice_id = ${id}`
			);
			if (!quote) throw new Error('Robokassa invoice details are missing');
			if (BigInt(quote.rub_amount_minor) !== amount) return invalidNotification();
			const client = sdkClient(this.platform, quote);
			let notification: ReturnType<RobokassaClient['notification']['parseResultURL']>;
			try {
				notification = client.notification.parseResultURL(params);
				client.notification.verifyResultURL(notification);
			} catch (error) {
				if (error instanceof RobokassaSignatureError || error instanceof RobokassaValidationError)
					return invalidNotification();
				throw error;
			}
			const now = Date.now();
			const [, , , latest] = await db.batch([
				db.run(sql`INSERT INTO ledger_entries (user_id, amount, entry_side, reason, created_at)
					SELECT i.user_id, i.amount_minor, 'credit', 'top-up', ${now}
					FROM invoices i JOIN robokassa_invoice_details d ON d.invoice_id = i.id
					WHERE i.id = ${id} AND i.payment_processor = ${this.id} AND i.user_id = ${row.user_id}
					AND i.amount_minor = ${row.amount_minor} AND i.currency = 'USD'
					AND i.status IN ('open', 'cancelled') AND i.ledger_entry_id IS NULL
					AND d.rub_amount_minor = ${quote.rub_amount_minor} AND d.is_test = ${quote.is_test}
					AND d.hash_algorithm = ${quote.hash_algorithm} AND d.result_out_sum IS NULL`),
				db.run(sql`UPDATE invoices SET ledger_entry_id = last_insert_rowid(), status = 'paid',
					paid_at = ${now}, updated_at = MAX(updated_at, ${now})
					WHERE changes() = 1 AND id = ${id} AND payment_processor = ${this.id}
					AND user_id = ${row.user_id} AND amount_minor = ${row.amount_minor} AND currency = 'USD'
					AND status IN ('open', 'cancelled') AND ledger_entry_id IS NULL`),
				db.run(sql`UPDATE robokassa_invoice_details SET result_out_sum = ${notification.OutSum},
					result_fee = ${notification.Fee ?? null}, payer_email = ${notification.Email ?? null},
					payment_method = ${notification.PaymentMethod ?? null}, inc_curr_label = ${notification.IncCurrLabel ?? null}
					WHERE invoice_id = ${id} AND result_out_sum IS NULL
					AND EXISTS (SELECT 1 FROM invoices i JOIN ledger_entries l ON l.id = i.ledger_entry_id
					WHERE i.id = ${id} AND i.payment_processor = ${this.id} AND i.currency = 'USD'
					AND i.status = 'paid' AND i.paid_at IS NOT NULL AND i.user_id = ${row.user_id}
					AND i.amount_minor = ${row.amount_minor} AND l.user_id = i.user_id
					AND l.amount = i.amount_minor AND l.entry_side = 'credit' AND l.reason = 'top-up')`),
				db.get<{ id: string; result_out_sum: string }>(sql`SELECT i.id, d.result_out_sum
					FROM invoices i JOIN ledger_entries l ON l.id = i.ledger_entry_id
					JOIN robokassa_invoice_details d ON d.invoice_id = i.id
					WHERE i.id = ${id} AND i.payment_processor = ${this.id} AND i.currency = 'USD'
					AND i.status = 'paid' AND i.paid_at IS NOT NULL AND i.user_id = ${row.user_id}
					AND i.amount_minor = ${row.amount_minor} AND l.user_id = i.user_id AND l.amount = i.amount_minor
					AND l.entry_side = 'credit' AND l.reason = 'top-up' AND d.rub_amount_minor = ${quote.rub_amount_minor}
					AND d.result_out_sum IS NOT NULL`)
			]);
			if (!latest || amountInKopecks(latest.result_out_sum) !== amount)
				throw new Error('Robokassa settlement was not recorded');
			return response(client.notification.resultResponse(notification));
		} catch (error) {
			console.error('Robokassa webhook processing failed', {
				invoiceId,
				errorType: error instanceof Error ? error.name : typeof error
			});
			return response('Payment notification unavailable', 500);
		}
	}
}

export function createRobokassaClient(
	platform: App.Platform | undefined,
	fetcher: typeof fetch = fetch
): PaymentProcessor {
	return new RobokassaPaymentProcessor(platform, fetcher);
}
