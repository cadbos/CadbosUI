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

import type { HashAlgorithm } from '@robokassa/sdk';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import type { InvoiceCheckout } from '$lib/api/contract';
import { getDb, type Database } from '$lib/server/db';
import { getUsdRubRate } from '$lib/server/exchange-rate';
import { quoteRubAmount } from './quote';
import { resolveSdk, type RobokassaSettings } from './sdk';
import { getOperationDetails, type RobokassaOperation } from './operation';
import type {
	CancellationOutcome,
	InvoiceDetails,
	InvoiceInput,
	PaymentProcessor,
	PaymentUrl
} from '../interface';

interface InvoiceRow {
	id: string;
	user_id: string;
	amount_minor: number;
	currency: string;
	status: 'open' | 'paid' | 'cancelled';
	payment_url?: string | null;
}

function validateInvoiceId(invoiceId: string): void {
	if (!z.uuid().safeParse(invoiceId).success) {
		throw new Error('Cadbos invoice ID must be a UUID');
	}
}

function validateInvoice(invoice: InvoiceInput): void {
	validateInvoiceId(invoice.id);
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

export interface RobokassaProcessorData {
	quote: {
		invId: string;
		paymentUrl: string;
		rubAmountMinor: number;
		rubPerUsd: string;
		rateAsOf: number;
		isTest: boolean;
		hashAlgorithm: HashAlgorithm;
	} | null;
	notification: {
		outSum: string;
		fee: string | null;
		payerEmail: string | null;
		paymentMethod: string | null;
		incCurrLabel: string | null;
	} | null;
	operation: RobokassaOperation;
}

interface PersistedInvoiceRow extends InvoiceRow {
	payment_processor: string;
	ledger_entry_id: number | null;
	created_at: number;
	updated_at: number;
	paid_at: number | null;
}

interface DetailsRow extends RobokassaSettings {
	inv_id: number;
	payment_url: string;
	rub_amount_minor: number;
	rub_per_usd: string;
	rate_as_of: number;
	result_out_sum: string | null;
	result_fee: string | null;
	payer_email: string | null;
	payment_method: string | null;
	inc_curr_label: string | null;
}

type InvoiceDetailsRow = PersistedInvoiceRow & (DetailsRow | { payment_url: null });

class RobokassaPaymentProcessor implements PaymentProcessor<RobokassaProcessorData> {
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
		const { client, settings } = resolveSdk(this.platform, undefined, this.fetcher);
		const rate = await getUsdRubRate(this.fetcher);
		const quote = quoteRubAmount(invoice.amountMinor, rate.rubPerUsd);
		const kopecks = BigInt(quote.amountMinor);
		const outSum = `${kopecks / 100n}.${String(kopecks % 100n).padStart(2, '0')}`;
		for (let attempt = 0; attempt < 3; attempt++) {
			let invId: bigint;
			do {
				const words = crypto.getRandomValues(new Uint32Array(2));
				invId = (BigInt(words[0] & 0x1fffff) << 32n) | BigInt(words[1]);
			} while (invId === 0n);
			const paymentUrl = client.payment.buildPaymentURL({
				OutSum: outSum,
				InvID: invId.toString(),
				Description: `Cadbos #${invoice.id}`
			});
			const inserted = await db.get<{ payment_url: string }>(
				sql`INSERT INTO robokassa_invoice_details (invoice_id, inv_id, payment_url, rub_amount_minor, rub_per_usd, rate_as_of, is_test, hash_algorithm)
					SELECT id, ${Number(invId)}, ${paymentUrl}, ${quote.amountMinor}, ${quote.rubPerUsd}, ${Date.parse(rate.asOf)}, ${settings.is_test}, ${settings.hash_algorithm}
					FROM invoices WHERE id = ${invoice.id} AND payment_processor = ${this.id}
					AND amount_minor = ${invoice.amountMinor} AND currency = ${invoice.currency}
					AND user_id = ${row.user_id} AND status = 'open'
					ON CONFLICT (invoice_id) DO NOTHING
					ON CONFLICT (inv_id) DO NOTHING RETURNING payment_url`
			);
			if (inserted) return { url: inserted.payment_url };

			const latest = await db.get<InvoiceRow>(
				sql`SELECT i.id, i.user_id, i.amount_minor, i.currency, i.status, d.payment_url
					FROM invoices i LEFT JOIN robokassa_invoice_details d ON d.invoice_id = i.id
					WHERE i.id = ${invoice.id} AND i.payment_processor = ${this.id}`
			);
			if (
				!matchesInvoice(latest ?? undefined, invoice) ||
				latest.user_id !== row.user_id ||
				latest.status !== 'open'
			) {
				throw new Error('Robokassa invoice is missing, changed, or no longer open');
			}
			if (latest.payment_url) return { url: latest.payment_url };
		}
		throw new Error('Robokassa invoice ID allocation failed after three attempts');
	}

	async getInvoiceDetails(invoiceId: string): Promise<InvoiceDetails<RobokassaProcessorData>> {
		validateInvoiceId(invoiceId);
		const db = getDb(this.platform);
		const row = await db.get<InvoiceDetailsRow>(
			sql`SELECT i.id, i.payment_processor, i.user_id, i.ledger_entry_id, i.amount_minor, i.currency,
				i.status, i.created_at, i.updated_at, i.paid_at,
				d.inv_id, d.payment_url, d.rub_amount_minor, d.rub_per_usd, d.rate_as_of, d.is_test, d.hash_algorithm,
				d.result_out_sum, d.result_fee, d.payer_email, d.payment_method, d.inc_curr_label
				FROM invoices i LEFT JOIN robokassa_invoice_details d ON d.invoice_id = i.id
				WHERE i.id = ${invoiceId} AND i.payment_processor = ${this.id}`
		);
		if (!row) throw new Error('Robokassa invoice not found');
		if (row.currency !== 'USD') throw new Error('Robokassa only supports USD invoices');
		const details = row.payment_url === null ? null : row;
		const operation: RobokassaOperation = !details
			? { status: 'not-quoted' }
			: details.is_test === 1
				? { status: 'unavailable-for-test' }
				: await getOperationDetails(this.platform, this.fetcher, details.inv_id, details);
		return {
			id: row.id,
			amountMinor: row.amount_minor,
			currency: row.currency,
			paymentProcessor: row.payment_processor,
			userId: row.user_id,
			ledgerEntryId: row.ledger_entry_id,
			status: row.status,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			paidAt: row.paid_at,
			processorData: {
				quote: details
					? {
							invId: String(details.inv_id),
							paymentUrl: details.payment_url,
							rubAmountMinor: details.rub_amount_minor,
							rubPerUsd: details.rub_per_usd,
							rateAsOf: details.rate_as_of,
							isTest: details.is_test === 1,
							hashAlgorithm: details.hash_algorithm
						}
					: null,
				notification:
					details?.result_out_sum != null
						? {
								outSum: details.result_out_sum,
								fee: details.result_fee,
								payerEmail: details.payer_email,
								paymentMethod: details.payment_method,
								incCurrLabel: details.inc_curr_label
							}
						: null,
				operation
			}
		};
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
}

export function createRobokassaClient(
	platform: App.Platform | undefined,
	fetcher: typeof fetch = fetch
): PaymentProcessor<RobokassaProcessorData> {
	return new RobokassaPaymentProcessor(platform, fetcher);
}

export async function getRobokassaCheckout(
	db: Database,
	invoiceId: string
): Promise<InvoiceCheckout | null> {
	const quote = await db.get<{
		payment_url: string;
		rub_amount_minor: number;
		is_test: number;
	}>(sql`SELECT payment_url, rub_amount_minor, is_test FROM robokassa_invoice_details
		WHERE invoice_id = ${invoiceId}`);
	return quote
		? {
				paymentUrl: quote.payment_url,
				amountMinor: quote.rub_amount_minor,
				currency: 'RUB',
				isTest: quote.is_test === 1
			}
		: null;
}
