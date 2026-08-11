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

const PROJECT_A = '00000000-0000-4000-8000-000000000001';
const PROJECT_B = '00000000-0000-4000-8000-000000000002';
const SESSION_A = '00000000-0000-4000-8000-000000000010';
const SESSION_B = '00000000-0000-4000-8000-000000000011';
const GENERATION_A = '00000000-0000-4000-8000-000000000100';
const GENERATION_B = '00000000-0000-4000-8000-000000000101';

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

async function mockProjectList(page: Page, titles: Record<string, string>): Promise<void> {
	await page.route('**/api/projects?**', async (route) => {
		if (route.request().method() !== 'GET') return route.fallback();
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				projects: Object.entries(titles).map(([id, title]) => ({
					id,
					title,
					createdAt: Date.UTC(2026, 0, 1),
					updatedAt: Date.UTC(2026, 0, 1)
				})),
				pagination: { offset: 0, size: 20, hasMore: false }
			})
		});
	});
}

async function mockProjectDetail(
	page: Page,
	projectId: string,
	sessionId: string,
	generationId: string,
	title: string,
	renderUrl: string
): Promise<void> {
	await page.route(`**/api/projects/${projectId}`, async (route) => {
		if (route.request().method() !== 'GET') return route.fallback();
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				id: projectId,
				title,
				createdAt: Date.UTC(2026, 0, 1),
				updatedAt: Date.UTC(2026, 0, 1),
				shareActive: false,
				sessions: [
					{
						id: sessionId,
						title: 'Main thread',
						parentSessionId: null,
						forkedFromGenerationId: null,
						createdAt: Date.UTC(2026, 0, 1),
						updatedAt: Date.UTC(2026, 0, 1),
						generations: [
							{
								id: generationId,
								url: renderUrl,
								sourceUrl: 'https://cdn.example.test/room.jpg',
								kind: 'render',
								createdAt: Date.UTC(2026, 0, 1)
							}
						]
					}
				]
			})
		});
	});
}

function resultImage(page: Page) {
	return page.locator('#mode-panel-render .image-wrapper img');
}

test('opens a tab per project continued into the workspace and preserves each one across switches', async ({
	page
}) => {
	await authenticate(page);
	await mockProjectList(page, { [PROJECT_A]: 'Living room', [PROJECT_B]: 'Kitchen' });
	await mockProjectDetail(
		page,
		PROJECT_A,
		SESSION_A,
		GENERATION_A,
		'Living room',
		'https://cdn.example.test/living-room.webp'
	);
	await mockProjectDetail(
		page,
		PROJECT_B,
		SESSION_B,
		GENERATION_B,
		'Kitchen',
		'https://cdn.example.test/kitchen.webp'
	);

	const tabs = page.getByRole('navigation', { name: 'Открытые проекты' });

	// No tabs yet — nothing opened from /projects.
	await page.goto(`/projects/${PROJECT_A}`);
	await expect(tabs).toHaveCount(0);

	await page.getByRole('button', { name: 'Продолжить сессию «Main thread»' }).click();
	await expect(page).toHaveURL(/\/create\/interior\?view=chat&format=webp$/);
	await expect(tabs.getByRole('tab', { name: 'Living room' })).toBeVisible();
	await expect(resultImage(page)).toHaveAttribute(
		'src',
		'https://cdn.example.test/living-room.webp'
	);

	await page.getByRole('link', { name: 'Проекты', exact: true }).click();
	await page.getByRole('link', { name: 'Открыть проект Kitchen', exact: false }).click();
	await page.getByRole('button', { name: 'Продолжить сессию «Main thread»' }).click();

	await expect(tabs.getByRole('tab', { name: 'Living room' })).toBeVisible();
	await expect(tabs.getByRole('tab', { name: 'Kitchen', selected: true })).toBeVisible();
	await expect(resultImage(page)).toHaveAttribute('src', 'https://cdn.example.test/kitchen.webp');

	await tabs.getByRole('tab', { name: 'Living room' }).click();

	await expect(tabs.getByRole('tab', { name: 'Living room', selected: true })).toBeVisible();
	await expect(resultImage(page)).toHaveAttribute(
		'src',
		'https://cdn.example.test/living-room.webp'
	);
	// Switching tabs never navigates — still the same workspace route.
	await expect(page).toHaveURL(/\/create\/interior\?view=chat&format=webp$/);
});

test('closing a tab removes it and falls back to a neighboring project', async ({ page }) => {
	await authenticate(page);
	await mockProjectList(page, { [PROJECT_A]: 'Living room', [PROJECT_B]: 'Kitchen' });
	await mockProjectDetail(
		page,
		PROJECT_A,
		SESSION_A,
		GENERATION_A,
		'Living room',
		'https://cdn.example.test/living-room.webp'
	);
	await mockProjectDetail(
		page,
		PROJECT_B,
		SESSION_B,
		GENERATION_B,
		'Kitchen',
		'https://cdn.example.test/kitchen.webp'
	);

	await page.goto(`/projects/${PROJECT_A}`);
	await page.getByRole('button', { name: 'Продолжить сессию «Main thread»' }).click();
	await page.getByRole('link', { name: 'Проекты', exact: true }).click();
	await page.getByRole('link', { name: 'Открыть проект Kitchen', exact: false }).click();
	await page.getByRole('button', { name: 'Продолжить сессию «Main thread»' }).click();

	const tabs = page.getByRole('navigation', { name: 'Открытые проекты' });
	await tabs.getByRole('button', { name: 'Закрыть вкладку «Kitchen»' }).click();

	await expect(tabs.getByRole('tab', { name: 'Kitchen' })).toHaveCount(0);
	await expect(tabs.getByRole('tab', { name: 'Living room', selected: true })).toBeVisible();
	await expect(resultImage(page)).toHaveAttribute(
		'src',
		'https://cdn.example.test/living-room.webp'
	);
});
