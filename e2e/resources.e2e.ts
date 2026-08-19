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

interface ResourceImage {
	sourceUrl: string;
	createdAt: number;
}

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
}

// Keyed by offset, so a single route handler can serve a whole pagination
// sequence — the store always requests size=30, only offset changes.
async function mockResourcesPages(
	page: Page,
	pages: Record<number, { images: ResourceImage[]; hasMore: boolean }>
): Promise<void> {
	await page.route('**/api/resources**', async (route) => {
		const offset = Number(new URL(route.request().url()).searchParams.get('offset'));
		const found = pages[offset];
		if (!found) throw new Error(`No mocked resources page for offset ${offset}`);
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				images: found.images,
				pagination: { offset, size: 30, hasMore: found.hasMore }
			})
		});
	});
}

function dateLabel(createdAt: number): string {
	return new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short', year: 'numeric' }).format(
		new Date(createdAt)
	);
}

function timeLabel(createdAt: number): string {
	return new Intl.DateTimeFormat('ru', {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hourCycle: 'h23'
	}).format(new Date(createdAt));
}

test('the Resources link is hidden for anonymous users', async ({ page }) => {
	await page.goto('/create/interior?view=chat&format=webp');
	await expect(page.getByRole('link', { name: 'Ресурсы' })).not.toBeVisible();
});

test('navigates from the workspace to the resources gallery', async ({ page }) => {
	await authenticate(page);
	await mockResourcesPages(page, { 0: { images: [], hasMore: false } });
	await page.goto('/create/interior?view=chat&format=webp');

	const link = page.getByRole('link', { name: 'Ресурсы' });
	await expect(link).toBeVisible();
	await link.click();

	await expect(page).toHaveURL(/\/resources$/);
	await expect(page.getByRole('heading', { name: 'Ресурсы' })).toBeVisible();
});

test('lists uploaded photos newest first with their dates', async ({ page }) => {
	await authenticate(page);
	const newest = Date.UTC(2026, 0, 3, 12);
	const oldest = Date.UTC(2026, 0, 1, 12);
	await mockResourcesPages(page, {
		0: {
			images: [
				{ sourceUrl: 'https://cdn.example.test/newest.jpg', createdAt: newest },
				{ sourceUrl: 'https://cdn.example.test/oldest.jpg', createdAt: oldest }
			],
			hasMore: false
		}
	});

	await page.goto('/resources');

	const list = page.getByRole('list', { name: 'Загруженные фото, сначала новые' });
	await expect(list).toBeVisible();
	const images = page.getByRole('img', { name: /Загруженное фото/ });
	await expect(images).toHaveCount(2);
	await expect(images.nth(0)).toHaveAttribute('src', 'https://cdn.example.test/newest.jpg');
	await expect(images.nth(1)).toHaveAttribute('src', 'https://cdn.example.test/oldest.jpg');

	const times = page.locator('.card time');
	await expect(times.nth(0).locator('span')).toHaveText([dateLabel(newest), timeLabel(newest)]);
	await expect(times.nth(0)).toHaveAttribute('datetime', new Date(newest).toISOString());
	await expect(times.nth(1).locator('span')).toHaveText([dateLabel(oldest), timeLabel(oldest)]);

	await expect(
		page.getByRole('button', { name: 'Использовать фото 1 для новой генерации' })
	).toBeVisible();
});

test('loads more photos when scrolling near the end of the list', async ({ page }) => {
	await authenticate(page);
	await mockResourcesPages(page, {
		0: { images: [{ sourceUrl: 'https://cdn.example.test/one.jpg', createdAt: 1 }], hasMore: true },
		1: { images: [{ sourceUrl: 'https://cdn.example.test/two.jpg', createdAt: 2 }], hasMore: false }
	});

	await page.goto('/resources');

	const images = page.getByRole('img', { name: /Загруженное фото/ });
	// The sentinel starts within the viewport on this short a page, so the
	// IntersectionObserver fires — and loadMore() resolves — without any
	// explicit scroll; expect()'s built-in retry covers the async gap. An
	// explicit scrollIntoViewIfNeeded() actually races the sentinel's own
	// removal once hasMore goes false and loses more often than not — verified
	// against a real run, not just theory.
	await expect(images).toHaveCount(2);
	await expect(images.nth(1)).toHaveAttribute('src', 'https://cdn.example.test/two.jpg');
	// hasMore is false after the second page, so the sentinel is gone — no
	// further /api/resources request should ever follow.
	await expect(page.locator('.load-more-sentinel')).toHaveCount(0);
});

test('shows an empty state when there are no uploaded photos', async ({ page }) => {
	await authenticate(page);
	await mockResourcesPages(page, { 0: { images: [], hasMore: false } });

	await page.goto('/resources');

	await expect(page.getByText('Пока нет загруженных фото.')).toBeVisible();
	await expect(page.getByRole('list', { name: 'Загруженные фото, сначала новые' })).toHaveCount(0);
});

test('shows an error message when resources fail to load', async ({ page }) => {
	await authenticate(page);
	await page.route('**/api/resources**', async (route) => {
		await route.fulfill({ status: 500 });
	});

	await page.goto('/resources');

	await expect(page.getByRole('alert')).toHaveText('Не удалось загрузить ресурсы.');
});

test('uses a resource photo to start a new generation', async ({ page }) => {
	await authenticate(page);
	await page.route('**/api/generated-images**', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ images: [], pagination: { offset: 0, size: 100, hasMore: false } })
		});
	});
	await mockResourcesPages(page, {
		0: {
			images: [{ sourceUrl: 'https://cdn.example.test/resource-photo.jpg', createdAt: 1 }],
			hasMore: false
		}
	});

	await page.goto('/resources');
	await page.getByRole('button', { name: 'Использовать фото 1 для новой генерации' }).click();

	await expect(page).toHaveURL(/\/create\/interior\?view=chat&format=webp$/);
	await expect(page.locator('#mode-panel-render .image-wrapper img')).toHaveAttribute(
		'src',
		'https://cdn.example.test/resource-photo.jpg'
	);
});

test('using a resource photo while a project tab is open opens the scratch tab instead of hijacking it', async ({
	page
}) => {
	const projectId = '00000000-0000-4000-8000-000000000001';
	await authenticate(page);
	await page.route('**/api/generated-images**', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ images: [], pagination: { offset: 0, size: 100, hasMore: false } })
		});
	});
	await page.route('**/api/projects?**', async (route) => {
		if (route.request().method() !== 'GET') return route.fallback();
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				projects: [
					{
						id: projectId,
						title: 'Living room',
						createdAt: Date.UTC(2026, 0, 1),
						updatedAt: Date.UTC(2026, 0, 1)
					}
				],
				pagination: { offset: 0, size: 20, hasMore: false }
			})
		});
	});
	await page.route(`**/api/projects/${projectId}`, async (route) => {
		if (route.request().method() !== 'GET') return route.fallback();
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				id: projectId,
				title: 'Living room',
				createdAt: Date.UTC(2026, 0, 1),
				updatedAt: Date.UTC(2026, 0, 1),
				shareActive: false,
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
								url: 'https://cdn.example.test/living-room.webp',
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
	await mockResourcesPages(page, {
		0: {
			images: [{ sourceUrl: 'https://cdn.example.test/resource-photo.jpg', createdAt: 1 }],
			hasMore: false
		}
	});

	await page.goto(`/projects/${projectId}`);
	await page.getByRole('button', { name: 'Продолжить сессию «Main thread»' }).click();

	const tabs = page.getByRole('navigation', { name: 'Открытые проекты' });
	await expect(tabs.getByRole('tab', { name: 'Living room' })).toBeVisible();

	await page.getByRole('link', { name: 'Ресурсы', exact: true }).click();
	await page.getByRole('button', { name: 'Использовать фото 1 для новой генерации' }).click();

	// The picked photo lands on a fresh scratch tab — Living room's own tab
	// (and the render it held) survives untouched.
	await expect(tabs.getByRole('tab', { name: 'Без названия', selected: true })).toBeVisible();
	await expect(tabs.getByRole('tab', { name: 'Living room' })).toBeVisible();
	await expect(page.locator('#mode-panel-render .image-wrapper img')).toHaveAttribute(
		'src',
		'https://cdn.example.test/resource-photo.jpg'
	);

	await tabs.getByRole('tab', { name: 'Living room' }).click();
	await expect(page.locator('#mode-panel-render .image-wrapper img')).toHaveAttribute(
		'src',
		'https://cdn.example.test/living-room.webp'
	);
});
