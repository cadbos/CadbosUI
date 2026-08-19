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
						generations: []
					}
				]
			})
		});
	});
}

// Opens the project's session into the render workspace — the same flow
// project-detail.e2e.ts's own "continues a session..." test uses — so the
// workspace header's Share button (only shown once a project tab is active,
// see Workspace.svelte's showSessionTabs) becomes visible.
async function openProjectInWorkspace(page: Page): Promise<void> {
	await page.goto(`/projects/${PROJECT_ID}`);
	await page.getByRole('button', { name: 'Продолжить сессию «Main thread»' }).click();
	await expect(page).toHaveURL(/\/create\/interior\?view=chat&format=webp$/);
}

test('opens the header share dialog, issues a link, copies it, then revokes it and closes', async ({
	page,
	context,
	baseURL
}) => {
	await context.grantPermissions(['clipboard-write'], { origin: baseURL });
	await authenticate(page);
	await mockProjectDetail(page);

	const token = 'b'.repeat(64);
	let revokeCalled = false;
	await page.route(`**/api/projects/${PROJECT_ID}/share`, async (route) => {
		const method = route.request().method();
		if (method === 'GET') {
			await route.fulfill({ status: 404 });
			return;
		}
		if (method === 'POST') {
			await route.fulfill({
				status: 201,
				contentType: 'application/json',
				body: JSON.stringify({ token })
			});
			return;
		}
		if (method === 'DELETE') {
			revokeCalled = true;
			await route.fulfill({ status: 204 });
			return;
		}
		await route.fallback();
	});

	await openProjectInWorkspace(page);

	await page.getByRole('button', { name: 'Поделиться', exact: true }).click();

	const dialog = page.getByRole('dialog', { name: 'Поделиться' });
	await expect(dialog).toBeVisible();

	await dialog.getByRole('button', { name: 'Создать ссылку', exact: true }).click();

	const linkInput = dialog.locator('.share-link input');
	await expect(linkInput).toHaveValue(new RegExp(`/share/${token}$`));

	await dialog.getByRole('button', { name: 'Скопировать ссылку' }).click();
	await expect(dialog.getByRole('button', { name: 'Скопировано!' })).toBeVisible();

	await dialog.getByRole('button', { name: 'Отозвать ссылку', exact: true }).click();

	const revokeConfirmDialog = page.getByRole('dialog', { name: 'Отозвать эту ссылку?' });
	await revokeConfirmDialog.getByRole('button', { name: 'Отозвать ссылку' }).click();

	await expect(revokeConfirmDialog).toHaveCount(0);
	await expect(dialog.getByRole('button', { name: 'Создать ссылку', exact: true })).toBeVisible();
	expect(revokeCalled).toBe(true);

	await dialog.getByRole('button', { name: 'Закрыть окно доступа' }).click();
	await expect(dialog).toHaveCount(0);
});
