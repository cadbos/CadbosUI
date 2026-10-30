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

import type { Page, Route } from '@playwright/test';

import { expect, test } from './fixtures';
import type { CreateInvoiceRequest, InvoiceResponse } from '$lib/api/contract';
import { ru } from '$lib/i18n/locales/ru';

const PK = 'c'.repeat(64);
const PAYMENT_URL = 'https://auth.robokassa.ru/Merchant/Index.aspx?InvId=1';
const INVOICE_ID = 'bf1d4d72-69a8-460c-b18e-a2adbd40151f';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface PaymentBackend {
	invoice: InvoiceResponse | null;
	creates: CreateInvoiceRequest[];
	checkouts: number;
	cancels: number;
	reads: number;
	meRequests: number;
	balance: number;
	createFailure: { status: number; code: string } | 'network' | null;
	checkoutFailure: { status: number; code: string } | null;
	maxAmountMinor: number | null;
	settleOnRead: boolean;
}

function checkout(amountMinor: number): InvoiceResponse['checkout'] {
	return { paymentUrl: PAYMENT_URL, amountMinor, currency: 'RUB', isTest: true };
}

async function json(route: Route, status: number, body: unknown): Promise<void> {
	await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mockPayments(page: Page, approved = true): Promise<PaymentBackend> {
	const backend: PaymentBackend = {
		invoice: null,
		creates: [],
		checkouts: 0,
		cancels: 0,
		reads: 0,
		meRequests: 0,
		balance: 4.5,
		createFailure: null,
		checkoutFailure: null,
		maxAmountMinor: null,
		settleOnRead: false
	};
	await page.route('**/auth/me', async (route) => {
		backend.meRequests++;
		await json(route, 200, {
			user: { pubkey: PK, firstName: 'Ada', lastName: 'Lovelace' },
			featurebaseJwt: null,
			...(approved
				? { credit: { balance: backend.balance, updatedAt: Date.now(), history: [] } }
				: {})
		});
	});
	await page.route('**/auth/nostr-profile', (route) =>
		json(route, 200, { profile: { relays: [] } })
	);
	await page.route('**/api/payment-processors', (route) =>
		json(route, 200, {
			paymentProcessors: [
				{
					id: 'robokassa',
					invoiceCurrencies: ['USD'],
					paymentCurrencies: ['RUB'],
					maxAmountMinor: backend.maxAmountMinor
				}
			]
		})
	);
	await page.route('**/api/invoices', async (route) => {
		const terms = route.request().postDataJSON() as CreateInvoiceRequest;
		backend.creates.push(terms);
		if (backend.createFailure === 'network') {
			backend.createFailure = null;
			await route.abort('failed');
			return;
		}
		if (backend.createFailure) {
			const { status, code } = backend.createFailure;
			await json(route, status, { error: { code, message: code } });
			return;
		}
		const created = backend.invoice === null;
		backend.invoice ??= {
			...terms,
			status: 'open',
			createdAt: 1,
			updatedAt: 1,
			paidAt: null,
			checkout: null
		};
		await json(route, created ? 201 : 200, backend.invoice);
	});
	await page.route('**/api/invoices/*/checkout', async (route) => {
		backend.checkouts++;
		if (backend.checkoutFailure) {
			const { status, code } = backend.checkoutFailure;
			await json(route, status, { error: { code, message: code } });
			return;
		}
		backend.invoice = { ...backend.invoice!, checkout: checkout(225075) };
		await json(route, 200, backend.invoice);
	});
	await page.route('**/api/invoices/*/cancel', async (route) => {
		backend.cancels++;
		backend.invoice = { ...backend.invoice!, status: 'cancelled', checkout: null };
		await json(route, 200, backend.invoice);
	});
	await page.route(/\/api\/invoices\/[0-9a-f-]{36}$/, async (route) => {
		backend.reads++;
		if (!backend.invoice) {
			await json(route, 404, { error: { code: 'invoice_not_found', message: 'Not found' } });
			return;
		}
		if (backend.settleOnRead) {
			backend.balance += backend.invoice.amountMinor / 100;
			backend.invoice = { ...backend.invoice, status: 'paid', paidAt: 2, checkout: null };
		}
		await json(route, 200, backend.invoice);
	});
	return backend;
}

test('prepares a ruble invoice for a chosen dollar amount', async ({ page }) => {
	const backend = await mockPayments(page);
	await page.goto('/top-up');

	await expect(page.getByRole('heading', { name: ru['topUp.title'] })).toBeVisible();
	await expect(page.locator('.balance-value')).toHaveText('$ 4.50');
	const summary = page.locator('.summary');
	await expect(summary.locator('.amount').first()).toHaveText('$ 10.00');
	await expect(summary.locator('.estimate')).toHaveText('≈ ₽ 900.00');
	await expect(page.getByRole('radio', { name: /Robokassa/ })).toBeChecked();

	await page.locator('.preset', { hasText: '$ 25.00' }).click();
	await expect(summary.locator('.amount').first()).toHaveText('$ 25.00');
	await expect(summary.locator('.estimate')).toHaveText('≈ ₽ 2,250.00');

	await page.getByRole('button', { name: ru['topUp.submit'] }).click();

	const card = page.locator('.invoice-card');
	await expect(card.getByRole('heading', { name: ru['topUp.invoice.title'] })).toBeVisible();
	await expect(card.locator('.amount-value')).toHaveText('₽ 2,250.75');
	await expect(card.locator('.test-badge')).toHaveText(ru['topUp.invoice.testMode']);
	await expect(card.getByRole('link', { name: 'Оплатить ₽ 2,250.75' })).toHaveAttribute(
		'href',
		PAYMENT_URL
	);
	await expect(page.locator('.steps li[aria-current="step"]')).toContainText(
		ru['topUp.step.payment']
	);
	expect(backend.creates).toHaveLength(1);
	expect(backend.creates[0]).toMatchObject({
		paymentProcessor: 'robokassa',
		amountMinor: 2500,
		currency: 'USD'
	});
	expect(backend.creates[0].id).toMatch(UUID);
	expect(backend.checkouts).toBe(1);

	await page.reload();
	await expect(card.locator('.amount-value')).toHaveText('₽ 2,250.75');
	expect(backend.creates.map(({ id }) => id)).toEqual([
		backend.creates[0].id,
		backend.creates[0].id
	]);
	expect(backend.checkouts).toBe(1);
});

test('confirms a returned payment and refreshes the balance', async ({ page }) => {
	const backend = await mockPayments(page);
	const terms: CreateInvoiceRequest = {
		id: INVOICE_ID,
		paymentProcessor: 'robokassa',
		amountMinor: 2500,
		currency: 'USD'
	};
	await page.addInitScript(
		([key, value]) => localStorage.setItem(key, value),
		[`cadbos.top-up.v1.${PK}`, JSON.stringify(terms)]
	);
	backend.invoice = {
		id: INVOICE_ID,
		paymentProcessor: 'robokassa',
		amountMinor: 2500,
		currency: 'USD',
		status: 'open',
		createdAt: 1,
		updatedAt: 1,
		paidAt: null,
		checkout: checkout(225075)
	};
	backend.settleOnRead = true;

	await page.goto('/top-up?InvId=7340032&OutSum=2250.75&SignatureValue=abc&Culture=ru');

	await expect(page.getByRole('heading', { name: ru['topUp.paid.title'] })).toBeVisible();
	await expect(page.getByText('Зачислено $ 25.00.')).toBeVisible();
	await expect(page.locator('.balance-value')).toHaveText('$ 29.50');
	await expect(page).toHaveURL(/\/top-up$/);
	expect(backend.meRequests).toBeGreaterThanOrEqual(2);

	await page.getByRole('button', { name: ru['topUp.paid.another'] }).click();
	await expect(page.getByRole('button', { name: ru['topUp.submit'] })).toBeEnabled();
	await expect(page.locator('.amount-input')).toHaveValue('25');
});

test('starts a new top-up when the provider returns without a retained invoice', async ({
	page
}) => {
	const backend = await mockPayments(page);
	await page.goto('/top-up?InvId=7340032&OutSum=2250.75&SignatureValue=abc&Culture=ru');

	await expect(page.getByRole('button', { name: ru['topUp.submit'] })).toBeEnabled();
	await expect(page).toHaveURL(/\/top-up$/);
	expect(backend.reads).toBe(0);
	expect(backend.creates).toHaveLength(0);
});

test('checks payment from the invoice card', async ({ page }) => {
	const backend = await mockPayments(page);
	await page.goto('/top-up');
	await page.getByRole('button', { name: ru['topUp.submit'] }).click();
	await expect(page.locator('.invoice-card')).toBeVisible();

	backend.settleOnRead = true;
	await page.getByRole('button', { name: ru['topUp.invoice.check'] }).click();

	await expect(page.getByRole('heading', { name: ru['topUp.paid.title'] })).toBeVisible();
	await expect(page.locator('.steps li[aria-current="step"]')).toContainText(ru['topUp.step.done']);
});

test('cancels an invoice and keeps the chosen terms editable', async ({ page }) => {
	const backend = await mockPayments(page);
	await page.goto('/top-up');
	await page.locator('.amount-input').fill('12,5');
	await expect(page.locator('.summary .amount').first()).toHaveText('$ 12.50');
	await page.getByRole('button', { name: ru['topUp.submit'] }).click();
	await expect(page.locator('.invoice-card')).toBeVisible();

	await page.getByRole('button', { name: ru['topUp.invoice.cancel'] }).click();

	await expect(page.getByRole('button', { name: ru['topUp.submit'] })).toBeEnabled();
	await expect(page.locator('.amount-input')).toHaveValue('12,5');
	expect(backend.cancels).toBe(1);

	backend.invoice = null;
	await page.getByRole('button', { name: ru['topUp.submit'] }).click();
	await expect(page.locator('.invoice-card')).toBeVisible();
	expect(backend.creates[1].id).not.toBe(backend.creates[0].id);
});

test('rejects malformed amounts', async ({ page }) => {
	await mockPayments(page);
	await page.goto('/top-up');
	const input = page.locator('.amount-input');

	for (const value of ['abc', '0', '1.234']) {
		await input.fill(value);
		await expect(page.getByText(ru['topUp.amount.invalid'])).toBeVisible();
		await expect(input).toHaveAttribute('aria-invalid', 'true');
		await expect(page.getByRole('button', { name: ru['topUp.submit'] })).toBeDisabled();
	}
});

test('retries creation with the same invoice ID after a network failure', async ({ page }) => {
	const backend = await mockPayments(page);
	backend.createFailure = 'network';
	await page.goto('/top-up');
	await page.getByRole('button', { name: ru['topUp.submit'] }).click();

	await expect(page.getByRole('alert')).toHaveText(ru['topUp.error.network']);
	await expect(page.locator('.amount-input')).toBeDisabled();
	await page.getByRole('button', { name: ru['topUp.submitRetry'] }).click();

	await expect(page.locator('.invoice-card')).toBeVisible();
	expect(backend.creates).toHaveLength(2);
	expect(backend.creates[1].id).toBe(backend.creates[0].id);
});

test('explains a funding restriction', async ({ page }) => {
	const backend = await mockPayments(page);
	backend.createFailure = { status: 403, code: 'funding_restricted' };
	await page.goto('/top-up');
	await page.getByRole('button', { name: ru['topUp.submit'] }).click();

	await expect(page.getByRole('alert')).toHaveText(ru['topUp.error.fundingRestricted']);
	expect(backend.checkouts).toBe(0);
});

test('explains the test deposit limit at checkout', async ({ page }) => {
	const backend = await mockPayments(page);
	backend.checkoutFailure = { status: 403, code: 'test_deposit_limit_exceeded' };
	await page.goto('/top-up');
	await page.getByRole('button', { name: ru['topUp.submit'] }).click();

	await expect(page.getByRole('alert')).toHaveText(ru['topUp.error.testDepositLimit']);
	await page.getByRole('button', { name: ru['topUp.invoice.cancel'] }).click();
	await expect(page.locator('.amount-input')).toBeEnabled();
	expect(backend.cancels).toBe(1);
});

test('limits amounts to the remaining test deposit allowance', async ({ page }) => {
	const backend = await mockPayments(page);
	backend.maxAmountMinor = 2500;
	await page.goto('/top-up');

	const method = page.locator('.method', { hasText: 'Robokassa' });
	await expect(method.locator('.method-limit')).toHaveText('Доступно до $ 25.00');
	await expect(page.getByRole('radio', { name: '$ 50.00', exact: true })).toBeDisabled();
	await expect(page.getByRole('radio', { name: '$ 100.00', exact: true })).toBeDisabled();
	await expect(page.getByRole('radio', { name: '$ 25.00', exact: true })).toBeEnabled();

	await page.locator('.amount-input').fill('30');
	await expect(page.locator('#top-up-amount-error')).toHaveText(
		'Этим способом сейчас можно пополнить не более чем на $ 25.00.'
	);
	await expect(page.getByRole('button', { name: ru['topUp.submit'] })).toBeDisabled();

	await page.locator('.preset', { hasText: '$ 25.00' }).click();
	await expect(page.locator('#top-up-amount-error')).toHaveCount(0);
	await page.getByRole('button', { name: ru['topUp.submit'] }).click();
	await expect(page.locator('.invoice-card')).toBeVisible();
	expect(backend.creates[0].amountMinor).toBe(2500);
});

test('blocks a processor whose deposit allowance is used up', async ({ page }) => {
	const backend = await mockPayments(page);
	backend.maxAmountMinor = 0;
	await page.goto('/top-up');

	await expect(page.locator('.method-limit')).toHaveText(ru['topUp.method.limitReached']);
	await expect(page.getByRole('radio', { name: /Robokassa/ })).toBeDisabled();
	await expect(page.getByRole('button', { name: ru['topUp.submit'] })).toBeDisabled();
});

test('hides top-up for accounts awaiting approval', async ({ page }) => {
	await mockPayments(page, false);
	await page.goto('/top-up');

	await expect(page.getByText(ru['topUp.notApproved'])).toBeVisible();
	await expect(page.locator('.top-up-form')).toHaveCount(0);
	await page.locator('.auth-trigger').click();
	await expect(page.locator('.top-up-link')).toHaveCount(0);
});

test('opens top-up from the profile panel and expenses page', async ({ page }) => {
	await mockPayments(page);
	await page.goto('/expenses');
	await page.getByRole('link', { name: ru['expenses.topUp'] }).click();
	await expect(page).toHaveURL(/\/top-up$/);

	await page.goto('/');
	await page.locator('.auth-trigger').click();
	await page.getByRole('link', { name: ru['auth.credit.topUp'] }).click();
	await expect(page).toHaveURL(/\/top-up$/);
	await expect(page.getByRole('heading', { name: ru['topUp.title'] })).toBeVisible();
});
