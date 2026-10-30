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

import { readFile } from 'node:fs/promises';
import type { Locator, Page } from '@playwright/test';

import { expect, test } from './fixtures';
import type { CreditInfo } from '$lib/api/contract';
import { en } from '$lib/i18n/locales/en';
import { ru } from '$lib/i18n/locales/ru';

for (const locale of ['ru', 'en'] as const) {
	const dictionary = locale === 'ru' ? ru : en;
	for (const approved of [false, true]) {
		test(`creates an account in ${locale} after saving its key and restores ${approved ? 'ledger credit' : 'an unapproved account'}`, async ({
			page
		}) => {
			await page.addInitScript((locale) => {
				localStorage.setItem('cadbos.locale.v1', locale);
			}, locale);
			let pubkey = '';
			let verified = false;
			const credit: CreditInfo | undefined = approved
				? {
						balance: -1.5,
						updatedAt: 3,
						history: [
							{
								id: '103',
								generationId: null,
								amount: 3.5,
								balanceAfter: -1.5,
								kind: null,
								createdAt: 3,
								comfyuiUploadQueueSec: 0,
								comfyuiQueueWaitSec: 0,
								comfyuiExecutionSec: 0,
								comfyuiDownloadSec: 0,
								comfyuiReuploadSec: 0,
								archaiRenderSec: 0,
								archaiDownloadSec: 0,
								archaiReuploadSec: 0,
								sessionId: null,
								projectId: null
							}
						]
					}
				: undefined;
			await page.route('**/auth/me', async (route) => {
				await route.fulfill({
					status: verified ? 200 : 401,
					json: verified ? { user: { pubkey }, featurebaseJwt: null, credit } : {}
				});
			});
			await page.route('**/auth/challenge', async (route) => {
				const body = route.request().postDataJSON() as { pubkey: string };
				pubkey = body.pubkey;
				expect(pubkey).toMatch(/^[0-9a-f]{64}$/);
				await route.fulfill({ json: { challenge: '1'.repeat(64) } });
			});
			await page.route('**/auth/verify', async (route) => {
				const header = route.request().headers()['authorization'];
				expect(header).toMatch(/^Nostr /);
				const event = JSON.parse(Buffer.from(header.slice(6), 'base64').toString('utf8')) as {
					pubkey: string;
					kind: number;
				};
				expect(event.pubkey).toBe(pubkey);
				expect(event.kind).toBe(27235);
				verified = true;
				await route.fulfill({ json: { user: { pubkey }, featurebaseJwt: null } });
			});
			await page.route('**/auth/nostr-profile', async (route) => {
				await route.fulfill({ json: { profile: { relays: [] } } });
			});
			await page.goto('/');
			await page.locator('.auth-trigger').click();
			await page.getByRole('button', { name: dictionary['auth.setup.open'], exact: true }).click();
			const dialog = page.getByRole('dialog');
			await expect(dialog).toContainText(dictionary['auth.setup.introPublic']);
			await dialog
				.getByRole('button', { name: dictionary['auth.setup.createKeys'], exact: true })
				.click();
			const finish = dialog.getByRole('button', {
				name: dictionary['auth.setup.finish'],
				exact: true
			});
			await expect(finish).toBeDisabled();
			const checkboxes = dialog.getByRole('checkbox');
			for (const checkbox of await checkboxes.all()) await checkbox.check();
			await expect(finish).toBeEnabled();
			expect(verified).toBe(false);
			const downloadPromise = page.waitForEvent('download');
			await dialog
				.getByRole('button', { name: dictionary['auth.setup.download'], exact: true })
				.click();
			const download = await downloadPromise;
			expect(download.suggestedFilename()).toBe(
				locale === 'ru' ? 'ИИ дизайн-ключ-аккаунта.txt' : 'AI design-account-key.txt'
			);
			const keyFile = await readFile(await download.path(), 'utf8');
			expect(keyFile.split('\n')[0]).toBe(dictionary['auth.setup.fileTitle']);
			expect(keyFile.trimEnd().split('\n').at(-1)).toBe(dictionary['auth.setup.fileWarning']);
			await finish.click();
			await expect(dialog).not.toBeVisible();
			await expect(page.locator('#auth-panel .balance-link')).toContainText(
				approved ? '-1.50' : '0.00'
			);
			expect(await page.evaluate(() => localStorage.getItem('cadbos.localAccountKey'))).toBeNull();
			if (approved) {
				await page.locator('#auth-panel .balance-link').click();
				await expect(page.locator('.history-entry')).toContainText('3.50');
				await expect(page.locator('button.history-entry')).toHaveCount(0);
			}
		});
	}
}

async function restoreApprovedSession(page: Page, credit?: CreditInfo): Promise<void> {
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
				featurebaseJwt: null,
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

test('shows rounded object-replacement credit history on the expenses page', async ({ page }) => {
	await restoreApprovedSession(page, {
		balance: 4.9399999999999995,
		updatedAt: 3,
		history: [
			{
				id: '101',
				generationId: '00000000-0000-4000-8000-000000000001',
				amount: 0.06,
				balanceAfter: 4.9399999999999995,
				kind: 'object-replacement',
				createdAt: 1,
				comfyuiUploadQueueSec: 1,
				comfyuiQueueWaitSec: 1,
				comfyuiExecutionSec: 4,
				comfyuiDownloadSec: 1,
				comfyuiReuploadSec: 1,
				archaiRenderSec: 0,
				archaiDownloadSec: 0,
				archaiReuploadSec: 0,
				sessionId: null,
				projectId: null
			}
		]
	});
	await page.goto('/');

	await page.locator('.auth-trigger').click();
	const profile = page.locator('#auth-panel');
	const balanceLink = profile.getByRole('link', { name: /Баланс: 4\.94/ });
	await expect(balanceLink).toBeVisible();
	await balanceLink.click();

	await expect(page).toHaveURL('/expenses');
	const historyEntry = page.locator('.history-entry', { hasText: 'Замена объекта' });
	await expect(historyEntry).toBeVisible();
	await expect(historyEntry.getByText('0.06')).toBeVisible();
});

test('shows restored texture-replacement credit history on the expenses page', async ({ page }) => {
	await restoreApprovedSession(page, {
		balance: 10,
		updatedAt: 4,
		history: [
			{
				id: '102',
				generationId: '00000000-0000-4000-8000-000000000002',
				amount: 1.2,
				balanceAfter: 10,
				kind: 'texture-replacement',
				createdAt: 2,
				comfyuiUploadQueueSec: 0,
				comfyuiQueueWaitSec: 0,
				comfyuiExecutionSec: 0,
				comfyuiDownloadSec: 0,
				comfyuiReuploadSec: 0,
				archaiRenderSec: 0,
				archaiDownloadSec: 0,
				archaiReuploadSec: 0,
				sessionId: null,
				projectId: null
			}
		]
	});
	await page.goto('/expenses');

	await expect(page.getByText(/Замена текстуры/)).toBeVisible();
});

test('shows a zero balance and links to the expenses page for an unapproved account', async ({
	page
}) => {
	await restoreApprovedSession(page);
	await page.goto('/');

	await page.locator('.auth-trigger').click();
	const profile = page.locator('#auth-panel');
	await expect(profile.getByRole('link', { name: /Баланс: 0\.00/ })).toBeVisible();
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
				},
				featurebaseJwt: null
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

	// The trigger is always rendered, so open the panel first — while restoring it
	// still shows the guest label, not a real user's name.
	await page.locator('.auth-trigger').click();
	await expect(page.locator('.auth').getByRole('status')).toHaveText('Восстанавливаем сессию…');
	await expect(page.getByRole('button', { name: 'Гость' })).toBeVisible();

	await expect.poll(() => attempts).toBe(2);
	await expect(page.getByRole('button', { name: /Ada/ })).toBeVisible();
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

	// The trigger is always rendered, so open the panel first — while restoring it
	// still shows the guest label, not a real user's name.
	await page.locator('.auth-trigger').click();
	await expect(page.locator('.auth').getByRole('status')).toHaveText('Восстанавливаем сессию…');
	await expect(page.getByRole('button', { name: 'Гость' })).toBeVisible();

	await expect.poll(() => attempts).toBe(2);
	await expect(page.getByRole('button', { name: 'Расширение Nostr' })).toBeVisible();
});

async function openProfilePanel(page: Page): Promise<Locator> {
	await page.locator('.auth-trigger').click();
	return page.locator('#auth-panel');
}

test('applies the chosen language and returns focus to its trigger', async ({ page }) => {
	await restoreApprovedSession(page);
	await page.goto('/');

	const profile = await openProfilePanel(page);
	const trigger = profile.locator('.language-trigger');

	await trigger.click();
	await expect(trigger).toHaveAttribute('aria-expanded', 'true');
	await profile.getByRole('button', { name: 'English' }).click();

	await expect(profile.getByRole('link', { name: /Balance: 0\.00/ })).toBeVisible();
	await expect(trigger).toHaveAttribute('aria-expanded', 'false');
	await expect(trigger).toBeFocused();
});

test('applies the chosen currency and returns focus to its trigger', async ({ page }) => {
	await page.route('**/api/exchange-rate', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ rubPerUsd: 100, asOf: '2026-08-12T10:00:00.000Z' })
		});
	});
	await restoreApprovedSession(page, { balance: 4.94, updatedAt: 1, history: [] });
	await page.goto('/');

	const profile = await openProfilePanel(page);
	const trigger = profile.locator('.currency-trigger');

	await expect(profile.getByRole('link', { name: /Баланс: 4\.94 \$/ })).toBeVisible();
	await trigger.click();
	await expect(trigger).toHaveAttribute('aria-expanded', 'true');
	await profile.getByRole('button', { name: '₽ RUB' }).click();

	await expect(profile.getByRole('link', { name: /Баланс: 494\.00 ₽/ })).toBeVisible();
	await expect(trigger).toHaveAttribute('aria-expanded', 'false');
	await expect(trigger).toBeFocused();
});

test('applies the chosen theme and returns focus to its trigger', async ({ page }) => {
	await restoreApprovedSession(page);
	await page.goto('/');

	const profile = await openProfilePanel(page);
	const trigger = profile.getByRole('button', { name: 'Тема оформления' });

	await trigger.click();
	await expect(trigger).toHaveAttribute('aria-expanded', 'true');
	await profile.getByRole('button', { name: 'Тёмная' }).click();

	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	await expect(trigger).toHaveAttribute('aria-expanded', 'false');
	await expect(trigger).toBeFocused();
});

test('shows the relay-count hint above its icon on hover and hides it on leave', async ({
	page
}) => {
	await restoreApprovedSession(page);
	await page.goto('/');

	const profile = await openProfilePanel(page);
	const icon = profile.locator('.relay-count').getByRole('button');
	const bubble = page.locator('.hint-bubble');

	await icon.hover();
	await expect(bubble).toBeVisible();
	await expect(bubble).toContainText('Количество релеев из вашего личного списка');

	const iconBox = await icon.boundingBox();
	const bubbleBox = await bubble.boundingBox();
	expect(bubbleBox!.y + bubbleBox!.height).toBeLessThanOrEqual(iconBox!.y);

	await page.mouse.move(0, 0);
	await expect(bubble).toHaveCount(0);
});

test('shows the relay-count hint on keyboard focus and hides it on blur', async ({ page }) => {
	await restoreApprovedSession(page);
	await page.goto('/');

	const profile = await openProfilePanel(page);
	const icon = profile.locator('.relay-count').getByRole('button');
	const bubble = page.locator('.hint-bubble');

	await icon.focus();
	await expect(bubble).toBeVisible();

	await icon.blur();
	await expect(bubble).toHaveCount(0);
});
