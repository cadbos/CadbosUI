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
import type { CreditInfo } from '$lib/api/contract';

const depositId = '91d9b4a8-38be-4dc3-9dc5-81ce9fb368bb';

async function restoreApprovedSession(
	page: Page,
	credit: CreditInfo | (() => CreditInfo)
): Promise<void> {
	await page.route('**/auth/me', async (route) => {
		const currentCredit = typeof credit === 'function' ? credit() : credit;
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				user: {
					pubkey: '0'.repeat(64),
					firstName: 'Ada',
					lastName: 'Lovelace'
				},
				credit: currentCredit
			})
		});
	});
	await page.route('**/auth/nostr-profile', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ profile: { name: 'Ada', relays: [] } })
		});
	});
}

test('shows rounded object-replacement credit history', async ({ page }) => {
	await restoreApprovedSession(page, {
		balance: 4.9399999999999995,
		updatedAt: 3,
		history: [
			{
				id: 'txn-1',
				amount: 0.06,
				balanceAfter: 4.9399999999999995,
				kind: 'object-replacement',
				createdAt: 1
			}
		]
	});
	await page.goto('/');

	await page.locator('.profile-toggle').click();
	const profile = page.locator('#auth-profile');
	const history = profile.locator('.credit-history');
	await expect(profile.getByText('Баланс: 4.94')).toBeVisible();
	await history.getByText('История трат').click();
	await expect(history.getByText(/Замена объекта/)).toBeVisible();
	await expect(history.getByText(/−0\.06 → 4\.94/)).toBeVisible();
});

test('shows restored texture-replacement credit history', async ({ page }) => {
	await restoreApprovedSession(page, {
		balance: 10,
		updatedAt: 4,
		history: [
			{
				id: 'txn-2',
				amount: 1.2,
				balanceAfter: 10,
				kind: 'texture-replacement',
				createdAt: 2
			}
		]
	});
	await page.goto('/');

	await page.locator('.profile-toggle').click();
	const history = page.locator('#auth-profile .credit-history');
	await history.getByText('История трат').click();
	await expect(history.getByText(/Замена текстуры/)).toBeVisible();
});

test('creates and settles a Lightning top-up', async ({ page }) => {
	let meRequests = 0;
	let statusRequests = 0;
	let requestBody: unknown = null;
	await restoreApprovedSession(page, () => {
		meRequests += 1;
		return {
			balance: meRequests > 1 ? 10 : 1,
			updatedAt: meRequests,
			history: []
		};
	});
	await page.route('**/api/packages', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				packages: [{ id: 'credits-9', usdAmount: 3, creditsAwarded: 9 }]
			})
		});
	});
	await page.route('**/api/deposits', async (route) => {
		requestBody = route.request().postDataJSON();
		await route.fulfill({
			status: 201,
			contentType: 'application/json',
			body: JSON.stringify({
				id: depositId,
				status: 'pending',
				bolt11: 'lnbc3000n1cadbostestinvoice',
				satsAmount: 300,
				usdAmount: 3,
				expiresAt: Date.now() + 15 * 60 * 1_000
			})
		});
	});
	await page.route(`**/api/deposits/${depositId}`, async (route) => {
		statusRequests += 1;
		await route.fulfill({
			status: 200,
			headers: { 'retry-after': '0' },
			contentType: 'application/json',
			body: JSON.stringify(
				statusRequests === 1
					? {
							id: depositId,
							status: 'pending',
							bolt11: 'lnbc3000n1cadbostestinvoice',
							satsAmount: 300,
							usdAmount: 3,
							expiresAt: Date.now() + 15 * 60 * 1_000
						}
					: { id: depositId, status: 'paid', balance: 10 }
			)
		});
	});

	await page.goto('/');
	await page.getByRole('button', { name: 'Пополнить' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByRole('button', { name: /9 кредитов/ }).click();
	await dialog.getByRole('button', { name: 'Создать счёт' }).click();

	await expect(dialog.getByRole('img', { name: 'QR-код счёта Lightning' })).toBeVisible();
	await expect(dialog.getByText('Оплата получена')).toBeVisible();
	await expect.poll(() => meRequests).toBeGreaterThan(1);
	expect(requestBody).toEqual({
		requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
		packageId: 'credits-9'
	});

	await dialog.getByRole('button', { name: 'Закрыть окно пополнения' }).click();
	await page.locator('.profile-toggle').click();
	await expect(page.locator('#auth-profile').getByText('Баланс: 10')).toBeVisible();
});
