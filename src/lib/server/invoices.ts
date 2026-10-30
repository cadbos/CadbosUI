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

import { DrizzleQueryError, sql } from 'drizzle-orm';
import type { CreateInvoiceRequest, InvoiceResponse } from '$lib/api/contract';
import type { Database } from '$lib/server/db';
import { TestDepositLimitError } from '$lib/server/payment-processors/robokassa/test-deposit-limit';
import {
	paymentProcessors,
	type PaymentProcessorRegistration
} from '$lib/server/payment-processors/registry';

interface InvoiceRow {
	id: string;
	user_id: string;
	payment_processor: string;
	amount_minor: number;
	currency: 'USD';
	status: InvoiceResponse['status'];
	created_at: number;
	updated_at: number;
	paid_at: number | null;
}

export class InvoiceError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
		options?: ErrorOptions
	) {
		super(message, options);
		this.name = 'InvoiceError';
	}
}

function processorFor(
	id: string,
	registry: readonly PaymentProcessorRegistration[]
): PaymentProcessorRegistration {
	const processor = registry.find((entry) => entry.id === id);
	if (!processor) throw new InvoiceError(400, 'invalid_processor', 'Unknown payment processor');
	return processor;
}

function requireConfigured(
	processor: PaymentProcessorRegistration,
	platform: App.Platform | undefined
): void {
	try {
		processor.validateConfiguration(platform);
	} catch (error) {
		throw new InvoiceError(503, 'payment_unavailable', 'Payment processor unavailable', {
			cause: error
		});
	}
}

async function requireFundingAccess(db: Database, userId: string): Promise<void> {
	const credit = await db.get<{ enabled: number }>(
		sql`SELECT enabled FROM credits WHERE user_id = ${userId}`
	);
	if (credit?.enabled !== 1) {
		throw new InvoiceError(403, 'funding_restricted', 'Account is not enabled for funding');
	}
}

async function findInvoice(db: Database, id: string): Promise<InvoiceRow | undefined> {
	return (
		(await db.get<InvoiceRow>(sql`SELECT id, user_id, payment_processor, amount_minor,
		currency, status, created_at, updated_at, paid_at FROM invoices WHERE id = ${id}`)) ?? undefined
	);
}

async function ownedInvoice(db: Database, userId: string, id: string): Promise<InvoiceRow> {
	const row = await db.get<InvoiceRow>(sql`SELECT id, user_id, payment_processor, amount_minor,
		currency, status, created_at, updated_at, paid_at FROM invoices
		WHERE id = ${id} AND user_id = ${userId}`);
	if (!row) throw new InvoiceError(404, 'invoice_not_found', 'Invoice not found');
	return row;
}

async function publicInvoice(
	db: Database,
	row: InvoiceRow,
	registry: readonly PaymentProcessorRegistration[]
): Promise<InvoiceResponse> {
	const processor = registry.find((entry) => entry.id === row.payment_processor);
	const checkout =
		row.status === 'open' && processor ? await processor.getCheckout(db, row.id) : null;
	return {
		id: row.id,
		paymentProcessor: row.payment_processor,
		amountMinor: row.amount_minor,
		currency: row.currency,
		status: row.status,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		paidAt: row.paid_at,
		checkout
	};
}

function requireMatchingInvoice(
	row: InvoiceRow,
	userId: string,
	input: CreateInvoiceRequest
): void {
	if (
		row.user_id !== userId ||
		row.payment_processor !== input.paymentProcessor ||
		row.amount_minor !== input.amountMinor ||
		row.currency !== input.currency
	) {
		throw new InvoiceError(409, 'invoice_conflict', 'Invoice ID is already in use');
	}
}

export async function createInvoice(
	db: Database,
	platform: App.Platform | undefined,
	userId: string,
	input: CreateInvoiceRequest,
	registry: readonly PaymentProcessorRegistration[] = paymentProcessors
): Promise<{ invoice: InvoiceResponse; created: boolean }> {
	const existing = await findInvoice(db, input.id);
	if (existing) {
		requireMatchingInvoice(existing, userId, input);
		return { invoice: await publicInvoice(db, existing, registry), created: false };
	}

	await requireFundingAccess(db, userId);
	const processor = processorFor(input.paymentProcessor, registry);
	if (!processor.invoiceCurrencies.includes(input.currency)) {
		throw new InvoiceError(400, 'invalid_currency', 'Unsupported invoice currency');
	}
	requireConfigured(processor, platform);
	const now = Date.now();
	const inserted = await db.get<{ id: string }>(
		sql`INSERT INTO invoices (id, payment_processor, user_id, amount_minor, currency, created_at, updated_at)
		SELECT ${input.id}, ${processor.id}, ${userId}, ${input.amountMinor}, ${input.currency}, ${now}, ${now}
		WHERE EXISTS (SELECT 1 FROM credits WHERE user_id = ${userId} AND enabled = 1)
		ON CONFLICT (id) DO NOTHING RETURNING id`
	);
	const row = await findInvoice(db, input.id);
	if (!row) {
		await requireFundingAccess(db, userId);
		throw new Error('Invoice creation did not persist');
	}
	requireMatchingInvoice(row, userId, input);
	return {
		invoice: await publicInvoice(db, row, registry),
		created: inserted !== undefined && inserted !== null
	};
}

export async function getInvoice(
	db: Database,
	userId: string,
	id: string,
	registry: readonly PaymentProcessorRegistration[] = paymentProcessors
): Promise<InvoiceResponse> {
	return publicInvoice(db, await ownedInvoice(db, userId, id), registry);
}

export async function checkoutInvoice(
	db: Database,
	platform: App.Platform | undefined,
	userId: string,
	id: string,
	registry: readonly PaymentProcessorRegistration[] = paymentProcessors
): Promise<InvoiceResponse> {
	const row = await ownedInvoice(db, userId, id);
	if (row.status !== 'open') {
		throw new InvoiceError(409, 'invoice_not_open', 'Invoice is no longer open');
	}
	await requireFundingAccess(db, userId);
	const processor = processorFor(row.payment_processor, registry);
	requireConfigured(processor, platform);
	try {
		await processor.createClient(platform).createInvoice({
			id: row.id,
			amountMinor: row.amount_minor,
			currency: row.currency
		});
	} catch (error) {
		if (error instanceof DrizzleQueryError) throw error;
		const latest = await ownedInvoice(db, userId, id);
		if (latest.status !== 'open') {
			throw new InvoiceError(409, 'invoice_not_open', 'Invoice is no longer open', {
				cause: error
			});
		}
		if (error instanceof RangeError) {
			throw new InvoiceError(
				400,
				'amount_out_of_range',
				'Payment amount is outside payable limits',
				{ cause: error }
			);
		}
		if (error instanceof TestDepositLimitError) {
			throw new InvoiceError(403, 'test_deposit_limit_exceeded', error.message);
		}
		throw new InvoiceError(503, 'payment_unavailable', 'Checkout unavailable', { cause: error });
	}
	return getInvoice(db, userId, id, registry);
}

export async function cancelInvoice(
	db: Database,
	platform: App.Platform | undefined,
	userId: string,
	id: string,
	registry: readonly PaymentProcessorRegistration[] = paymentProcessors
): Promise<InvoiceResponse> {
	const row = await ownedInvoice(db, userId, id);
	if (row.status === 'paid') {
		throw new InvoiceError(409, 'invoice_paid', 'Paid invoices cannot be cancelled');
	}
	if (row.status === 'cancelled') return publicInvoice(db, row, registry);
	const processor = processorFor(row.payment_processor, registry);
	const outcome = await processor.createClient(platform).cancelInvoice({
		id: row.id,
		amountMinor: row.amount_minor,
		currency: row.currency
	});
	if (!outcome.ok) {
		const latest = await ownedInvoice(db, userId, id);
		if (latest.status === 'paid') {
			throw new InvoiceError(409, 'invoice_paid', 'Paid invoices cannot be cancelled', {
				cause: outcome.cause
			});
		}
		if (latest.status === 'cancelled') return publicInvoice(db, latest, registry);
		throw new InvoiceError(503, 'payment_unavailable', 'Cancellation unavailable', {
			cause: outcome.cause
		});
	}
	return getInvoice(db, userId, id, registry);
}
