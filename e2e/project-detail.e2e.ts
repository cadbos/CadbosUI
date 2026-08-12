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

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const SESSION_ID = '00000000-0000-4000-8000-000000000010';

interface SessionFixture {
	id: string;
	title: string;
	parentSessionId: string | null;
	forkedFromGenerationId: string | null;
	createdAt: number;
	updatedAt: number;
	generations: { id: string; url: string; sourceUrl: string; kind: string; createdAt: number }[];
}

function session(overrides: Partial<SessionFixture> = {}): SessionFixture {
	return {
		id: SESSION_ID,
		title: '',
		parentSessionId: null,
		forkedFromGenerationId: null,
		createdAt: Date.UTC(2026, 0, 1),
		updatedAt: Date.UTC(2026, 0, 1),
		generations: [],
		...overrides
	};
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

async function mockProjectDetail(
	page: Page,
	overrides: { title?: string; shareActive?: boolean; sessions?: SessionFixture[] } = {}
): Promise<void> {
	const state = {
		id: PROJECT_ID,
		title: overrides.title ?? 'Living room',
		createdAt: Date.UTC(2026, 0, 1),
		updatedAt: Date.UTC(2026, 0, 1),
		shareActive: overrides.shareActive ?? false,
		sessions: overrides.sessions ?? []
	};
	await page.route(`**/api/projects/${PROJECT_ID}`, async (route) => {
		if (route.request().method() !== 'GET') return route.fallback();
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(state)
		});
	});
}

test('loads a project with its sessions, showing fork lineage', async ({ page }) => {
	await authenticate(page);
	const parent = session({ id: SESSION_ID, title: 'Main thread' });
	const fork = session({
		id: '00000000-0000-4000-8000-000000000011',
		title: 'Style B',
		parentSessionId: SESSION_ID,
		forkedFromGenerationId: '00000000-0000-4000-8000-000000000100'
	});
	await mockProjectDetail(page, { sessions: [parent, fork] });

	await page.goto(`/projects/${PROJECT_ID}`);

	await expect(page).toHaveTitle('Living room');
	await expect(page.getByLabel('Название проекта')).toHaveValue('Living room');
	await expect(page.getByText('Форкнута от «Main thread»')).toBeVisible();
});

test('renames the project inline', async ({ page }) => {
	await authenticate(page);
	await mockProjectDetail(page);
	await page.route(`**/api/projects/${PROJECT_ID}`, async (route) => {
		if (route.request().method() !== 'PATCH') return route.fallback();
		expect(JSON.parse(route.request().postData() ?? '{}')).toEqual({ title: 'Cozy living room' });
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				id: PROJECT_ID,
				title: 'Cozy living room',
				createdAt: Date.UTC(2026, 0, 1),
				updatedAt: Date.UTC(2026, 0, 2)
			})
		});
	});

	await page.goto(`/projects/${PROJECT_ID}`);
	const titleInput = page.getByLabel('Название проекта');
	await titleInput.fill('Cozy living room');
	await page.getByRole('button', { name: 'Сохранить', exact: true }).click();

	await expect(page).toHaveTitle('Cozy living room');
});

test('deletes the project after confirming, and returns to the projects list', async ({ page }) => {
	await authenticate(page);
	await mockProjectDetail(page);
	await page.route('**/api/projects?**', async (route) => {
		if (route.request().method() !== 'GET') return route.fallback();
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ projects: [], pagination: { offset: 0, size: 20, hasMore: false } })
		});
	});
	let deleteCalled = false;
	await page.route(`**/api/projects/${PROJECT_ID}`, async (route) => {
		if (route.request().method() !== 'DELETE') return route.fallback();
		deleteCalled = true;
		await route.fulfill({ status: 204 });
	});

	await page.goto(`/projects/${PROJECT_ID}`);
	await page.getByRole('button', { name: 'Удалить проект', exact: true }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Удалить проект' }).click();

	await expect(page).toHaveURL(/\/projects$/);
	expect(deleteCalled).toBe(true);
});

test('creates a new session and shows it in the list', async ({ page }) => {
	await authenticate(page);
	await mockProjectDetail(page, { sessions: [] });
	const created = {
		id: SESSION_ID,
		title: '',
		createdAt: Date.UTC(2026, 0, 2),
		updatedAt: Date.UTC(2026, 0, 2)
	};
	await page.route(`**/api/projects/${PROJECT_ID}/sessions`, async (route) => {
		if (route.request().method() !== 'POST') return route.fallback();
		await route.fulfill({
			status: 201,
			contentType: 'application/json',
			body: JSON.stringify(created)
		});
	});

	await page.goto(`/projects/${PROJECT_ID}`);
	await expect(page.getByText('Сессий пока нет — начните новую.')).toBeVisible();

	await page.getByRole('button', { name: 'Новая сессия' }).click();

	await expect(page.getByPlaceholder('Сессия без названия')).toBeVisible();
});

test('renames a session inline', async ({ page }) => {
	await authenticate(page);
	await mockProjectDetail(page, { sessions: [session({ title: 'Main thread' })] });
	await page.route(`**/api/projects/${PROJECT_ID}/sessions/${SESSION_ID}`, async (route) => {
		if (route.request().method() !== 'PATCH') return route.fallback();
		expect(JSON.parse(route.request().postData() ?? '{}')).toEqual({ title: 'Cozy corner' });
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				id: SESSION_ID,
				title: 'Cozy corner',
				createdAt: Date.UTC(2026, 0, 1),
				updatedAt: Date.UTC(2026, 0, 2)
			})
		});
	});

	await page.goto(`/projects/${PROJECT_ID}`);
	const sessionTitleInput = page.getByLabel('Название сессии');
	await sessionTitleInput.fill('Cozy corner');
	await page
		.locator('form')
		.filter({ has: page.getByLabel('Название сессии') })
		.getByRole('button', { name: 'Сохранить' })
		.click();

	await expect(sessionTitleInput).toHaveValue('Cozy corner');
});

test('deletes a session after confirming, keeping the project', async ({ page }) => {
	await authenticate(page);
	await mockProjectDetail(page, { sessions: [session({ title: 'Main thread' })] });
	let deleteCalled = false;
	await page.route(`**/api/projects/${PROJECT_ID}/sessions/${SESSION_ID}`, async (route) => {
		if (route.request().method() !== 'DELETE') return route.fallback();
		deleteCalled = true;
		await route.fulfill({ status: 204 });
	});

	await page.goto(`/projects/${PROJECT_ID}`);
	await page.getByRole('button', { name: 'Удалить сессию «Main thread»' }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Удалить сессию' }).click();

	await expect(page.getByText('Сессий пока нет — начните новую.')).toBeVisible();
	expect(deleteCalled).toBe(true);
});

test('continues a session into the render workspace with its latest render as the source', async ({
	page
}) => {
	await authenticate(page);
	await page.route('**/api/generated-images**', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ images: [], pagination: { offset: 0, size: 100, hasMore: false } })
		});
	});
	await mockProjectDetail(page, {
		sessions: [
			session({
				title: 'Main thread',
				generations: [
					{
						id: '00000000-0000-4000-8000-000000000100',
						url: 'https://cdn.example.test/latest-render.webp',
						sourceUrl: 'https://cdn.example.test/room.jpg',
						kind: 'render',
						createdAt: Date.UTC(2026, 0, 1)
					}
				]
			})
		]
	});

	let renderBody: unknown;
	await page.route('**/api/render', async (route) => {
		renderBody = route.request().postDataJSON();
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				outputUrl: 'https://cdn.example.test/render.webp',
				cost: 5,
				balance: 95
			})
		});
	});

	await page.goto(`/projects/${PROJECT_ID}`);
	await page.getByRole('button', { name: 'Продолжить сессию «Main thread»' }).click();

	await expect(page).toHaveURL(/\/create\/interior\?view=chat&format=webp$/);
	const renderPanel = page.locator('#mode-panel-render');
	await expect(renderPanel.locator('.image-wrapper img')).toHaveAttribute(
		'src',
		'https://cdn.example.test/latest-render.webp'
	);

	// A generation submitted after resuming must still carry the *original*
	// session id — continuing a session reuses it rather than lazily
	// provisioning a new one.
	await Promise.all([
		page.waitForResponse((response) => response.url().endsWith('/api/render') && response.ok()),
		renderPanel.getByRole('button', { name: 'Сгенерировать' }).click()
	]);
	expect(renderBody).toMatchObject({ sessionId: SESSION_ID });
});

test('issues a share link and copies it, then revokes it after confirming', async ({
	page,
	context,
	baseURL
}) => {
	await context.grantPermissions(['clipboard-write'], { origin: baseURL });
	await authenticate(page);
	await mockProjectDetail(page);
	const token = 'a'.repeat(64);
	let revokeCalled = false;
	await page.route(`**/api/projects/${PROJECT_ID}/share`, async (route) => {
		if (route.request().method() === 'POST') {
			await route.fulfill({
				status: 201,
				contentType: 'application/json',
				body: JSON.stringify({ token })
			});
			return;
		}
		if (route.request().method() === 'DELETE') {
			revokeCalled = true;
			await route.fulfill({ status: 204 });
			return;
		}
		await route.fallback();
	});

	await page.goto(`/projects/${PROJECT_ID}`);
	await page.getByRole('button', { name: 'Создать ссылку', exact: true }).click();

	const linkInput = page.locator('.share-link input');
	await expect(linkInput).toHaveValue(new RegExp(`/share/${token}$`));

	await page.getByRole('button', { name: 'Скопировать ссылку' }).click();
	await expect(page.getByRole('button', { name: 'Скопировано!' })).toBeVisible();

	await page.getByRole('button', { name: 'Отозвать ссылку', exact: true }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Отозвать ссылку' }).click();

	await expect(page.getByRole('button', { name: 'Создать ссылку', exact: true })).toBeVisible();
	expect(revokeCalled).toBe(true);
});

test('reloading a project with an already-active share link never re-shows the token', async ({
	page
}) => {
	await authenticate(page);
	await mockProjectDetail(page, { shareActive: true });

	await page.goto(`/projects/${PROJECT_ID}`);

	await expect(
		page.getByText('Ссылка активна, но её адрес показывается только один раз')
	).toBeVisible();
	await expect(page.locator('.share-link input')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Создать новую ссылку' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Отозвать ссылку', exact: true })).toBeVisible();
});
