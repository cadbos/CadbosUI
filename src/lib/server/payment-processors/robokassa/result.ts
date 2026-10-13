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
	type RobokassaClient,
	RobokassaSignatureError,
	RobokassaValidationError,
	type HashAlgorithm
} from '@robokassa/sdk';
import { sql } from 'drizzle-orm';

import { getDb } from '$lib/server/db';
import { sdkClient } from './sdk';

const MAX_WEBHOOK_QUERY_LENGTH = 16_384;

interface InvoiceRow {
	id: string;
	user_id: string;
	amount_minor: number;
	currency: string;
	status: 'open' | 'paid' | 'cancelled';
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

export async function handleRobokassaResult(
	platform: App.Platform | undefined,
	request: Request
): Promise<Response> {
	if (request.method !== 'GET') return response('Method not allowed', 405);
	let invId: string | null = null;
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
		invId = id;
		const db = getDb(platform);
		const row = await db.get<InvoiceRow>(
			sql`SELECT i.id, i.user_id, i.amount_minor, i.currency, i.status FROM invoices i
				JOIN robokassa_invoice_details d ON d.invoice_id = i.id
				WHERE d.inv_id = ${Number(id)} AND i.payment_processor = 'robokassa'`
		);
		if (!row || row.currency !== 'USD') return invalidNotification();
		const quote = await db.get<QuoteRow>(
			sql`SELECT rub_amount_minor, is_test, hash_algorithm FROM robokassa_invoice_details WHERE invoice_id = ${row.id} AND inv_id = ${Number(id)}`
		);
		if (!quote) throw new Error('Robokassa invoice details are missing');
		if (BigInt(quote.rub_amount_minor) !== amount) return invalidNotification();
		const client = sdkClient(platform, quote);
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
				WHERE i.id = ${row.id} AND i.payment_processor = 'robokassa' AND i.user_id = ${row.user_id}
				AND i.amount_minor = ${row.amount_minor} AND i.currency = 'USD'
				AND i.status IN ('open', 'cancelled') AND i.ledger_entry_id IS NULL
				AND d.inv_id = ${Number(id)} AND d.rub_amount_minor = ${quote.rub_amount_minor} AND d.is_test = ${quote.is_test}
				AND d.hash_algorithm = ${quote.hash_algorithm} AND d.result_out_sum IS NULL`),
			db.run(sql`UPDATE invoices SET ledger_entry_id = last_insert_rowid(), status = 'paid',
				paid_at = ${now}, updated_at = MAX(updated_at, ${now})
				WHERE changes() = 1 AND id = ${row.id} AND payment_processor = 'robokassa'
				AND user_id = ${row.user_id} AND amount_minor = ${row.amount_minor} AND currency = 'USD'
				AND status IN ('open', 'cancelled') AND ledger_entry_id IS NULL`),
			db.run(sql`UPDATE robokassa_invoice_details SET result_out_sum = ${notification.OutSum},
				result_fee = ${notification.Fee ?? null}, payer_email = ${notification.Email ?? null},
				payment_method = ${notification.PaymentMethod ?? null}, inc_curr_label = ${notification.IncCurrLabel ?? null}
				WHERE invoice_id = ${row.id} AND inv_id = ${Number(id)} AND result_out_sum IS NULL
				AND EXISTS (SELECT 1 FROM invoices i JOIN ledger_entries l ON l.id = i.ledger_entry_id
				WHERE i.id = ${row.id} AND i.payment_processor = 'robokassa' AND i.currency = 'USD'
				AND i.status = 'paid' AND i.paid_at IS NOT NULL AND i.user_id = ${row.user_id}
				AND i.amount_minor = ${row.amount_minor} AND l.user_id = i.user_id
				AND l.amount = i.amount_minor AND l.entry_side = 'credit' AND l.reason = 'top-up')`),
			db.get<{ id: string; result_out_sum: string }>(sql`SELECT i.id, d.result_out_sum
				FROM invoices i JOIN ledger_entries l ON l.id = i.ledger_entry_id
				JOIN robokassa_invoice_details d ON d.invoice_id = i.id
				WHERE i.id = ${row.id} AND i.payment_processor = 'robokassa' AND i.currency = 'USD'
				AND i.status = 'paid' AND i.paid_at IS NOT NULL AND i.user_id = ${row.user_id}
				AND i.amount_minor = ${row.amount_minor} AND l.user_id = i.user_id AND l.amount = i.amount_minor
				AND l.entry_side = 'credit' AND l.reason = 'top-up' AND d.inv_id = ${Number(id)} AND d.rub_amount_minor = ${quote.rub_amount_minor}
				AND d.result_out_sum IS NOT NULL`)
		]);
		if (!latest || amountInKopecks(latest.result_out_sum) !== amount)
			throw new Error('Robokassa settlement was not recorded');
		return response(client.notification.resultResponse(notification));
	} catch (error) {
		console.error('Robokassa webhook processing failed', {
			invId,
			errorType: error instanceof Error ? error.name : typeof error
		});
		return response('Payment notification unavailable', 500);
	}
}
