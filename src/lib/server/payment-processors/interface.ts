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

export interface InvoiceInput {
	id: string;
	amountMinor: number;
	currency: 'USD';
}

export interface PaymentUrl {
	url: string;
}

export type CancellationOutcome = {
	ok: boolean;
	cause: Error | undefined;
};

export interface PaymentProcessor {
	readonly id: string;
	createInvoice(invoice: InvoiceInput): Promise<PaymentUrl>;
	cancelInvoice(invoice: InvoiceInput): Promise<CancellationOutcome>;
	handleWebhook(request: Request): Promise<Response>;
}
