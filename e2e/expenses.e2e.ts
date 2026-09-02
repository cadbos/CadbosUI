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
import { media } from './helpers/media';

const PK = '0'.repeat(64);
const PROJECT_ID = '00000000-0000-4000-8000-000000000700';
const SESSION_ID = '00000000-0000-4000-8000-000000000701';
const GENERATION_ID = '00000000-0000-4000-8000-000000000702';
const BEFORE_URL = 'https://cdn.example.test/before.webp';
const AFTER_URL = 'https://cdn.example.test/after.webp';

async function authenticateWithExpenseHistory(page: Page): Promise<void> {
	await page.route('**/auth/me', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				user: { pubkey: PK, firstName: 'Ada', lastName: 'Lovelace' },
				credit: {
					balance: 8.5,
					updatedAt: Date.now(),
					history: [
						{
							id: GENERATION_ID,
							amount: 1.5,
							balanceAfter: 8.5,
							kind: 'render',
							createdAt: Date.UTC(2026, 0, 1),
							sessionId: SESSION_ID,
							projectId: PROJECT_ID
						}
					]
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

async function mockProjectDetail(page: Page): Promise<void> {
	await page.route(`**/api/projects/${PROJECT_ID}`, async (route) => {
		if (route.request().method() !== 'GET') return route.fallback();
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				id: PROJECT_ID,
				title: 'Living room',
				createdAt: Date.UTC(2026, 0, 1),
				updatedAt: Date.UTC(2026, 0, 1),
				shareActive: false,
				sessions: [
					{
						id: SESSION_ID,
						title: 'Main thread',
						parentSessionId: null,
						forkedFromGenerationId: null,
						createdAt: Date.UTC(2026, 0, 1),
						updatedAt: Date.UTC(2026, 0, 1),
						generations: [
							{
								id: GENERATION_ID,
								image: media(2, AFTER_URL),
								source: media(1, BEFORE_URL),
								kind: 'render',
								createdAt: Date.UTC(2026, 0, 1),
								amount: 1.5,
								balanceAfter: 8.5
							}
						]
					}
				]
			})
		});
	});
}

test('clicking an expense row opens its generation before/after in the workspace, anchored in the URL', async ({
	page
}) => {
	await authenticateWithExpenseHistory(page);
	await mockProjectDetail(page);
	await page.goto('/expenses');

	await page.locator('button.history-entry').click();

	await expect(page).toHaveURL(new RegExp(`project=${PROJECT_ID}`));
	await expect(page).toHaveURL(new RegExp(`session=${SESSION_ID}`));
	await expect(page).toHaveURL(new RegExp(`generation=${GENERATION_ID}`));

	const compareButton = page.getByRole('button', { name: 'Сравнить до/после' });
	await expect(compareButton).toBeEnabled();
	await compareButton.click();

	await expect(page.getByAltText('После', { exact: true })).toHaveAttribute('src', AFTER_URL);
	await expect(page.getByAltText('До', { exact: true })).toHaveAttribute('src', BEFORE_URL);

	// A genuinely new generation on top of the preview leaves the project and
	// session anchored (still the same session), but the `generation=` anchor
	// itself must drop — what's on screen is no longer that past generation's
	// result (see request.svelte.ts's setCurrentRender clearing viewingGenerationId).
	await page.route('**/api/render', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				id: '00000000-0000-4000-8000-000000000703',
				output: media(3, 'https://cdn.example.test/new-render.webp'),
				cost: 1,
				balance: 7.5
			})
		});
	});
	await Promise.all([
		page.waitForResponse((response) => response.url().endsWith('/api/render') && response.ok()),
		page.getByRole('button', { name: 'Сгенерировать' }).click()
	]);

	await expect(page).toHaveURL(new RegExp(`project=${PROJECT_ID}`));
	await expect(page).toHaveURL(new RegExp(`session=${SESSION_ID}`));
	await expect(page).not.toHaveURL(/generation=/);
});

test('reloading a URL with a generation anchor reconstructs the same before/after view', async ({
	page
}) => {
	await authenticateWithExpenseHistory(page);
	await mockProjectDetail(page);

	await page.goto(
		`/create/interior?view=chat&format=webp&project=${PROJECT_ID}&session=${SESSION_ID}&generation=${GENERATION_ID}`
	);

	const compareButton = page.getByRole('button', { name: 'Сравнить до/после' });
	await expect(compareButton).toBeEnabled();
	await compareButton.click();

	await expect(page.getByAltText('После', { exact: true })).toHaveAttribute('src', AFTER_URL);
	await expect(page.getByAltText('До', { exact: true })).toHaveAttribute('src', BEFORE_URL);
});

test('surfaces an error and stays on the expenses page when the row’s project is gone', async ({
	page
}) => {
	await authenticateWithExpenseHistory(page);
	await page.route(`**/api/projects/${PROJECT_ID}`, async (route) => {
		if (route.request().method() !== 'GET') return route.fallback();
		await route.fulfill({
			status: 404,
			contentType: 'application/json',
			body: JSON.stringify({ error: { code: 'project_not_found', message: 'Project not found' } })
		});
	});
	await page.goto('/expenses');

	await page.locator('button.history-entry').click();

	await expect(page.getByRole('alert')).toBeVisible();
	await expect(page).toHaveURL('/expenses');
});
