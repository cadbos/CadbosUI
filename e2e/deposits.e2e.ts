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
const bolt11 = 'lnbc15860n1ptest0000000000000000000000000000000000000000000000000';
const depositId = 'b71b648d-b7cf-436a-a610-b8a4099ef76a';

async function mockAuthenticatedSession(page: Page, paid: { value: boolean }): Promise<void> {
	await page.route('**/auth/me', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				user: { pubkey, firstName: 'Ada', lastName: 'Lovelace' },
				...(paid.value
					? {
							credit: {
								balance: 3,
								updatedAt: Date.UTC(2026, 0, 1),
								history: []
							}
						}
					: {})
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

function dialog(page: Page): ReturnType<Page['getByRole']> {
	return page.getByRole('dialog', { name: 'Пополнить кредиты' });
}

test('restores an in-progress payment after a page reload', async ({ page }) => {
	const paid = { value: false };
	await mockAuthenticatedSession(page, paid);
	await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
		key: `cadbos.deposit.${pubkey}`,
		value: JSON.stringify({
			requestId: '4c5aa20d-3ad0-47d4-b7f4-5d18067b672a',
			packageId: 'pkg-1',
			depositId
		})
	});
	await page.route('**/api/packages', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ packages: [{ id: 'pkg-1', usdAmount: 1, creditsAwarded: 3 }] })
		});
	});
	await page.route(`**/api/deposits/${depositId}`, async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				id: depositId,
				status: 'pending',
				bolt11,
				satsAmount: 1586,
				usdAmount: 1,
				expiresAt: Date.now() + 900_000
			})
		});
	});

	await page.goto('/');
	await page.locator('button[aria-controls="auth-profile"]').click();
	await page.getByRole('button', { name: 'Пополнить' }).click();

	await expect(dialog(page).getByText('Оплата через Lightning')).toBeVisible();
	await expect(dialog(page).getByText('1586 сатоши')).toBeVisible();
});

test('cancels a pending invoice and returns to package selection', async ({ page }) => {
	const paid = { value: false };
	await mockAuthenticatedSession(page, paid);
	await page.route('**/api/packages', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ packages: [{ id: 'pkg-1', usdAmount: 1, creditsAwarded: 3 }] })
		});
	});
	await page.route('**/api/deposits', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				id: depositId,
				status: 'pending',
				bolt11,
				satsAmount: 1586,
				usdAmount: 1,
				expiresAt: Date.now() + 900_000
			})
		});
	});
	await page.route(`**/api/deposits/${depositId}`, async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				id: depositId,
				status: 'pending',
				bolt11,
				satsAmount: 1586,
				usdAmount: 1,
				expiresAt: Date.now() + 900_000
			})
		});
	});

	await page.goto('/');
	await page.locator('button[aria-controls="auth-profile"]').click();
	await page.getByRole('button', { name: 'Пополнить' }).click();
	await dialog(page).locator('.package-grid button').first().click();
	await dialog(page).getByRole('button', { name: 'Создать счёт' }).click();

	await expect(dialog(page).getByText('Оплата через Lightning')).toBeVisible();
	await dialog(page).getByRole('button', { name: 'Отменить и выбрать другой пакет' }).click();

	await expect(dialog(page).getByRole('heading', { name: 'Выберите пакет' })).toBeVisible();
	const persisted = await page.evaluate(
		(key) => localStorage.getItem(key),
		`cadbos.deposit.${pubkey}`
	);
	expect(persisted).toBeNull();
});
