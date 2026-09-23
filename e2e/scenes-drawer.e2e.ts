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
import { media } from './helpers/media';

const GENERATION_ID = '00000000-0000-4000-8000-000000000200';

const FORM_SNAPSHOT = {
	promptFragments: [],
	promptOverride: null,
	editPrompt: '',
	addObjectPresetId: null,
	removeObjectText: '',
	outputFormat: 'webp',
	sceneType: 'interior',
	styleTransferPrompt: 'archived style note',
	styleTransferStrength: 0.42,
	styleNegativePrompt: '',
	styleSourceMode: 'room-photo',
	objectReplacementObject: '',
	objectReplacementSourceMode: 'current-result',
	objectReplacementScale: 1,
	textureReplacementSurface: '',
	textureReplacementSourceMode: 'current-result',
	textureReplacementMasked: false,
	lightSettingsPresetIds: [],
	lightSettingsInstruction: ''
};

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

const ADD_OBJECT_GENERATION_ID = '00000000-0000-4000-8000-000000000201';

// A snapshot from the 'add-object' edit-panel tool, submitted after a
// freeform edit left stale text in `editPrompt` — the bug this test guards
// against: without `editOperationType`, restoring an 'edit'-kind generation
// couldn't tell freeform/add-object/remove-object apart and always landed on
// the freeform tab, showing that leftover text as if it belonged here.
const ADD_OBJECT_FORM_SNAPSHOT = {
	...FORM_SNAPSHOT,
	editPrompt: 'сделай стены голубыми',
	addObjectPresetId: 'houseplant',
	editOperationType: 'add-object'
};

async function mockAddObjectScene(page: Page): Promise<void> {
	await page.route('**/api/generated-images**', async (route) => {
		if (route.request().method() !== 'GET') return route.fallback();
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				images: [
					{
						id: ADD_OBJECT_GENERATION_ID,
						image: media(2, 'https://cdn.example.test/added-plant.webp'),
						source: media(1, 'https://cdn.example.test/scene.jpg'),
						kind: 'edit',
						createdAt: Date.UTC(2026, 0, 1)
					}
				],
				pagination: { offset: 0, size: 100, hasMore: false }
			})
		});
	});
	await page.route(`**/api/generated-images/${ADD_OBJECT_GENERATION_ID}`, async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				id: ADD_OBJECT_GENERATION_ID,
				prompt: '',
				kind: 'edit',
				createdAt: Date.UTC(2026, 0, 1),
				image: media(2, 'https://cdn.example.test/added-plant.webp'),
				source: media(1, 'https://cdn.example.test/scene.jpg'),
				formSnapshot: ADD_OBJECT_FORM_SNAPSHOT,
				session: null,
				media: [
					media(2, 'https://cdn.example.test/added-plant.webp'),
					media(1, 'https://cdn.example.test/scene.jpg')
				]
			})
		});
	});
}

async function mockSingleStyleTransferScene(page: Page): Promise<void> {
	await page.route('**/api/generated-images**', async (route) => {
		if (route.request().method() !== 'GET') return route.fallback();
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				images: [
					{
						id: GENERATION_ID,
						image: media(2, 'https://cdn.example.test/result.webp'),
						source: media(1, 'https://cdn.example.test/scene.jpg'),
						kind: 'style-transfer',
						createdAt: Date.UTC(2026, 0, 1)
					}
				],
				pagination: { offset: 0, size: 100, hasMore: false }
			})
		});
	});
	await page.route(`**/api/generated-images/${GENERATION_ID}`, async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				id: GENERATION_ID,
				prompt: '',
				kind: 'style-transfer',
				createdAt: Date.UTC(2026, 0, 1),
				image: media(2, 'https://cdn.example.test/result.webp'),
				source: media(1, 'https://cdn.example.test/scene.jpg'),
				formSnapshot: FORM_SNAPSHOT,
				session: null,
				media: [
					media(2, 'https://cdn.example.test/result.webp'),
					media(1, 'https://cdn.example.test/scene.jpg')
				]
			})
		});
	});
}

test('restores a past generation’s exact settings from the scenes drawer', async ({ page }) => {
	await authenticate(page);
	await mockSingleStyleTransferScene(page);

	await page.goto('/create/interior?view=chat&format=webp');
	await page.getByRole('button', { name: 'Сцены' }).click();
	// The restore button only becomes interactive once its result thumbnail
	// is hovered (see .actions in ScenesDrawer.svelte's styles).
	await page.locator('.image-frame.result-frame').hover();
	await page.getByRole('button', { name: /Восстановить настройки сцены/ }).click();

	// Navigated to the tool the restored generation was made with, showing
	// that generation's own result — the same image its "Результат" thumbnail
	// (useImage) would set — with the archived settings applied on top.
	await expect(page).toHaveURL(/\/style-transfer/);
	await expect(page.locator('.image-wrapper img').first()).toHaveAttribute(
		'src',
		'https://cdn.example.test/result.webp'
	);
	await expect(page.getByLabel('Уточнение стиля')).toHaveValue('archived style note');
});

test('restores an edit-kind generation onto the edit-panel tool that actually produced it', async ({
	page
}) => {
	await authenticate(page);
	await mockAddObjectScene(page);

	await page.goto('/create/interior?view=chat&format=webp');
	await page.getByRole('button', { name: 'Сцены' }).click();
	await page.locator('.image-frame.result-frame').hover();
	await page.getByRole('button', { name: /Восстановить настройки сцены/ }).click();

	// Lands on the Add object tab — not the freeform tab every 'edit'-kind
	// generation used to default to — with its own preset selected, not the
	// stale freeform instruction left over from the earlier edit.
	await expect(page).toHaveURL(/\/edit/);
	await expect(page).toHaveURL(/tool=add-object/);
	await expect(page.getByRole('tab', { name: 'Добавить объект' })).toHaveAttribute(
		'aria-selected',
		'true'
	);
	await expect(page.getByRole('radio', { name: 'Комнатное растение' })).toHaveAttribute(
		'aria-checked',
		'true'
	);
});

test('asks for confirmation before restoring over unsaved form changes', async ({ page }) => {
	await authenticate(page);
	await mockSingleStyleTransferScene(page);

	await page.goto('/create/interior?view=chat&format=webp');
	// Gives the form something to lose: an uploaded image with no matching
	// confirmed generation behind it yet.
	await page.setInputFiles('input[type="file"]', {
		name: 'room.jpg',
		mimeType: 'image/jpeg',
		buffer: Buffer.from('fake-image-bytes')
	});
	await expect(page.locator('.image-wrapper img').first()).toBeVisible();

	await page.getByRole('button', { name: 'Сцены' }).click();
	await page.locator('.image-frame.result-frame').hover();
	await page.getByRole('button', { name: /Восстановить настройки сцены/ }).click();

	const dialog = page.getByRole('dialog', { name: 'Восстановить настройки?' });
	await expect(dialog).toBeVisible();
	await dialog.getByRole('button', { name: 'Восстановить' }).click();

	await expect(page).toHaveURL(/\/style-transfer/);
	await expect(page.getByLabel('Уточнение стиля')).toHaveValue('archived style note');
});

test('continues the restored generation’s own session instead of starting a new one', async ({
	page
}) => {
	const projectId = '00000000-0000-4000-8000-000000000210';
	const sessionId = '00000000-0000-4000-8000-000000000211';
	const generationId = '00000000-0000-4000-8000-000000000212';
	await authenticate(page);
	await page.route('**/api/generated-images**', async (route) => {
		if (route.request().method() !== 'GET') return route.fallback();
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				images: [
					{
						id: generationId,
						image: media(2, 'https://cdn.example.test/render.webp'),
						source: media(1, 'https://cdn.example.test/scene.jpg'),
						kind: 'render',
						createdAt: Date.UTC(2026, 0, 1)
					}
				],
				pagination: { offset: 0, size: 100, hasMore: false }
			})
		});
	});
	await page.route(`**/api/generated-images/${generationId}`, async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				id: generationId,
				prompt: '',
				kind: 'render',
				createdAt: Date.UTC(2026, 0, 1),
				image: media(2, 'https://cdn.example.test/render.webp'),
				source: media(1, 'https://cdn.example.test/scene.jpg'),
				formSnapshot: FORM_SNAPSHOT,
				session: {
					projectId,
					projectTitle: 'Living room',
					sessionId,
					sessionTitle: 'Main thread'
				},
				media: [
					media(2, 'https://cdn.example.test/render.webp'),
					media(1, 'https://cdn.example.test/scene.jpg')
				]
			})
		});
	});
	let projectCreated = false;
	await page.route('**/api/projects', async (route) => {
		if (route.request().method() !== 'POST') return route.fallback();
		projectCreated = true;
		await route.fulfill({ status: 500 });
	});
	let renderBody: unknown;
	await page.route('**/api/render', async (route) => {
		renderBody = route.request().postDataJSON();
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				output: media(3, 'https://cdn.example.test/next-render.webp'),
				cost: 5,
				balance: 95
			})
		});
	});

	await page.goto('/create/interior?view=chat&format=webp');
	await page.getByRole('button', { name: 'Сцены' }).click();
	await page.locator('.image-frame.result-frame').hover();
	await page.getByRole('button', { name: /Восстановить настройки сцены/ }).click();

	await expect(page).toHaveURL(new RegExp(`project=${projectId}&session=${sessionId}`));
	const renderPanel = page.locator('#mode-panel-render');
	await expect(renderPanel.locator('.image-wrapper img')).toHaveAttribute(
		'src',
		'https://cdn.example.test/render.webp'
	);

	await Promise.all([
		page.waitForResponse((response) => response.url().endsWith('/api/render') && response.ok()),
		renderPanel.getByRole('button', { name: 'Сгенерировать' }).click()
	]);
	expect(renderBody).toMatchObject({ sessionId });
	expect(projectCreated).toBe(false);
});
