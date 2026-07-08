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

async function mockUpload(page: Page): Promise<void> {
	await page.route('**/api/uploads', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				url: 'https://cdn.example.test/uploaded.webp',
				mime: 'image/webp',
				size: 1024,
				dimensions: [800, 600]
			})
		});
	});
}

test('the Edit tab lets you upload an image directly, without generating a render first', async ({
	page
}) => {
	await mockUpload(page);

	await page.goto('/');

	const renderTab = page.getByRole('tab', { name: 'Рендер' });
	const editTab = page.getByRole('tab', { name: 'Редактирование' });
	const editPanel = page.locator('#mode-panel-edit');

	await expect(renderTab).toHaveAttribute('aria-selected', 'true');

	await editTab.click();
	await expect(editTab).toHaveAttribute('aria-selected', 'true');
	await expect(editPanel.getByRole('button', { name: 'Выбрать файл' })).toBeVisible();

	// Anonymous users can pick an image and draft an instruction, but must sign in
	// before spending a paid edit call.
	await editPanel
		.locator('input[type="file"]')
		.setInputFiles({ name: 'room.png', mimeType: 'image/png', buffer: Buffer.from('fake-image') });
	await expect(editPanel.getByRole('button', { name: 'Изменить фото' })).toBeVisible();
	await page.getByLabel('Инструкция для правки').fill('Replace the sofa');
	await expect(page.getByText('Войдите, чтобы применить правку')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Применить правку' })).toBeDisabled();

	// The uploaded photo is the same underlying image used by the Render tab.
	await renderTab.click();
	await expect(
		page.locator('#mode-panel-render').getByRole('button', { name: 'Изменить фото' })
	).toBeVisible();
});

test('applying an edit directly from an uploaded image (no prior render) produces a result', async ({
	page
}) => {
	await authenticate(page);
	await mockUpload(page);
	await page.route('**/api/edit', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				outputUrl: 'https://cdn.example.test/edited.webp',
				cost: 3,
				balance: 97
			})
		});
	});

	await page.goto('/');

	await page.getByRole('tab', { name: 'Редактирование' }).click();
	await page
		.locator('#mode-panel-edit input[type="file"]')
		.setInputFiles({ name: 'room.png', mimeType: 'image/png', buffer: Buffer.from('fake-image') });

	await page.getByLabel('Инструкция для правки').fill('Replace the sofa with an armchair');
	await page.getByRole('button', { name: 'Применить правку' }).click();

	await expect(page.getByRole('img', { name: 'Сгенерировать' })).toHaveAttribute(
		'src',
		'https://cdn.example.test/edited.webp'
	);
	// Once a result exists, the Edit tab no longer offers a raw upload — it edits
	// the result itself, same as the post-render flow.
	await expect(page.locator('#mode-panel-edit input[type="file"]')).toHaveCount(0);
});

test('a failed edit request surfaces the error in the Edit tab instead of a result', async ({
	page
}) => {
	await authenticate(page);
	await mockUpload(page);
	await page.route('**/api/edit', async (route) => {
		await route.fulfill({
			status: 500,
			contentType: 'application/json',
			body: JSON.stringify({ error: { code: 'edit_failed', message: 'boom' } })
		});
	});

	await page.goto('/');

	await page.getByRole('tab', { name: 'Редактирование' }).click();
	await page
		.locator('#mode-panel-edit input[type="file"]')
		.setInputFiles({ name: 'room.png', mimeType: 'image/png', buffer: Buffer.from('fake-image') });

	await page.getByLabel('Инструкция для правки').fill('Replace the sofa with an armchair');
	await page.getByRole('button', { name: 'Применить правку' }).click();

	await expect(page.getByRole('alert')).toHaveText(
		'Не удалось применить правку. Попробуйте ещё раз.'
	);
	await expect(page.getByRole('img', { name: 'Сгенерировать' })).toHaveCount(0);
});

test('generating a render makes the Edit tab usable, reachable independent of the generate action', async ({
	page
}) => {
	await authenticate(page);
	await mockUpload(page);
	await page.route('**/api/render', async (route) => {
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

	await page.goto('/');

	await page
		.locator('#mode-panel-render input[type="file"]')
		.setInputFiles({ name: 'room.png', mimeType: 'image/png', buffer: Buffer.from('fake-image') });
	await expect(
		page.locator('#mode-panel-render').getByRole('button', { name: 'Изменить фото' })
	).toBeVisible();

	await page.getByRole('button', { name: 'Сгенерировать' }).click();
	await expect(page.getByRole('img', { name: 'Сгенерировать' })).toBeVisible();

	const editTab = page.getByRole('tab', { name: 'Редактирование' });
	await page.getByRole('button', { name: 'Редактировать' }).click();
	await expect(editTab).toHaveAttribute('aria-selected', 'true');
	await expect(page.getByLabel('Инструкция для правки')).toBeVisible();
	await expect(page.locator('#mode-panel-edit input[type="file"]')).toHaveCount(0);

	const renderTab = page.getByRole('tab', { name: 'Рендер' });
	await renderTab.click();
	await expect(page.getByRole('img', { name: 'Сгенерировать' })).toBeVisible();

	await editTab.click();
	await expect(page.getByLabel('Инструкция для правки')).toBeVisible();
});

test('the Add Object tool applies a selected preset to the current image', async ({ page }) => {
	await authenticate(page);
	await mockUpload(page);
	let capturedPrompt: string | undefined;
	await page.route('**/api/edit', async (route) => {
		capturedPrompt = (route.request().postDataJSON() as { prompt: string }).prompt;
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				outputUrl: 'https://cdn.example.test/added-trees.webp',
				cost: 2,
				balance: 90
			})
		});
	});

	await page.goto('/');
	await page.getByRole('tab', { name: 'Редактирование' }).click();
	await page
		.locator('#mode-panel-edit input[type="file"]')
		.setInputFiles({ name: 'room.png', mimeType: 'image/png', buffer: Buffer.from('fake-image') });

	await page.getByRole('tab', { name: 'Добавить объект' }).click();
	const treesPreset = page.getByRole('button', { name: 'Деревья' });
	await expect(treesPreset).toHaveAttribute('aria-pressed', 'false');
	await treesPreset.click();
	await expect(treesPreset).toHaveAttribute('aria-pressed', 'true');
	await page.getByRole('button', { name: 'Добавить объект' }).click();

	await expect(page.getByRole('img', { name: 'Сгенерировать' })).toHaveAttribute(
		'src',
		'https://cdn.example.test/added-trees.webp'
	);
	expect(capturedPrompt).toBe(
		'Добавь деревья за окном, органично вписав их в окружающий ландшафт.'
	);
});

test('the Remove Object tool builds a removal prompt from the described object', async ({
	page
}) => {
	await authenticate(page);
	await mockUpload(page);
	let capturedPrompt: string | undefined;
	await page.route('**/api/edit', async (route) => {
		capturedPrompt = (route.request().postDataJSON() as { prompt: string }).prompt;
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				outputUrl: 'https://cdn.example.test/removed-sofa.webp',
				cost: 2,
				balance: 90
			})
		});
	});

	await page.goto('/');
	await page.getByRole('tab', { name: 'Редактирование' }).click();
	await page
		.locator('#mode-panel-edit input[type="file"]')
		.setInputFiles({ name: 'room.png', mimeType: 'image/png', buffer: Buffer.from('fake-image') });

	await page.getByRole('tab', { name: 'Удалить объект' }).click();
	await page.getByLabel('Что убрать?').fill('старый диван');
	await page.getByRole('button', { name: 'Удалить объект' }).click();

	await expect(page.getByRole('img', { name: 'Сгенерировать' })).toHaveAttribute(
		'src',
		'https://cdn.example.test/removed-sofa.webp'
	);
	expect(capturedPrompt).toBe(
		'Убери с изображения старый диван, аккуратно восстановив то, что было на его месте.'
	);
});
