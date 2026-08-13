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

import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import type { CreditInfo } from '$lib/api/contract';

async function restoreApprovedSession(page: Page, credit: CreditInfo): Promise<void> {
	await page.route('**/auth/me', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				user: {
					pubkey: '0'.repeat(64),
					firstName: 'Ada',
					lastName: 'Lovelace'
				},
				credit
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

test('restores the existing session after authentication storage recovers', async ({ page }) => {
	let attempts = 0;
	await page.route('**/auth/me', async (route) => {
		attempts += 1;
		if (attempts === 1) {
			await route.fulfill({
				status: 503,
				contentType: 'application/json',
				headers: { 'retry-after': '0' },
				body: JSON.stringify({
					error: {
						code: 'authentication_unavailable',
						message: 'Authentication service temporarily unavailable'
					}
				})
			});
			return;
		}

		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				user: {
					pubkey: '0'.repeat(64),
					firstName: 'Ada',
					lastName: 'Lovelace'
				}
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

	await page.goto('/');

	await expect(page.locator('.auth').getByRole('status')).toHaveText('Восстанавливаем сессию…');
	await expect(page.getByRole('button', { name: 'Войти', exact: true })).toHaveCount(0);
	await expect.poll(() => attempts).toBe(2);
	await expect(page.locator('.profile-toggle')).toBeVisible();
});

test('shows sign-in only after session restoration receives an unauthorized response', async ({
	page
}) => {
	let attempts = 0;
	await page.route('**/auth/me', async (route) => {
		attempts += 1;
		if (attempts === 1) {
			await route.fulfill({
				status: 503,
				contentType: 'application/json',
				headers: { 'retry-after': '0' },
				body: JSON.stringify({
					error: {
						code: 'authentication_unavailable',
						message: 'Authentication service temporarily unavailable'
					}
				})
			});
			return;
		}

		await route.fulfill({
			status: 401,
			contentType: 'application/json',
			body: JSON.stringify({
				error: { code: 'unauthorized', message: 'Authentication required' }
			})
		});
	});

	await page.goto('/');

	await expect(page.locator('.auth').getByRole('status')).toHaveText('Восстанавливаем сессию…');
	await expect(page.getByRole('button', { name: 'Войти', exact: true })).toHaveCount(0);
	await expect.poll(() => attempts).toBe(2);
	await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible();
});
