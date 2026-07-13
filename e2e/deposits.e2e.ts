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

import { expect, test, type Page } from '@playwright/test';

const pubkey = '0'.repeat(64);

async function mockAuthenticatedSession(page: Page, paid: { value: boolean }): Promise<void> {
	await page.route('**/auth/me', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				user: { pubkey, firstName: 'Ada', lastName: 'Lovelace' },
				credit: {
					balance: paid.value ? 3 : 0,
					updatedAt: Date.UTC(2026, 0, 1),
					history: []
				}
			})
		});
	});
	await page.route('**/auth/nostr-profile', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ profile: { relays: [] } })
		});
	});
}

function openTopUpDialog(page: Page): ReturnType<Page['getByRole']> {
	return page.getByRole('dialog', { name: 'Пополнение баланса' });
}

test('buys a package: picks it, pays the invoice, and sees the balance update', async ({
	page
}) => {
	const paid = { value: false };
	let statusPolls = 0;
	await mockAuthenticatedSession(page, paid);
	await page.route('**/api/packages', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				packages: [
					{ id: 'pkg-1', usdAmount: 1, creditsAwarded: 3 },
					{ id: 'pkg-5', usdAmount: 5, creditsAwarded: 15 }
				]
			})
		});
	});
	await page.route('**/api/deposits', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				id: 'deposit-1',
				status: 'pending',
				bolt11: 'lnbc15860n1ptest0000000000000000000000000000000000000000000000000',
				satsAmount: 1586,
				usdAmount: 1,
				expiresAt: Date.now() + 600_000
			})
		});
	});
	await page.route('**/api/deposits/deposit-1', async (route) => {
		statusPolls += 1;
		if (statusPolls >= 2) paid.value = true;
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				id: 'deposit-1',
				status: paid.value ? 'paid' : 'pending',
				bolt11: 'lnbc15860n1ptest0000000000000000000000000000000000000000000000000',
				satsAmount: 1586,
				usdAmount: 1,
				expiresAt: Date.now() + 600_000,
				...(paid.value ? { balance: 3 } : {})
			})
		});
	});

	await page.goto('/');
	await page.locator('button[aria-controls="auth-profile"]').click();
	await expect(page.getByText('Баланс: 0.00')).toBeVisible();

	await page.getByRole('button', { name: 'Пополнить' }).click();
	const dialog = openTopUpDialog(page);
	await expect(dialog).toBeVisible();
	await expect(dialog.getByText('$1')).toBeVisible();
	await expect(dialog.getByText('$5')).toBeVisible();

	await dialog.getByRole('button', { name: /\$1/ }).click();

	await expect(dialog.getByText('Отсканируйте для оплаты')).toBeVisible();
	await expect(dialog.getByRole('img', { name: 'QR-код Lightning-счёта' })).toBeVisible();
	await expect(dialog.getByText('lnbc15860n1ptest')).toBeVisible();
	await expect(dialog.getByText('1586 сат')).toBeVisible();
	await expect(dialog.getByText('Ожидание оплаты…')).toBeVisible();

	await expect(dialog.getByText('Оплата получена! Баланс пополнен.')).toBeVisible({
		timeout: 10_000
	});
	expect(statusPolls).toBeGreaterThanOrEqual(2);

	// The paid screen's own close button, not the header's icon-close "×" (it
	// shares the same accessible name) — this is the one that's autofocused.
	await dialog.locator('button:not(.icon-close)', { hasText: 'Закрыть' }).click();
	await expect(dialog).toHaveCount(0);
	await expect(page.getByText('Баланс: 3.00')).toBeVisible();
});

test('shows a friendly message when no packages are configured yet', async ({ page }) => {
	const paid = { value: false };
	await mockAuthenticatedSession(page, paid);
	await page.route('**/api/packages', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ packages: [] })
		});
	});

	await page.goto('/');
	await page.locator('button[aria-controls="auth-profile"]').click();
	await page.getByRole('button', { name: 'Пополнить' }).click();

	await expect(openTopUpDialog(page).getByText('Пакеты пока недоступны')).toBeVisible();
});

test('lets the buyer recover from a failed package list without reloading', async ({ page }) => {
	const paid = { value: false };
	await mockAuthenticatedSession(page, paid);
	let packagesCalls = 0;
	await page.route('**/api/packages', async (route) => {
		packagesCalls += 1;
		if (packagesCalls === 1) {
			await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
			return;
		}
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ packages: [{ id: 'pkg-1', usdAmount: 1, creditsAwarded: 3 }] })
		});
	});

	await page.goto('/');
	await page.locator('button[aria-controls="auth-profile"]').click();
	await page.getByRole('button', { name: 'Пополнить' }).click();

	const dialog = openTopUpDialog(page);
	await expect(dialog.getByText('Не удалось загрузить пакеты')).toBeVisible();

	await dialog.getByRole('button', { name: 'Попробовать снова' }).click();

	await expect(dialog.getByText('$1')).toBeVisible();
	expect(packagesCalls).toBe(2);
});
