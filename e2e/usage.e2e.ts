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
	const npub = npubEncode(pubkey);

	await page.route('**/api/usage**', async (route) => {
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
					}
				],
				pagination: { offset: 0, size: 20, hasMore: false }
			})
		});
	});

	await page.goto('/usage');

	const link = page.getByRole('link', { name: npub });
	await expect(link).toHaveAttribute('href', `https://primal.net/p/${npub}`);
	await expect(link).toHaveAttribute('target', '_blank');
	await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
});
