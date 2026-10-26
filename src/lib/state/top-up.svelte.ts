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

import { z } from 'zod';
import {
	invoiceResponseSchema,
	paymentProcessorsResponseSchema,
	type CreateInvoiceRequest,
	type InvoiceResponse,
	type PaymentProcessorRecord
} from '$lib/api/contract';
import { formatAmountInput, parseAmountMinor } from '$lib/payment-amount';
import { auth } from '$lib/state/auth.svelte';
import { logBoundaryError } from '$lib/utils';

export const INVOICE_CURRENCY = 'USD';
export const AMOUNT_PRESETS_MINOR = [500, 1000, 2500, 5000, 10000] as const;

const POLL_INTERVAL_MS = 3000;
const POLL_ATTEMPTS = 20;

const termsSchema = z.object({
	id: z.uuid(),
	paymentProcessor: z.string().min(1),
	amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
	currency: z.literal(INVOICE_CURRENCY)
}) satisfies z.ZodType<CreateInvoiceRequest>;

const apiErrorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

export type TopUpError =
	| 'fundingRestricted'
	| 'rateLimited'
	| 'unavailable'
	| 'amountOutOfRange'
	| 'notFound'
	| 'network'
	| 'failed';

export type TopUpView = 'compose' | 'invoice' | 'confirming' | 'pending' | 'paid' | 'cancelled';

type ApiResult = { ok: true; data: unknown } | { ok: false; status: number; code: string | null };

function wait(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		const timer = setTimeout(resolve, ms);
		signal.addEventListener(
			'abort',
			() => {
				clearTimeout(timer);
				resolve();
			},
			{ once: true }
		);
	});
}

class TopUpState {
	processors = $state<PaymentProcessorRecord[]>([]);
	processorsStatus = $state<'loading' | 'ready' | 'error'>('loading');
	amountInput = $state('10');
	processorId = $state('');
	terms = $state<CreateInvoiceRequest | null>(null);
	invoice = $state<InvoiceResponse | null>(null);
	busy = $state<'submit' | 'cancel' | 'restore' | null>(null);
	confirming = $state(false);
	awaitingConfirmation = $state(false);
	error = $state<TopUpError | null>(null);

	amountMinor = $derived(parseAmountMinor(this.amountInput));
	processor = $derived(this.processors.find(({ id }) => id === this.processorId) ?? null);
	editable = $derived(this.terms === null && this.busy === null);
	canSubmit = $derived(
		this.busy === null &&
			(this.terms !== null ||
				(this.amountMinor !== null &&
					this.processor?.invoiceCurrencies.includes(INVOICE_CURRENCY) === true))
	);
	view = $derived.by((): TopUpView => {
		const status = this.invoice?.status;
		if (status === 'paid') return 'paid';
		if (status === 'cancelled') return 'cancelled';
		if (this.confirming) return 'confirming';
		if (this.awaitingConfirmation && status === 'open') return 'pending';
		if (status === 'open' && this.invoice?.checkout) return 'invoice';
		return 'compose';
	});

	#account: string | null = null;
	#session: AbortController | null = null;

	open(account: string, returnedFromProvider: boolean): void {
		this.close();
		this.#account = account;
		const session = new AbortController();
		this.#session = session;
		const stored = this.#readTerms();
		this.terms = stored;
		if (stored) this.#applyTerms(stored);
		void this.#loadProcessors(session.signal);
		if (stored) void this.#restore(returnedFromProvider, session.signal);
	}

	close(): void {
		this.#session?.abort();
		this.#session = null;
		this.#account = null;
		this.processors = [];
		this.processorsStatus = 'loading';
		this.amountInput = '10';
		this.processorId = '';
		this.terms = null;
		this.invoice = null;
		this.busy = null;
		this.confirming = false;
		this.awaitingConfirmation = false;
		this.error = null;
	}

	retryProcessors(): void {
		if (this.#session) void this.#loadProcessors(this.#session.signal);
	}

	async submit(): Promise<void> {
		const signal = this.#session?.signal;
		if (!signal || !this.canSubmit) return;
		this.busy = 'submit';
		this.error = null;
		try {
			if (!this.terms) {
				if (this.amountMinor === null || !this.processor) return;
				this.#setTerms({
					id: crypto.randomUUID(),
					paymentProcessor: this.processor.id,
					amountMinor: this.amountMinor,
					currency: INVOICE_CURRENCY
				});
			}
			let created = await this.#invoiceRequest('/api/invoices', 'POST', this.terms, signal);
			if (created === 'conflict' && this.terms) {
				this.#setTerms({ ...this.terms, id: crypto.randomUUID() });
				created = await this.#invoiceRequest('/api/invoices', 'POST', this.terms, signal);
			}
			if (created !== 'ok' || this.invoice?.status !== 'open' || this.invoice.checkout) return;
			await this.#invoiceRequest(`/api/invoices/${this.invoice.id}/checkout`, 'POST', {}, signal);
		} finally {
			if (!signal.aborted) this.busy = null;
		}
	}

	async cancel(): Promise<void> {
		const signal = this.#session?.signal;
		const terms = this.terms;
		if (!signal || !terms || this.busy !== null) return;
		this.busy = 'cancel';
		this.error = null;
		try {
			const outcome = await this.#invoiceRequest(
				`/api/invoices/${terms.id}/cancel`,
				'POST',
				{},
				signal
			);
			if (outcome === 'ok' && this.invoice?.status === 'cancelled') this.startOver();
		} finally {
			if (!signal.aborted) this.busy = null;
		}
	}

	async confirm(): Promise<void> {
		const signal = this.#session?.signal;
		const terms = this.terms;
		if (!signal || !terms || this.confirming || this.busy !== null) return;
		this.awaitingConfirmation = true;
		this.confirming = true;
		this.error = null;
		try {
			for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
				if (attempt > 0) await wait(POLL_INTERVAL_MS, signal);
				if (signal.aborted) return;
				const outcome = await this.#invoiceRequest(
					`/api/invoices/${terms.id}`,
					'GET',
					null,
					signal
				);
				if (outcome !== 'ok' || this.invoice?.status !== 'open') return;
			}
		} finally {
			if (!signal.aborted) this.confirming = false;
		}
	}

	startOver(): void {
		if (this.busy !== null && this.busy !== 'cancel') return;
		this.#clearStoredTerms();
		this.terms = null;
		this.invoice = null;
		this.awaitingConfirmation = false;
		this.error = null;
	}

	async #restore(returnedFromProvider: boolean, signal: AbortSignal): Promise<void> {
		const terms = this.terms;
		if (!terms) return;
		this.busy = 'restore';
		let outcome: 'ok' | 'conflict' | 'failed';
		try {
			outcome = await this.#invoiceRequest('/api/invoices', 'POST', terms, signal);
		} finally {
			if (!signal.aborted) this.busy = null;
		}
		if (outcome === 'conflict') {
			this.startOver();
			return;
		}
		if (this.invoice?.status !== 'open') return;
		if (returnedFromProvider) await this.confirm();
		else if (!this.invoice.checkout) await this.submit();
	}

	async #loadProcessors(signal: AbortSignal): Promise<void> {
		this.processorsStatus = 'loading';
		const result = await this.#request('/api/payment-processors', 'GET', null, signal);
		if (signal.aborted) return;
		const parsed = result.ok ? paymentProcessorsResponseSchema.safeParse(result.data) : null;
		if (!parsed?.success) {
			if (parsed) logBoundaryError('topUp.loadProcessors', parsed.error);
			this.processorsStatus = 'error';
			return;
		}
		this.processors = parsed.data.paymentProcessors.filter((processor) =>
			processor.invoiceCurrencies.includes(INVOICE_CURRENCY)
		);
		this.processorsStatus = 'ready';
		if (!this.processors.some(({ id }) => id === this.processorId)) {
			this.processorId = this.terms?.paymentProcessor ?? this.processors[0]?.id ?? '';
		}
	}

	async #invoiceRequest(
		path: string,
		method: 'GET' | 'POST',
		body: object | null,
		signal: AbortSignal
	): Promise<'ok' | 'conflict' | 'failed'> {
		const result = await this.#request(path, method, body, signal);
		if (signal.aborted) return 'failed';
		if (!result.ok) {
			if (result.code === 'invoice_conflict') return 'conflict';
			if (result.code === 'invoice_not_open' || result.code === 'invoice_paid') {
				const terms = this.terms;
				if (terms) await this.#invoiceRequest(`/api/invoices/${terms.id}`, 'GET', null, signal);
				return 'failed';
			}
			this.error = this.#errorFor(result);
			return 'failed';
		}
		const parsed = invoiceResponseSchema.safeParse(result.data);
		const terms = this.terms;
		if (
			!parsed.success ||
			!terms ||
			parsed.data.id !== terms.id ||
			parsed.data.paymentProcessor !== terms.paymentProcessor ||
			parsed.data.amountMinor !== terms.amountMinor
		) {
			logBoundaryError(
				'topUp.invoiceResponse',
				parsed.success ? new Error('Invoice response does not match its terms') : parsed.error
			);
			this.error = 'failed';
			return 'failed';
		}
		this.invoice = parsed.data;
		if (parsed.data.status !== 'open') this.#clearStoredTerms();
		if (parsed.data.status === 'paid') void auth.refreshCredit();
		return 'ok';
	}

	async #request(
		path: string,
		method: 'GET' | 'POST',
		body: object | null,
		signal: AbortSignal
	): Promise<ApiResult> {
		let response: Response;
		try {
			response = await fetch(path, {
				method,
				signal,
				...(body === null
					? {}
					: { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
			});
		} catch (error) {
			if (signal.aborted) return { ok: false, status: 0, code: 'aborted' };
			logBoundaryError('topUp.request', error);
			return { ok: false, status: 0, code: null };
		}
		let data: unknown;
		try {
			data = await response.json();
		} catch (error) {
			if (signal.aborted) return { ok: false, status: 0, code: 'aborted' };
			logBoundaryError('topUp.responseBody', error);
			return { ok: false, status: response.status, code: 'malformed_response' };
		}
		if (response.ok) return { ok: true, data };
		const parsed = apiErrorSchema.safeParse(data);
		return {
			ok: false,
			status: response.status,
			code: parsed.success ? parsed.data.error.code : null
		};
	}

	#errorFor(result: { status: number; code: string | null }): TopUpError {
		if (result.status === 0 && result.code === null) return 'network';
		if (result.code === 'funding_restricted') return 'fundingRestricted';
		if (result.code === 'amount_out_of_range') return 'amountOutOfRange';
		if (result.status === 404) return 'notFound';
		if (result.status === 429) return 'rateLimited';
		if (result.status === 503) return 'unavailable';
		console.error('Top-up request failed', { status: result.status, code: result.code });
		return 'failed';
	}

	#applyTerms(terms: CreateInvoiceRequest): void {
		this.amountInput = formatAmountInput(terms.amountMinor);
		this.processorId = terms.paymentProcessor;
	}

	#setTerms(terms: CreateInvoiceRequest): void {
		this.terms = terms;
		try {
			localStorage.setItem(this.#storageKey(), JSON.stringify(terms));
		} catch (error) {
			logBoundaryError('topUp.persistTerms', error);
		}
	}

	#readTerms(): CreateInvoiceRequest | null {
		try {
			const stored = localStorage.getItem(this.#storageKey());
			if (stored === null) return null;
			const parsed = termsSchema.safeParse(JSON.parse(stored));
			if (parsed.success) return parsed.data;
			logBoundaryError('topUp.restoreTerms', parsed.error);
		} catch (error) {
			logBoundaryError('topUp.restoreTerms', error);
		}
		this.#clearStoredTerms();
		return null;
	}

	#clearStoredTerms(): void {
		try {
			localStorage.removeItem(this.#storageKey());
		} catch (error) {
			logBoundaryError('topUp.clearTerms', error);
		}
	}

	#storageKey(): string {
		return `cadbos.top-up.v1.${this.#account}`;
	}
}

export const topUp = new TopUpState();
