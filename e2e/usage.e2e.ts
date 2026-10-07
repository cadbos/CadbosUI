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
import { npubEncode } from 'nostr-tools/nip19';
import { ru } from '$lib/i18n/locales/ru';

import { expect, test } from './fixtures';

// /usage now gates its fetch on the client auth store (fix/usage-auth-status-desync),
// not just the session cookie — so every scenario needs a signed-in session mocked,
// the same way workspace.e2e.ts does for its own authenticated-only assertions.
async function mockAuthenticatedSession(page: Page): Promise<void> {
	await page.route('**/auth/me', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				user: { pubkey: '0'.repeat(64), firstName: 'Ada', lastName: 'Lovelace' }
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

test('links usage pubkeys to Primal in a new tab by default', async ({ page }) => {
	await mockAuthenticatedSession(page);
	const pubkey = 'a'.repeat(64);
	const pubkeyWithoutPicture = 'b'.repeat(64);
	const npub = npubEncode(pubkey);
	const npubWithoutPicture = npubEncode(pubkeyWithoutPicture);
	const quotaDate = '2026-10-07';

	await page.route('**/api/usage**', async (route) => {
		if (new URL(route.request().url()).pathname === '/api/usage/profiles') {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					profiles: {
						[pubkey]: { name: 'Alice', picture: 'https://avatar.example/alice.svg' },
						[pubkeyWithoutPicture]: { name: 'Bob' }
					}
				})
			});
			return;
		}

		if (new URL(route.request().url()).pathname === '/api/usage/balance') {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ balance: 250 })
			});
			return;
		}

		if (new URL(route.request().url()).pathname === '/api/usage/totals') {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					userCount: 2,
					projectCount: 2,
					sessionCount: 2,
					generationCount: 0,
					sourceCount: 2,
					sourceBytes: 3 * 1024 * 1024,
					referenceCount: 0,
					referenceBytes: null,
					totalSpend: 12.5
				})
			});
			return;
		}

		if (new URL(route.request().url()).pathname === '/api/usage/d1-limits') {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					date: quotaDate,
					rowsRead: 5_000_000,
					rowsWritten: 100,
					readLimit: 5_000_000,
					writeLimit: 100_000
				})
			});
			return;
		}

		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				users: [
					{
						pubkey,
						balance: 0,
						totalDeposit: 0,
						lastDepositAt: null,
						projectCount: 1,
						sessionCount: 1,
						generationCount: 0,
						sourceCount: 2,
						sourceBytes: 3 * 1024 * 1024,
						referenceCount: 0,
						referenceBytes: null,
						totalSpend: 0,
						latestSpendAt: null
					},
					{
						pubkey: pubkeyWithoutPicture,
						balance: 0,
						totalDeposit: 0,
						lastDepositAt: null,
						projectCount: 1,
						sessionCount: 1,
						generationCount: 0,
						sourceCount: 0,
						sourceBytes: null,
						referenceCount: 0,
						referenceBytes: null,
						totalSpend: 0,
						latestSpendAt: null
					}
				],
				pagination: { offset: 0, size: 20, hasMore: false }
			})
		});
	});
	await page.route('https://avatar.example/alice.svg', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'image/svg+xml',
			body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" />'
		});
	});

	await page.goto('/usage');

	const link = page.getByRole('link', { name: npub });
	const user = page.getByRole('rowheader', { name: npub });
	const userWithoutPicture = page.getByRole('rowheader', { name: npubWithoutPicture });

	await expect(page.getByRole('columnheader', { name: ru['usage.column.user'] })).toBeVisible();
	await expect(
		page.getByRole('columnheader', { name: ru['usage.column.sourceBytes'] })
	).toBeVisible();
	await expect(
		page.getByRole('columnheader', { name: ru['usage.column.referenceBytes'] })
	).toBeVisible();
	const sourceSize = new Intl.NumberFormat('ru', {
		style: 'unit',
		unit: 'megabyte',
		unitDisplay: 'short'
	}).format(3);
	await expect(page.getByRole('cell', { name: sourceSize })).toBeVisible();
	const totals = page.getByRole('region', { name: ru['usage.totals.title'] });
	await expect(totals).toContainText(`${ru['usage.totals.walletBalance']} 250.00 $`);
	await expect(totals).toContainText(`${ru['usage.totals.deposits']} ${ru['usage.emptyValue']}`);
	await expect(totals).toContainText(`${ru['usage.totals.spend']} 12.50 $`);
	await expect(totals).toContainText(`${ru['usage.totals.users']} 2`);
	const readQuota = totals
		.getByText(ru['usage.totals.d1RowsRead'].replace('{date}', quotaDate))
		.locator('..');
	const writeQuota = totals
		.getByText(ru['usage.totals.d1RowsWritten'].replace('{date}', quotaDate))
		.locator('..');
	const number = new Intl.NumberFormat('ru');
	await expect(readQuota.locator('.d1-used')).toHaveText(number.format(5_000_000));
	await expect(readQuota.locator('.d1-limit')).toHaveText(number.format(5_000_000));
	await expect(writeQuota.locator('.d1-used')).toHaveText(number.format(100));
	await expect(writeQuota.locator('.d1-limit')).toHaveText(number.format(100_000));
	for (const quota of [readQuota, writeQuota]) {
		await expect(quota.locator('.d1-divider')).toHaveText(ru['usage.totals.d1DivisionSign']);
		const layout = await quota.locator('.d1-quotient').evaluate((element) => {
			const used = element.querySelector('.d1-used')!.getBoundingClientRect();
			const divider = element.querySelector('.d1-divider')!.getBoundingClientRect();
			const limit = element.querySelector('.d1-limit')!.getBoundingClientRect();
			return {
				rightEdgeDifference: Math.abs(used.right - limit.right),
				dividerLeftOfValues: divider.right < Math.min(used.left, limit.left),
				verticalCenterDifference: Math.abs(
					(divider.top + divider.bottom - used.top - limit.bottom) / 2
				)
			};
		});
		expect(layout.rightEdgeDifference).toBeLessThan(1);
		expect(layout.dividerLeftOfValues).toBe(true);
		expect(layout.verticalCenterDifference).toBeLessThan(1);
	}
	await expect(readQuota).toContainText(ru['usage.totals.d1LimitReached']);
	await expect(totals).toContainText(
		`${ru['usage.totals.sources']} ${ru['usage.totals.countWithSize'].replace('{count}', '2').replace('{size}', sourceSize)}`
	);
	await expect(totals).toContainText(
		`${ru['usage.totals.references']} ${ru['usage.totals.countWithSize'].replace('{count}', '0').replace('{size}', ru['usage.emptyValue'])}`
	);
	await expect(user.locator('img')).toHaveAttribute('src', 'https://avatar.example/alice.svg');
	await expect(userWithoutPicture.locator('.avatar')).toHaveText('B');
	await expect(link).toHaveAttribute('href', `https://primal.net/profile/${npub}`);
	await expect(link).toHaveAttribute('target', '_blank');
	await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
});

test('shows an error message when the wallet balance cannot be loaded', async ({ page }) => {
	await mockAuthenticatedSession(page);
	await page.route('**/api/usage**', async (route) => {
		const pathname = new URL(route.request().url()).pathname;

		if (pathname === '/api/usage/balance') {
			await route.fulfill({ status: 502 });
			return;
		}

		if (pathname === '/api/usage/totals') {
			await route.fulfill({ status: 500 });
			return;
		}

		if (pathname === '/api/usage/d1-limits') {
			await route.fulfill({ status: 503 });
			return;
		}

		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(
				pathname === '/api/usage/profiles'
					? { profiles: {} }
					: { users: [], pagination: { offset: 0, size: 20, hasMore: false } }
			)
		});
	});

	await page.goto('/usage');

	await expect(page.getByText(ru['usage.walletBalanceFailed'])).toBeVisible();
	await expect(page.getByText(ru['usage.totals.d1Failed'])).toBeVisible();
});

test('keeps platform totals visible when D1 analytics is unavailable', async ({ page }) => {
	await mockAuthenticatedSession(page);
	await page.route('**/api/usage**', async (route) => {
		const pathname = new URL(route.request().url()).pathname;
		if (pathname === '/api/usage/d1-limits') {
			await route.fulfill({ status: 503 });
			return;
		}
		if (pathname === '/api/usage/balance') {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: '{"balance":250}'
			});
			return;
		}
		if (pathname === '/api/usage/totals') {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					userCount: 2,
					projectCount: 3,
					sessionCount: 4,
					generationCount: 5,
					sourceCount: 6,
					sourceBytes: null,
					referenceCount: 7,
					referenceBytes: null,
					totalSpend: 12.5
				})
			});
			return;
		}
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ users: [], pagination: { offset: 0, size: 20, hasMore: false } })
		});
	});

	await page.goto('/usage');

	const totals = page.getByRole('region', { name: ru['usage.totals.title'] });
	await expect(totals).toContainText(`${ru['usage.totals.spend']} 12.50 $`);
	await expect(totals).toContainText(`${ru['usage.totals.walletBalance']} 250.00 $`);
	await expect(totals).toContainText(ru['usage.totals.d1Failed']);
});
