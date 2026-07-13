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

import { expect, test, type Page, type Route } from '@playwright/test';

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

function styleTransferUploadUrl(route: Route): string {
	const body = route.request().postDataBuffer();
	if (body === null) throw new Error('Upload request body is missing');
	if (body.includes(Buffer.from('room'))) return 'https://cdn.example.test/source.webp';
	if (body.includes(Buffer.from('reference'))) return 'https://cdn.example.test/reference.webp';
	throw new Error('Upload request body does not match the style transfer fixtures');
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

test('the shared image picker imports an HTTPS image URL through the upload endpoint', async ({
	page
}) => {
	let uploadBody: unknown;
	await page.route('**/api/uploads', async (route) => {
		uploadBody = route.request().postDataJSON();
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				url: 'https://cdn.example.test/imported.webp',
				mime: 'image/webp',
				size: 1024,
				dimensions: [800, 600]
			})
		});
	});

	await page.goto('/');
	const renderPanel = page.locator('#mode-panel-render');
	await renderPanel
		.getByLabel('Ссылка на изображение')
		.fill('https://images.example.com/room.webp');
	await renderPanel.getByRole('button', { name: 'Импортировать' }).click();

	await expect(renderPanel.getByRole('button', { name: 'Изменить фото' })).toBeVisible();
	expect(uploadBody).toEqual({ url: 'https://images.example.com/room.webp' });

	await renderPanel.getByLabel('Ссылка на изображение').fill('http://images.example.com/room.webp');
	await renderPanel.getByRole('button', { name: 'Импортировать' }).click();
	await expect(
		renderPanel.getByText('Введите корректную HTTPS-ссылку на изображение.')
	).toBeVisible();
	expect(uploadBody).toEqual({ url: 'https://images.example.com/room.webp' });
});

test('the Style transfer tab uploads a reference and submits transfer settings', async ({
	page
}) => {
	await authenticate(page);
	let capturedBody: unknown = null;
	await page.route('**/api/uploads', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				url: styleTransferUploadUrl(route),
				mime: 'image/webp',
				size: 1024,
				dimensions: [800, 600]
			})
		});
	});
	await page.route('**/api/style-transfer', async (route) => {
		capturedBody = route.request().postDataJSON();
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				outputUrl: 'https://cdn.example.test/styled.webp',
				cost: 4,
				balance: 96
			})
		});
	});

	await page.goto('/');

	const panel = page.locator('#mode-panel-styleTransfer');
	await page.getByRole('tab', { name: 'Перенос стиля' }).click();
	await expect(page.getByRole('tab', { name: 'Перенос стиля' })).toHaveAttribute(
		'aria-selected',
		'true'
	);
	await expect(panel.getByRole('button', { name: 'Перенести стиль' })).toBeDisabled();

	const sourceUpload = panel.getByRole('region', { name: 'Исходное изображение' });
	await sourceUpload.locator('input[type="file"]').setInputFiles({
		name: 'room.png',
		mimeType: 'image/png',
		buffer: Buffer.from('room')
	});
	await expect(sourceUpload.getByRole('button', { name: 'Изменить фото' })).toBeVisible();

	await panel.getByRole('tab', { name: 'Свои' }).click();
	const referenceUpload = panel.getByRole('region', { name: 'Референс стиля' });
	await referenceUpload.locator('input[type="file"]').setInputFiles({
		name: 'reference.png',
		mimeType: 'image/png',
		buffer: Buffer.from('reference')
	});
	await panel
		.getByPlaceholder('Скандинавский стиль, тёплые тона, натуральный свет…')
		.fill('keep layout, use warmer materials');
	await panel.getByRole('slider', { name: 'Сила переноса' }).fill('0.35');
	await panel.getByText('Дополнительно').click();
	await panel.getByLabel('Что исключить').fill('people');

	await panel.getByRole('button', { name: 'Перенести стиль' }).click();

	expect(capturedBody).toEqual({
		image: 'https://cdn.example.test/source.webp',
		referenceImage: 'https://cdn.example.test/reference.webp',
		outputFormat: 'webp',
		prompt: 'keep layout, use warmer materials',
		negativePrompt: 'people',
		styleTransferStrength: 0.35
	});
	await expect(page.getByRole('img', { name: 'Сгенерировать' })).toHaveAttribute(
		'src',
		'https://cdn.example.test/styled.webp'
	);
});

test('render prompt and style transfer guidance stay isolated across tab switches', async ({
	page
}) => {
	await authenticate(page);
	let renderBody: unknown = null;
	let styleTransferBody: unknown = null;
	await page.route('**/api/uploads', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				url: styleTransferUploadUrl(route),
				mime: 'image/webp',
				size: 1024,
				dimensions: [800, 600]
			})
		});
	});
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
	await page.route('**/api/style-transfer', async (route) => {
		styleTransferBody = route.request().postDataJSON();
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				outputUrl: 'https://cdn.example.test/styled.webp',
				cost: 4,
				balance: 91
			})
		});
	});

	await page.goto('/');

	const renderPanel = page.locator('#mode-panel-render');
	await renderPanel
		.locator('input[type="file"]')
		.setInputFiles({ name: 'room.png', mimeType: 'image/png', buffer: Buffer.from('room') });
	await renderPanel
		.getByPlaceholder('Скандинавский стиль, тёплые тона, натуральный свет…')
		.fill('render prompt for paid generation');

	const styleTransferTab = page.getByRole('tab', { name: 'Перенос стиля' });
	await styleTransferTab.click();
	const stylePanel = page.locator('#mode-panel-styleTransfer');
	await stylePanel.getByRole('tab', { name: 'Свои' }).click();
	const referenceUpload = stylePanel.getByRole('region', { name: 'Референс стиля' });
	await referenceUpload.locator('input[type="file"]').setInputFiles({
		name: 'reference.png',
		mimeType: 'image/png',
		buffer: Buffer.from('reference')
	});
	await stylePanel
		.getByPlaceholder('Скандинавский стиль, тёплые тона, натуральный свет…')
		.fill('style transfer guidance only');
	await stylePanel.getByRole('button', { name: 'Перенести стиль' }).click();

	expect(styleTransferBody).toEqual({
		image: 'https://cdn.example.test/source.webp',
		referenceImage: 'https://cdn.example.test/reference.webp',
		outputFormat: 'webp',
		prompt: 'style transfer guidance only',
		styleTransferStrength: 0.7
	});

	await page.getByRole('tab', { name: 'Рендер' }).click();
	await renderPanel.getByRole('button', { name: 'Сгенерировать' }).click();

	expect(renderBody).toEqual({
		image: 'https://cdn.example.test/source.webp',
		prompt: 'render prompt for paid generation',
		outputFormat: 'webp'
	});
});

test('the Style transfer tab lets you pick a ready-made photorealistic preset as the reference', async ({
	page
}) => {
	await authenticate(page);
	await mockUpload(page);
	let capturedBody: unknown = null;
	await page.route('**/api/style-transfer', async (route) => {
		capturedBody = route.request().postDataJSON();
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				outputUrl: 'https://cdn.example.test/styled.webp',
				cost: 4,
				balance: 96
			})
		});
	});

	await page.goto('/');

	const panel = page.locator('#mode-panel-styleTransfer');
	await page.getByRole('tab', { name: 'Перенос стиля' }).click();

	await panel
		.locator('input[type="file"][aria-label="Исходное изображение"]')
		.setInputFiles({ name: 'room.png', mimeType: 'image/png', buffer: Buffer.from('room') });

	const presetTab = panel.getByRole('tab', { name: 'Реалистичные' });
	await expect(presetTab).toHaveAttribute('aria-selected', 'true');

	const preset = panel.getByRole('radio', { name: 'Спа-ванная из бетона' });
	await preset.click();
	await expect(preset).toHaveAttribute('aria-checked', 'true');

	await panel.getByRole('button', { name: 'Перенести стиль' }).click();

	expect(capturedBody).toMatchObject({
		image: 'https://cdn.example.test/uploaded.webp',
		referenceImage:
			'https://style-presets.cadbos.com/interior/photorealistic/concrete-spa-bathroom.webp',
		outputFormat: 'webp'
	});
});

test('switching scene type clears a selected conceptual preset instead of keeping the stale reference image', async ({
	page
}) => {
	await authenticate(page);
	await mockUpload(page);

	await page.goto('/');

	const panel = page.locator('#mode-panel-styleTransfer');
	await page.getByRole('tab', { name: 'Перенос стиля' }).click();

	await panel
		.locator('input[type="file"][aria-label="Исходное изображение"]')
		.setInputFiles({ name: 'room.png', mimeType: 'image/png', buffer: Buffer.from('room') });

	await panel.getByRole('tab', { name: 'Концептуальные' }).click();
	const ukiyoE = panel.getByRole('radio', { name: 'Укиё-э' });
	await ukiyoE.click();
	await expect(ukiyoE).toHaveAttribute('aria-checked', 'true');
	await expect(panel.getByRole('button', { name: 'Перенести стиль' })).toBeEnabled();

	// Interior and exterior conceptual presets reuse the same id/label
	// ("Укиё-э"), so this switch must not leave the exterior tile looking
	// selected while the reference image still points at the interior asset.
	await panel.getByRole('tab', { name: 'Экстерьер' }).click();

	await expect(panel.getByRole('radio', { name: 'Укиё-э' })).toHaveAttribute(
		'aria-checked',
		'false'
	);
	await expect(panel.getByRole('button', { name: 'Перенести стиль' })).toBeDisabled();
});

test('switching from a custom reference upload back to a preset tab clears the uploaded image', async ({
	page
}) => {
	await authenticate(page);
	let capturedBody: unknown = null;
	await page.route('**/api/uploads', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				url: styleTransferUploadUrl(route),
				mime: 'image/webp',
				size: 1024,
				dimensions: [800, 600]
			})
		});
	});
	await page.route('**/api/style-transfer', async (route) => {
		capturedBody = route.request().postDataJSON();
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				outputUrl: 'https://cdn.example.test/styled.webp',
				cost: 4,
				balance: 96
			})
		});
	});

	await page.goto('/');

	const panel = page.locator('#mode-panel-styleTransfer');
	await page.getByRole('tab', { name: 'Перенос стиля' }).click();

	const sourceUpload = panel.getByRole('region', { name: 'Исходное изображение' });
	await sourceUpload.locator('input[type="file"]').setInputFiles({
		name: 'room.png',
		mimeType: 'image/png',
		buffer: Buffer.from('room')
	});

	await panel.getByRole('tab', { name: 'Свои' }).click();
	const referenceUpload = panel.getByRole('region', { name: 'Референс стиля' });
	await referenceUpload.locator('input[type="file"]').setInputFiles({
		name: 'reference.png',
		mimeType: 'image/png',
		buffer: Buffer.from('reference')
	});
	await expect(panel.getByRole('button', { name: 'Перенести стиль' })).toBeEnabled();

	await panel.getByRole('tab', { name: 'Реалистичные' }).click();
	await expect(panel.getByRole('button', { name: 'Перенести стиль' })).toBeDisabled();

	const preset = panel.getByRole('radio', { name: 'Спа-ванная из бетона' });
	await preset.click();
	await panel.getByRole('button', { name: 'Перенести стиль' }).click();

	// The submitted reference must be the freshly selected preset, not the
	// custom upload left over from the earlier "Custom" tab.
	expect(capturedBody).toMatchObject({
		referenceImage:
			'https://style-presets.cadbos.com/interior/photorealistic/concrete-spa-bathroom.webp'
	});
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

test('the result toolbar supports undo/redo, comparing before/after, and upscaling to 4K', async ({
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
	await page.route('**/api/edit', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				outputUrl: 'https://cdn.example.test/edited.webp',
				cost: 3,
				balance: 92
			})
		});
	});
	await page.route('**/api/upscale', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				outputUrl: 'https://cdn.example.test/edited-4k.webp',
				cost: 4,
				balance: 88
			})
		});
	});

	await page.goto('/');

	await page
		.locator('#mode-panel-render input[type="file"]')
		.setInputFiles({ name: 'room.png', mimeType: 'image/png', buffer: Buffer.from('fake-image') });
	await page.getByRole('button', { name: 'Сгенерировать' }).click();

	const resultImage = page.getByRole('img', { name: 'Сгенерировать' });
	await expect(resultImage).toHaveAttribute('src', 'https://cdn.example.test/render.webp');

	const undoButton = page.getByRole('button', { name: 'Отменить' });
	const redoButton = page.getByRole('button', { name: 'Повторить' });
	const compareButton = page.getByRole('button', { name: 'Сравнить до/после' });
	const upscaleButton = page.getByRole('button', { name: 'Улучшить до 4K' });

	// Undo/redo/compare have nothing to act on before any edit exists yet.
	await expect(undoButton).toBeDisabled();
	await expect(redoButton).toBeDisabled();
	await expect(compareButton).toBeDisabled();

	await page.getByRole('button', { name: 'Редактировать' }).click();
	await page.getByLabel('Инструкция для правки').fill('Replace the sofa with an armchair');
	await page.getByRole('button', { name: 'Применить правку' }).click();
	await expect(resultImage).toHaveAttribute('src', 'https://cdn.example.test/edited.webp');

	await expect(undoButton).toBeEnabled();
	await expect(compareButton).toBeEnabled();

	await compareButton.click();
	await expect(page.getByText('До', { exact: true })).toBeVisible();
	await expect(page.getByText('После', { exact: true })).toBeVisible();
	await compareButton.click();

	await undoButton.click();
	await expect(resultImage).toHaveAttribute('src', 'https://cdn.example.test/render.webp');
	await expect(undoButton).toBeDisabled();
	await expect(redoButton).toBeEnabled();

	await redoButton.click();
	await expect(resultImage).toHaveAttribute('src', 'https://cdn.example.test/edited.webp');
	await expect(redoButton).toBeDisabled();

	await upscaleButton.click();
	await expect(resultImage).toHaveAttribute('src', 'https://cdn.example.test/edited-4k.webp');
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
				outputUrl: 'https://cdn.example.test/added-mirror.webp',
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
	const mirrorPreset = page.getByRole('radio', { name: 'Зеркало' });
	await expect(mirrorPreset).toHaveAttribute('aria-checked', 'false');
	await mirrorPreset.click();
	await expect(mirrorPreset).toHaveAttribute('aria-checked', 'true');
	await page.getByRole('button', { name: 'Добавить объект' }).click();

	await expect(page.getByRole('img', { name: 'Сгенерировать' })).toHaveAttribute(
		'src',
		'https://cdn.example.test/added-mirror.webp'
	);
	expect(capturedPrompt).toBe(
		'Добавь большое декоративное зеркало на стену, чтобы комната казалась просторнее.'
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

test('the Atmosphere tool applies the exterior variant of a lighting preset', async ({ page }) => {
	await authenticate(page);
	await mockUpload(page);
	let capturedPrompt: string | undefined;
	await page.route('**/api/edit', async (route) => {
		capturedPrompt = (route.request().postDataJSON() as { prompt: string }).prompt;
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				outputUrl: 'https://cdn.example.test/golden-hour.webp',
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

	await page.getByRole('tab', { name: 'Атмосфера' }).click();
	await page.getByRole('tab', { name: 'Экстерьер' }).click();
	await page.getByRole('radio', { name: 'Золотой час' }).click();
	await page.getByRole('button', { name: 'Применить' }).click();

	await expect(page.getByRole('img', { name: 'Сгенерировать' })).toHaveAttribute(
		'src',
		'https://cdn.example.test/golden-hour.webp'
	);
	expect(capturedPrompt).toBe(
		'Измени освещение на золотой час: тёплый закатный свет с длинными тенями.'
	);
});
