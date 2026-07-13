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

import { expect, test, type Locator, type Page } from '@playwright/test';

function promptPreview(page: Page): Locator {
	return page.getByLabel('Итоговый промпт').filter({ visible: true });
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
	await page.goto('/');
	await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await expect(page.getByRole('tab', { name: 'Чат' })).toHaveAttribute('aria-selected', 'true');
});

test('hides generated image sidebar for anonymous users', async ({ page }) => {
	await page.goto('/');

	await expect(page.getByRole('heading', { name: 'Сгенерированные изображения' })).toHaveCount(0);
});

test('shows authenticated generated images newest first', async ({ page }) => {
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
							createdAt: oldestCreatedAt
						},
						{
							id: 'newest',
							url: 'https://cdn.example.test/newest.webp',
							createdAt: newestCreatedAt
						}
					]
				: [
						{
							id: 'middle',
							url: 'https://cdn.example.test/middle.webp',
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
		expect(url.searchParams.get('filename')).toBe('generated-image-newest.webp');
		await route.fulfill({
			status: 200,
			headers: {
				'content-type': 'image/webp',
				'content-disposition': 'attachment; filename="generated-image-newest.webp"'
			},
			body: 'image-bytes'
		});
	});
	await page.goto('/');

	await expect(page.getByRole('heading', { name: 'Сгенерированные изображения' })).toBeVisible();
	const images = page.getByRole('img', { name: /Сгенерированное изображение/ });
	await expect(images).toHaveCount(3);
	await expect(images.nth(0)).toHaveAttribute('src', 'https://cdn.example.test/newest.webp');
	await expect(images.nth(1)).toHaveAttribute('src', 'https://cdn.example.test/middle.webp');
	await expect(images.nth(2)).toHaveAttribute('src', 'https://cdn.example.test/oldest.webp');
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

	const downloadButton = page.getByRole('button', {
		name: 'Скачать сгенерированное изображение 1'
	});
	const downloadPromise = page.waitForEvent('download');
	await downloadButton.click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toBe('generated-image-newest.webp');

	await page.getByRole('button', { name: 'Удалить сгенерированное изображение 2' }).click();

	const dialog = page.getByRole('dialog', { name: 'Удалить изображение?' });
	await expect(dialog).toBeVisible();
	await expect(dialog.getByText('Это действие необратимо.')).toBeVisible();
	await expect(
		page.getByRole('button', { name: 'Удалить сгенерированное изображение 1' })
	).toHaveCount(0);
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
	await page.goto('/');

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
	await page.goto('/');

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
	await page.goto('/');
	const prompt = 'Scandinavian style, warm natural light';

	await page.getByRole('textbox', { name: 'Промпт чата' }).fill(prompt);

	await page.getByRole('tab', { name: 'Граф' }).click();
	await expect(page.getByRole('tab', { name: 'Граф' })).toHaveAttribute('aria-selected', 'true');

	await expect(promptPreview(page)).toHaveValue(prompt);
});

test('key-value edits survive a round trip through the chat tab', async ({ page }) => {
	await page.goto('/');

	await page.getByRole('tab', { name: 'Ключ-значение' }).click();
	await page.getByRole('button', { name: 'Добавить фрагмент' }).click();
	await page.getByLabel('Текст 1').fill('warm natural light');

	await page.getByRole('tab', { name: 'Чат' }).click();
	await page.getByRole('tab', { name: 'Ключ-значение' }).click();

	await expect(page.getByLabel('Текст 1')).toHaveValue('warm natural light');
});

test('navigates tabs with the keyboard', async ({ page }) => {
	await page.goto('/');
	const chat = page.getByRole('tab', { name: 'Чат' });
	const keyValue = page.getByRole('tab', { name: 'Ключ-значение' });

	await chat.focus();
	await page.keyboard.press('ArrowRight');
	await expect(keyValue).toBeFocused();
	await expect(keyValue).toHaveAttribute('aria-selected', 'true');
	await page.getByRole('button', { name: 'Добавить фрагмент' }).click();
	await expect(page.getByLabel('Метка 1')).toBeVisible();

	await keyValue.focus();
	await page.keyboard.press('Home');
	await expect(chat).toBeFocused();
	await expect(chat).toHaveAttribute('aria-selected', 'true');
});

test('the Scene Type toggle switches to exterior and relabels the photo step', async ({ page }) => {
	await page.goto('/');

	const interiorTab = page.getByRole('tab', { name: 'Интерьер' });
	const exteriorTab = page.getByRole('tab', { name: 'Экстерьер' });

	await expect(interiorTab).toHaveAttribute('aria-selected', 'true');
	await expect(page.getByRole('heading', { name: 'Фото комнаты' })).toBeVisible();

	await exteriorTab.click();
	await expect(exteriorTab).toHaveAttribute('aria-selected', 'true');
	await expect(interiorTab).toHaveAttribute('aria-selected', 'false');
	await expect(page.getByRole('heading', { name: 'Фото здания' })).toBeVisible();
});

test('navigates the Scene Type toggle with the keyboard', async ({ page }) => {
	await page.goto('/');
	const interiorTab = page.getByRole('tab', { name: 'Интерьер' });
	const exteriorTab = page.getByRole('tab', { name: 'Экстерьер' });

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
				dimensions: [800, 600]
			})
		});
	});
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

	await page.goto('/');
	await page.getByRole('tab', { name: 'Экстерьер' }).click();
	await page
		.locator('#mode-panel-render input[type="file"]')
		.setInputFiles({ name: 'house.png', mimeType: 'image/png', buffer: Buffer.from('fake-image') });
	await page.getByRole('button', { name: 'Сгенерировать' }).click();

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
