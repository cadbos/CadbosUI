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

import { expect, test, type Locator, type Page } from '@playwright/test';

test.use({
	extraHTTPHeaders: { 'x-cadbos-test-custom-workflows': 'unavailable' }
});

async function authenticate(page: Page): Promise<void> {
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
	await page.route('**/api/generated-images**', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ images: [], pagination: { offset: 0, size: 100, hasMore: false } })
		});
	});
}

async function expectAllDisabled(controls: Locator): Promise<void> {
	const count = await controls.count();
	expect(count).toBeGreaterThan(0);
	for (let index = 0; index < count; index += 1) {
		await expect(controls.nth(index)).toBeDisabled();
	}
}

test('server-only outage state warns users and disables custom workflow tools', async ({
	page
}) => {
	const browserRequests: string[] = [];
	page.on('request', (request) => browserRequests.push(request.url()));
	await authenticate(page);

	await page.goto('/edit?tool=object-replacement');

	await expect(
		page.getByRole('status').filter({ hasText: 'Замена объектов и текстур сейчас недоступна.' })
	).toBeVisible();
	const objectTab = page.getByRole('tab', { name: /Замена объекта.*Альфа/ });
	const textureTab = page.getByRole('tab', { name: /Замена текстуры.*Альфа/ });
	await expect(objectTab).toBeDisabled();
	await expect(textureTab).toBeDisabled();
	await expect(objectTab).toHaveAttribute('aria-selected', 'true');
	await expect(page.getByRole('tab', { name: 'Свой промпт' })).toHaveAttribute('tabindex', '0');
	await expectAllDisabled(
		page.locator('#edit-tool-panel-object-replacement').locator('button, input, textarea, select')
	);

	await page.goto('/edit?tool=texture-replacement');
	await expect(textureTab).toBeDisabled();
	await expect(textureTab).toHaveAttribute('aria-selected', 'true');
	await expectAllDisabled(
		page.locator('#edit-tool-panel-texture-replacement').locator('button, input, textarea, select')
	);

	await page.goto('/edit?tool=atmosphere');
	const atmosphereTab = page.getByRole('tab', { name: 'Атмосфера' });
	await atmosphereTab.focus();
	await atmosphereTab.press('ArrowRight');
	await expect(page).toHaveURL(/\/edit\?tool=freeform$/);
	await expect(page.getByRole('tab', { name: 'Свой промпт' })).toHaveAttribute(
		'aria-selected',
		'true'
	);

	expect(browserRequests.some((url) => /comfyui|system_stats|health/i.test(url))).toBe(false);
});
