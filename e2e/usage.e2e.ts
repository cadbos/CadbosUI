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

import { expect, test } from '@playwright/test';
import { npubEncode } from 'nostr-tools/nip19';

test('links usage pubkeys to Primal in a new tab by default', async ({ page }) => {
	const pubkey = 'a'.repeat(64);
	const pubkeyWithoutPicture = 'b'.repeat(64);
	const npub = npubEncode(pubkey);
	const npubWithoutPicture = npubEncode(pubkeyWithoutPicture);

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
						generationCount: 0,
						totalSpend: 0,
						latestSpendAt: null
					},
					{
						pubkey: pubkeyWithoutPicture,
						balance: 0,
						totalDeposit: 0,
						lastDepositAt: null,
						generationCount: 0,
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

	await expect(page.getByRole('columnheader', { name: 'Пользователь' })).toBeVisible();
	await expect(user.locator('img')).toHaveAttribute('src', 'https://avatar.example/alice.svg');
	await expect(userWithoutPicture.locator('.avatar')).toHaveText('B');
	await expect(link).toHaveAttribute('href', `https://primal.net/p/${npub}`);
	await expect(link).toHaveAttribute('target', '_blank');
	await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
});
