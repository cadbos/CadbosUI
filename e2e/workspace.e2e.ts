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

import type { Locator, Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { mockProjectSessionRoutes } from './helpers/project-session-routes';

function promptPreview(page: Page): Locator {
	return page.getByLabel('Итоговый промпт').filter({ visible: true });
}

async function openCreate(page: Page): Promise<void> {
	await page.goto('/create/interior?view=chat&format=webp');
}

async function dragBy(page: Page, locator: Locator, deltaX: number, deltaY: number): Promise<void> {
	const bounds = await locator.boundingBox();
	if (!bounds) throw new Error('drag target bounds missing');
	const startX = bounds.x + bounds.width / 2;
	const startY = bounds.y + bounds.height / 2;
	await page.mouse.move(startX, startY);
	await page.mouse.down();
	await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 5 });
	await page.mouse.up();
}

function localDateLabel(createdAt: number): string {
	const parts = new Intl.DateTimeFormat('ru', {
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	}).formatToParts(new Date(createdAt));
	const day = parts.find((part) => part.type === 'day')?.value;
	const month = parts.find((part) => part.type === 'month')?.value;
	const year = parts.find((part) => part.type === 'year')?.value;
	if (!day || !month || !year) throw new Error('generated image date parts missing');
	return `${day} ${month} ${year}`;
}

function localTimeLabel(createdAt: number): string {
	return new Intl.DateTimeFormat('ru', {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hourCycle: 'h23'
	}).format(new Date(createdAt));
}

test('renders the workspace and switches views', async ({ page }) => {
	await openCreate(page);
	await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await expect(page.getByRole('tab', { name: 'Чат' })).toHaveAttribute('aria-selected', 'true');
});

test('hides scenes for anonymous users', async ({ page }) => {
	await openCreate(page);

	await expect(page.getByRole('button', { name: 'Сцены' })).toHaveCount(0);
});

test('keeps the default tools panel usable inside the viewport', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 600 });
	await openCreate(page);

	const panel = page.locator('.floating-tools-panel').filter({ visible: true });
	const panelBar = panel.locator('.panel-bar');
	const workspaceHeader = page.locator('.workspace-header');
	await expect(panelBar).toHaveAttribute('aria-expanded', 'true');

	const headerBounds = await workspaceHeader.boundingBox();
	const barBounds = await panelBar.boundingBox();
	const panelBounds = await panel.boundingBox();
	if (!headerBounds || !barBounds || !panelBounds) throw new Error('workspace bounds missing');
	expect(barBounds.y).toBeGreaterThanOrEqual(headerBounds.y + headerBounds.height + 16);
	expect(barBounds.y + barBounds.height).toBeLessThanOrEqual(600 - 16);
	expect(panelBounds.y + panelBounds.height).toBeLessThanOrEqual(600 - 16);
});

test('keeps the tools panel bar recoverable while the body extends below the viewport', async ({
	page
}) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.addInitScript(() => {
		localStorage.setItem(
			'cadbos.toolsPanel.v1',
			JSON.stringify({ open: false, position: { x: 100, y: 0 }, width: null })
		);
	});
	await openCreate(page);

	const panel = page.locator('.floating-tools-panel').filter({ visible: true });
	const panelBar = panel.locator('.panel-bar');
	const workspaceHeader = page.locator('.workspace-header');
	await expect(panelBar).toHaveAttribute('aria-expanded', 'false');

	const headerBounds = await workspaceHeader.boundingBox();
	const restoredBounds = await panel.boundingBox();
	if (!headerBounds || !restoredBounds) throw new Error('workspace bounds missing');
	expect(restoredBounds.y).toBeGreaterThanOrEqual(headerBounds.y + headerBounds.height + 16);

	await dragBy(page, panelBar, 0, -2000);
	const topBounds = await panelBar.boundingBox();
	if (!topBounds) throw new Error('top-clamped panel bar bounds missing');
	expect(topBounds.y).toBeGreaterThanOrEqual(headerBounds.y + headerBounds.height + 16);

	await dragBy(page, panelBar, 0, 2000);
	const bottomBounds = await panelBar.boundingBox();
	if (!bottomBounds) throw new Error('bottom-clamped panel bar bounds missing');
	expect(bottomBounds.y + bottomBounds.height).toBeLessThanOrEqual(800 - 16);

	await panelBar.click();
	await expect(panelBar).toHaveAttribute('aria-expanded', 'true');
	const expandedBarBounds = await panelBar.boundingBox();
	const expandedBounds = await panel.boundingBox();
	if (!expandedBarBounds || !expandedBounds) throw new Error('expanded panel bounds missing');
	expect(expandedBarBounds.y).toBe(bottomBounds.y);
	expect(expandedBounds.y + expandedBounds.height).toBeGreaterThan(800);

	await page.setViewportSize({ width: 1280, height: 700 });
	await expect
		.poll(async () => {
			const bounds = await panelBar.boundingBox();
			if (!bounds) throw new Error('resized panel bar bounds missing');
			return bounds.y + bounds.height;
		})
		.toBeLessThanOrEqual(700 - 16);
	const resizedBounds = await panel.boundingBox();
	if (!resizedBounds) throw new Error('resized panel bounds missing');
	expect(resizedBounds.y + resizedBounds.height).toBeGreaterThan(700);

	await dragBy(page, panelBar, -2000, 0);
	const leftBounds = await panelBar.boundingBox();
	if (!leftBounds) throw new Error('left-clamped panel bar bounds missing');
	expect(leftBounds.x).toBeGreaterThanOrEqual(16);

	await dragBy(page, panelBar, 2000, 0);
	const rightBounds = await panelBar.boundingBox();
	if (!rightBounds) throw new Error('right-clamped panel bar bounds missing');
	expect(rightBounds.x + rightBounds.width).toBeLessThanOrEqual(1280 - 16);

	const resizeHandle = panel.getByRole('slider', { name: 'Изменить ширину панели инструментов' });
	await resizeHandle.press('End');
	const widenedBounds = await panelBar.boundingBox();
	if (!widenedBounds) throw new Error('widened panel bar bounds missing');
	expect(widenedBounds.x + widenedBounds.width).toBeLessThanOrEqual(1280 - 16);
});

test('shows authenticated scenes newest first', async ({ page }) => {
	let deletedImageId: string | null = null;
	const oldestCreatedAt = Date.UTC(2026, 0, 1, 12);
	const middleCreatedAt = Date.UTC(2026, 0, 2, 12);
	const newestCreatedAt = Date.UTC(2026, 0, 3, 12);

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
		if (route.request().method() === 'DELETE') {
			const body = route.request().postDataJSON() as { id: string };
			deletedImageId = body.id;
			await route.fulfill({ status: 204 });
			return;
		}

		const url = new URL(route.request().url());
		const offset = url.searchParams.get('offset');
		const images =
			offset === '0'
				? [
						{
							id: 'oldest',
							url: 'https://cdn.example.test/oldest.webp',
							sourceUrl: 'https://cdn.example.test/oldest-source.jpg',
							kind: 'render',
							createdAt: oldestCreatedAt
						},
						{
							id: 'newest',
							url: 'https://cdn.example.test/newest.webp',
							sourceUrl: 'https://cdn.example.test/newest-source.jpg',
							kind: 'style-transfer',
							createdAt: newestCreatedAt
						}
					]
				: [
						{
							id: 'middle',
							url: 'https://cdn.example.test/middle.webp',
							sourceUrl: 'https://cdn.example.test/middle-source.jpg',
							kind: 'edit',
							createdAt: middleCreatedAt
						}
					];

		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				images,
				pagination: { offset: Number(offset), size: 100, hasMore: offset === '0' }
			})
		});
	});
	await page.route('**/api/download**', async (route) => {
		const url = new URL(route.request().url());
		const filename = url.searchParams.get('filename');
		expect(filename).not.toBeNull();
		await route.fulfill({
			status: 200,
			headers: {
				'content-type': filename?.endsWith('.jpg') ? 'image/jpeg' : 'image/webp',
				'content-disposition': `attachment; filename="${filename}"`
			},
			body: 'image-bytes'
		});
	});
	await openCreate(page);

	const scenesButton = page.getByRole('button', { name: 'Сцены', exact: true });
	await expect(scenesButton).toHaveAttribute('aria-expanded', 'false');
	await scenesButton.click();
	await expect(scenesButton).toHaveAttribute('aria-expanded', 'true');
	await expect(page.getByRole('heading', { name: 'Сцены', exact: true })).toBeVisible();
	const images = page.getByRole('img', { name: /Результат сцены/ });
	await expect(images).toHaveCount(3);
	await expect(images.nth(0)).toHaveAttribute('src', 'https://cdn.example.test/newest.webp');
	await expect(images.nth(1)).toHaveAttribute('src', 'https://cdn.example.test/middle.webp');
	await expect(images.nth(2)).toHaveAttribute('src', 'https://cdn.example.test/oldest.webp');
	const flowKinds = page.locator('.flow-kind');
	await expect(flowKinds).toHaveCount(3);
	expect(
		await flowKinds.evaluateAll((elements) => elements.map((element) => element.ariaLabel))
	).toEqual(['Миграция стиля', 'Редактирование', 'Генерация']);
	const generatedDates = page.locator('time');
	await expect(generatedDates.nth(0).locator('span')).toHaveText([
		localDateLabel(newestCreatedAt),
		localTimeLabel(newestCreatedAt)
	]);
	await expect(generatedDates.nth(1).locator('span')).toHaveText([
		localDateLabel(middleCreatedAt),
		localTimeLabel(middleCreatedAt)
	]);
	await expect(generatedDates.nth(2).locator('span')).toHaveText([
		localDateLabel(oldestCreatedAt),
		localTimeLabel(oldestCreatedAt)
	]);
	await expect(generatedDates.nth(0)).toHaveAttribute(
		'datetime',
		new Date(newestCreatedAt).toISOString()
	);

	const sourceImages = page.getByRole('img', { name: /Исходное изображение сцены/ });
	await sourceImages.nth(0).hover();
	const sourceDownloadPromise = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Скачать исходник сцены 1' }).click();
	const sourceDownload = await sourceDownloadPromise;
	expect(sourceDownload.suggestedFilename()).toBe('generated-image-newest-source.jpg');

	await page.getByRole('button', { name: 'Обработать исходник сцены 1' }).click();
	await expect(page).toHaveURL(/\/style-transfer\/interior\?.*source=room-photo/);
	await expect(page.getByRole('img', { name: 'Фото комнаты' })).toHaveAttribute(
		'src',
		'https://cdn.example.test/newest-source.jpg'
	);

	await scenesButton.click();
	const useResultButton = page.getByRole('button', { name: 'Обработать результат сцены 2' });
	await useResultButton.focus();
	await useResultButton.press('Enter');
	await expect(page).toHaveURL(/\/edit\?tool=freeform/);
	await expect(page.getByRole('tab', { name: 'Свой промпт' })).toHaveAttribute(
		'aria-selected',
		'true'
	);
	await expect(page.getByRole('img', { name: 'Фото комнаты' })).toHaveAttribute(
		'src',
		'https://cdn.example.test/middle.webp'
	);

	await scenesButton.click();

	const downloadButton = page.getByRole('button', {
		name: 'Скачать результат сцены 1'
	});
	await downloadButton.focus();
	const downloadPromise = page.waitForEvent('download');
	await downloadButton.press('Enter');
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toBe('generated-image-newest.webp');

	const deleteButton = page.getByRole('button', { name: 'Удалить сцену 2' });
	await deleteButton.focus();
	await deleteButton.press('Enter');

	const dialog = page.getByRole('dialog', { name: 'Удалить сцену?' });
	await expect(dialog).toBeVisible();
	await expect(dialog.getByText('Это действие необратимо.')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Удалить сцену 1' })).toHaveCount(0);
	expect(deletedImageId).toBeNull();

	await dialog.getByRole('button', { name: 'Удалить', exact: true }).click();

	expect(deletedImageId).toBe('middle');
	await expect(images).toHaveCount(2);
	await expect(images.nth(0)).toHaveAttribute('src', 'https://cdn.example.test/newest.webp');
	await expect(images.nth(1)).toHaveAttribute('src', 'https://cdn.example.test/oldest.webp');
	await expect(generatedDates.nth(0).locator('span')).toHaveText([
		localDateLabel(newestCreatedAt),
		localTimeLabel(newestCreatedAt)
	]);
	await expect(generatedDates.nth(1).locator('span')).toHaveText([
		localDateLabel(oldestCreatedAt),
		localTimeLabel(oldestCreatedAt)
	]);
});

test('switches to the graph view and edits fragment nodes reflected in key-value', async ({
	page
}) => {
	await page.setViewportSize({ width: 1024, height: 768 });
	await openCreate(page);

	const graphTab = page.getByRole('tab', { name: 'Граф' });
	await graphTab.click();
	await expect(graphTab).toHaveAttribute('aria-selected', 'true');

	await page.getByRole('button', { name: 'Добавить узел фрагмента' }).click();
	const fragmentNode = page.getByRole('textbox', { name: 'Узел фрагмента 1' });
	await expect(fragmentNode).toBeVisible();
	await fragmentNode.fill('cozy reading nook');
	await page.getByRole('button', { name: 'Добавить узел фрагмента' }).click();
	await page.getByRole('textbox', { name: 'Узел фрагмента 2' }).fill('warm natural light');
	await page.getByRole('button', { name: 'Удалить узел фрагмента 1' }).click();

	await expect(promptPreview(page)).toHaveValue('warm natural light');

	await page.getByRole('tab', { name: 'Ключ-значение' }).click();
	await expect(page.getByLabel('Текст 1')).toHaveValue('warm natural light');
	await expect(page.getByLabel('Текст 2')).toHaveCount(0);
});

test('the graph view stays usable on a narrow (phone-sized) screen', async ({ page }) => {
	await page.setViewportSize({ width: 375, height: 800 });
	await openCreate(page);

	const graphTab = page.getByRole('tab', { name: 'Граф' });
	await graphTab.click();
	await expect(graphTab).toHaveAttribute('aria-selected', 'true');

	const addButton = page.getByRole('button', { name: 'Добавить узел фрагмента' });
	await expect(addButton).toBeVisible();
	await addButton.click();
	await expect(page.getByRole('textbox', { name: 'Узел фрагмента 1' })).toBeVisible();
});

test('keeps the prompt byte-identical when switching from chat to graph', async ({ page }) => {
	await page.setViewportSize({ width: 1024, height: 768 });
	await openCreate(page);
	await expect(page).toHaveURL(/\/create\/interior\?view=chat&format=webp$/);
	const prompt = 'Scandinavian style, warm natural light';

	const chatPrompt = page.getByRole('textbox', { name: 'Промпт чата' });
	await chatPrompt.fill(prompt);
	await expect(chatPrompt).toHaveValue(prompt);

	await page.getByRole('tab', { name: 'Граф' }).click();
	await expect(page.getByRole('tab', { name: 'Граф' })).toHaveAttribute('aria-selected', 'true');

	await expect(promptPreview(page)).toHaveValue(prompt);
});

test('key-value edits survive a round trip through the chat tab', async ({ page }) => {
	await openCreate(page);

	await page.getByRole('tab', { name: 'Ключ-значение' }).click();
	await page.getByRole('button', { name: 'Добавить фрагмент' }).click();
	await page.getByLabel('Текст 1').fill('warm natural light');

	await page.getByRole('tab', { name: 'Чат' }).click();
	await page.getByRole('tab', { name: 'Ключ-значение' }).click();

	await expect(page.getByLabel('Текст 1')).toHaveValue('warm natural light');
});

test('navigates tabs with the keyboard', async ({ page }) => {
	await openCreate(page);
	const promptTabs = page.getByRole('tablist', { name: 'Способ ввода' });
	const chat = promptTabs.getByRole('tab', { name: 'Чат' });
	const keyValue = promptTabs.getByRole('tab', { name: 'Ключ-значение' });

	await expect(chat).toHaveAttribute('aria-selected', 'true');
	await chat.press('ArrowRight');
	await expect(keyValue).toBeFocused();
	await expect(keyValue).toHaveAttribute('aria-selected', 'true');
	await page.getByRole('button', { name: 'Добавить фрагмент' }).click();
	await expect(page.getByLabel('Метка 1')).toBeVisible();

	await keyValue.press('Home');
	await expect(chat).toBeFocused();
	await expect(chat).toHaveAttribute('aria-selected', 'true');
});

test('the Scene Type toggle switches to exterior', async ({ page }) => {
	await openCreate(page);

	const interiorTab = page.getByRole('tab', { name: 'Интерьер' });
	const exteriorTab = page.getByRole('tab', { name: 'Экстерьер' });

	await expect(interiorTab).toHaveAttribute('aria-selected', 'true');

	await exteriorTab.click();
	await expect(exteriorTab).toHaveAttribute('aria-selected', 'true');
	await expect(interiorTab).toHaveAttribute('aria-selected', 'false');
});

test('navigates the Scene Type toggle with the keyboard', async ({ page }) => {
	await openCreate(page);
	const sceneTypeTabs = page.getByRole('tablist', { name: 'Тип сцены' });
	await expect(sceneTypeTabs).toBeVisible();
	const interiorTab = sceneTypeTabs.getByRole('tab', { name: 'Интерьер' });
	const exteriorTab = sceneTypeTabs.getByRole('tab', { name: 'Экстерьер' });

	await interiorTab.focus();
	await page.keyboard.press('ArrowRight');
	await expect(exteriorTab).toBeFocused();
	await expect(exteriorTab).toHaveAttribute('aria-selected', 'true');

	await page.keyboard.press('Home');
	await expect(interiorTab).toBeFocused();
	await expect(interiorTab).toHaveAttribute('aria-selected', 'true');
});

test('generating with the exterior scene type calls the exterior render route', async ({
	page
}) => {
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
	await page.route('**/api/uploads', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				url: 'https://cdn.example.test/facade.webp',
				mime: 'image/webp',
				size: 1024,
				hash: 'facade-hash',
				dimensions: [800, 600]
			})
		});
	});
	await mockProjectSessionRoutes(page);
	let calledExteriorRoute = false;
	let capturedBody:
		| { image: string; prompt: string; outputFormat: string; sceneType?: string }
		| undefined;
	await page.route('**/api/render/exterior', async (route) => {
		calledExteriorRoute = true;
		capturedBody = route.request().postDataJSON() as {
			image: string;
			prompt: string;
			outputFormat: string;
			sceneType?: string;
		};
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				outputUrl: 'https://cdn.example.test/exterior-render.webp',
				cost: 5,
				balance: 95
			})
		});
	});

	await openCreate(page);
	await page.getByRole('tab', { name: 'Экстерьер' }).click();
	// The room/main photo upload is deferred to generate time — picking the
	// file only produces a local (blob:) preview here, no /api/uploads call yet.
	await page
		.locator('#mode-panel-render input[type="file"]')
		.setInputFiles({ name: 'house.png', mimeType: 'image/png', buffer: Buffer.from('fake-image') });
	const uploadedImage = page.locator('#mode-panel-render .image-wrapper img');
	await expect(uploadedImage).toHaveAttribute('src', /^blob:/);
	const uploadViewportStyles = await uploadedImage.evaluate((image) => {
		const viewport = image.parentElement;
		if (!viewport) throw new Error('uploaded image viewport missing');
		const viewportStyle = getComputedStyle(viewport);
		const imageStyle = getComputedStyle(image);
		return {
			aspectRatio: viewportStyle.aspectRatio,
			backgroundColor: viewportStyle.backgroundColor,
			objectFit: imageStyle.objectFit
		};
	});
	expect(uploadViewportStyles).toEqual({
		aspectRatio: '16 / 9',
		backgroundColor: 'rgb(245, 245, 247)',
		objectFit: 'contain'
	});
	await Promise.all([
		page.waitForResponse((response) => response.url().includes('/api/uploads') && response.ok()),
		page.waitForResponse(
			(response) => response.url().endsWith('/api/render/exterior') && response.ok()
		),
		page.getByRole('button', { name: 'Сгенерировать' }).click()
	]);

	await expect(page.getByRole('img', { name: 'Сгенерировать' })).toHaveAttribute(
		'src',
		'https://cdn.example.test/exterior-render.webp'
	);
	expect(calledExteriorRoute).toBe(true);
	expect(capturedBody?.sceneType).toBeUndefined();
});

test('serves security headers and a content security policy', async ({ request }) => {
	const response = await request.get('/');
	const headers = response.headers();

	expect(headers['x-content-type-options']).toBe('nosniff');
	expect(headers['x-frame-options']).toBe('DENY');
	expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
	expect(headers['permissions-policy']).toContain('geolocation=()');
	expect(headers['content-security-policy']).toContain("default-src 'self'");
});
