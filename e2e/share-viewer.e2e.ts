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

const TOKEN = 'b'.repeat(64);

async function mockShare(page: Page, body: unknown, status = 200): Promise<void> {
	await page.route(`**/api/share/${TOKEN}`, async (route) => {
		await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
	});
}

test('shows a shared project read-only, without auth, with no editing controls', async ({
	page
}) => {
	await mockShare(page, {
		id: '00000000-0000-4000-8000-000000000001',
		title: 'Living room',
		createdAt: Date.UTC(2026, 0, 1),
		updatedAt: Date.UTC(2026, 0, 1),
		shareActive: true,
		sessions: [
			{
				id: '00000000-0000-4000-8000-000000000010',
				title: 'Main thread',
				parentSessionId: null,
				forkedFromGenerationId: null,
				createdAt: Date.UTC(2026, 0, 1),
				updatedAt: Date.UTC(2026, 0, 1),
				generations: [
					{
						id: '00000000-0000-4000-8000-000000000100',
						url: 'https://cdn.example.test/render.webp',
						sourceUrl: 'https://cdn.example.test/room.jpg',
						kind: 'render',
						createdAt: Date.UTC(2026, 0, 1)
					}
				]
			}
		]
	});

	await page.goto(`/share/${TOKEN}`);

	await expect(page).toHaveTitle('Living room');
	await expect(page.getByRole('heading', { name: 'Living room' })).toBeVisible();
	await expect(page.getByText('Main thread')).toBeVisible();
	await expect(page.getByRole('img', { name: /Main thread/ })).toHaveAttribute(
		'src',
		'https://cdn.example.test/render.webp'
	);

	// Read-only: no rename form, no delete/share management controls exist on
	// this page's own content — those only ever ship on the owner's
	// /projects/[id]. Scoped to <main> since the layout's own header (sign-in
	// button) is out of scope here.
	await expect(page.locator('input')).toHaveCount(0);
	await expect(page.locator('main').getByRole('button')).toHaveCount(0);
});

test('shows a not-found message for a revoked or unknown token', async ({ page }) => {
	await mockShare(page, null, 404);

	await page.goto(`/share/${TOKEN}`);

	await expect(page.getByRole('alert')).toHaveText('Эта ссылка недействительна или была отозвана.');
});

test('marks the page noindex so it never gets crawled', async ({ page }) => {
	await mockShare(page, {
		id: '00000000-0000-4000-8000-000000000001',
		title: 'Living room',
		createdAt: Date.UTC(2026, 0, 1),
		updatedAt: Date.UTC(2026, 0, 1),
		shareActive: true,
		sessions: []
	});

	await page.goto(`/share/${TOKEN}`);

	await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
});
