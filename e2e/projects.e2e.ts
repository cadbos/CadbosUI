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

interface ProjectRecord {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
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

async function mockProjectsList(page: Page, projects: ProjectRecord[]): Promise<void> {
	await page.route('**/api/projects?**', async (route) => {
		if (route.request().method() !== 'GET') return route.fallback();
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				projects,
				pagination: { offset: 0, size: 20, hasMore: false }
			})
		});
	});
}

test('the Projects link is hidden for anonymous users', async ({ page }) => {
	await page.goto('/create/interior?view=chat&format=webp');
	await expect(page.getByRole('link', { name: 'Проекты' })).not.toBeVisible();
});

test('navigates from the workspace to the projects list', async ({ page }) => {
	await authenticate(page);
	await mockProjectsList(page, []);
	await page.goto('/create/interior?view=chat&format=webp');

	const link = page.getByRole('link', { name: 'Проекты' });
	await expect(link).toBeVisible();
	await link.click();

	await expect(page).toHaveURL(/\/projects$/);
	await expect(page.getByRole('heading', { name: 'Проекты' })).toBeVisible();
});

test('lists projects, most recently updated first, with their dates', async ({ page }) => {
	await authenticate(page);
	await mockProjectsList(page, [
		{
			id: '00000000-0000-4000-8000-000000000001',
			title: 'Living room',
			createdAt: Date.UTC(2026, 0, 1),
			updatedAt: Date.UTC(2026, 0, 3)
		},
		{
			id: '00000000-0000-4000-8000-000000000002',
			title: 'Kitchen',
			createdAt: Date.UTC(2026, 0, 1),
			updatedAt: Date.UTC(2026, 0, 2)
		}
	]);

	await page.goto('/projects');

	const list = page.getByRole('list', { name: 'Проекты, сначала недавно обновлённые' });
	await expect(list).toBeVisible();
	const links = page.getByRole('link', { name: /Открыть проект/ });
	await expect(links).toHaveCount(2);
	await expect(links.nth(0)).toContainText('Living room');
	await expect(links.nth(1)).toContainText('Kitchen');
});

test('shows an empty state when there are no projects', async ({ page }) => {
	await authenticate(page);
	await mockProjectsList(page, []);

	await page.goto('/projects');

	await expect(page.getByText('Проектов пока нет — создайте первый.')).toBeVisible();
});

test('shows an error message when projects fail to load', async ({ page }) => {
	await authenticate(page);
	await page.route('**/api/projects?**', async (route) => {
		await route.fulfill({ status: 500 });
	});

	await page.goto('/projects');

	await expect(page.getByRole('alert')).toHaveText('Не удалось загрузить проекты.');
});

test('creates a project from the list page and navigates into it', async ({ page }) => {
	await authenticate(page);
	await mockProjectsList(page, []);
	const created: ProjectRecord = {
		id: '00000000-0000-4000-8000-000000000099',
		title: 'New living room',
		createdAt: Date.UTC(2026, 0, 1),
		updatedAt: Date.UTC(2026, 0, 1)
	};
	await page.route('**/api/projects', async (route) => {
		if (route.request().method() !== 'POST') return route.fallback();
		expect(JSON.parse(route.request().postData() ?? '{}')).toEqual({ title: 'New living room' });
		await route.fulfill({
			status: 201,
			contentType: 'application/json',
			body: JSON.stringify(created)
		});
	});
	await page.route(`**/api/projects/${created.id}`, async (route) => {
		if (route.request().method() !== 'GET') return route.fallback();
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ ...created, shareActive: false, sessions: [] })
		});
	});

	await page.goto('/projects');
	await page.getByLabel('Название нового проекта').fill('New living room');
	await page.getByRole('button', { name: 'Создать проект' }).click();

	await expect(page.getByRole('link', { name: /Открыть проект New living room/ })).toBeVisible();

	await page.getByRole('link', { name: /Открыть проект New living room/ }).click();
	await expect(page).toHaveURL(new RegExp(`/projects/${created.id}$`));
});

test('deletes a project after confirming, and removes it from the list', async ({ page }) => {
	await authenticate(page);
	const project: ProjectRecord = {
		id: '00000000-0000-4000-8000-000000000001',
		title: 'Living room',
		createdAt: Date.UTC(2026, 0, 1),
		updatedAt: Date.UTC(2026, 0, 1)
	};
	await mockProjectsList(page, [project]);
	let deleteCalled = false;
	await page.route(`**/api/projects/${project.id}`, async (route) => {
		if (route.request().method() !== 'DELETE') return route.fallback();
		deleteCalled = true;
		await route.fulfill({ status: 204 });
	});

	await page.goto('/projects');
	await page.getByRole('button', { name: 'Удалить проект Living room' }).click();

	const dialog = page.getByRole('dialog');
	await expect(dialog).toBeVisible();
	await expect(dialog.getByText('Удалить этот проект?')).toBeVisible();

	await dialog.getByRole('button', { name: 'Удалить проект' }).click();

	await expect(page.getByRole('link', { name: /Открыть проект Living room/ })).toHaveCount(0);
	expect(deleteCalled).toBe(true);
});

test('cancelling the delete confirmation keeps the project', async ({ page }) => {
	await authenticate(page);
	const project: ProjectRecord = {
		id: '00000000-0000-4000-8000-000000000001',
		title: 'Living room',
		createdAt: Date.UTC(2026, 0, 1),
		updatedAt: Date.UTC(2026, 0, 1)
	};
	await mockProjectsList(page, [project]);

	await page.goto('/projects');
	await page.getByRole('button', { name: 'Удалить проект Living room' }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Отмена' }).click();

	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(page.getByRole('link', { name: /Открыть проект Living room/ })).toBeVisible();
});
