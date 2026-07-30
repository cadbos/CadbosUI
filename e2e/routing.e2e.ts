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
				user: { pubkey: '0'.repeat(64), firstName: 'Ada', lastName: 'Lovelace' },
				credit: { balance: 20, updatedAt: 0, history: [] }
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

async function unlockCreation(page: Page): Promise<void> {
	await page.route('**/api/uploads', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				url: 'https://cdn.example.test/routing-source.webp',
				mime: 'image/webp',
				size: 1024,
				dimensions: [800, 600]
			})
		});
	});
	await expect(
		page
			.getByRole('button', { name: 'Войти' })
			.or(page.getByRole('heading', { name: 'Сгенерированные изображения' }))
	).toBeVisible();
	const input = page.locator('#mode-panel-render input[type="file"]');
	await expect(async () => {
		await input.setInputFiles([]);
		await input.setInputFiles({
			name: 'room.png',
			mimeType: 'image/png',
			buffer: Buffer.from('routing-source')
		});
		await expect(
			page.locator('#mode-panel-render').getByRole('button', { name: 'Изменить фото' })
		).toBeVisible({ timeout: 2_000 });
	}).toPass({ timeout: 10_000 });
}

async function prepareEditableProject(page: Page): Promise<void> {
	await authenticate(page);
	await page.route('**/api/render', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				outputUrl: 'https://cdn.example.test/routing-base.webp',
				cost: 1,
				balance: 19
			})
		});
	});
	await page.goto('/create/interior?view=chat&format=webp');
	await expect(page.getByRole('heading', { name: 'Сгенерированные изображения' })).toBeVisible();
	await unlockCreation(page);
	await page.getByRole('button', { name: 'Сгенерировать' }).click();
	await expect(page.getByRole('img', { name: 'Результат создания' })).toBeVisible();
}

test('root redirects to the explicit Project URL', async ({ page }) => {
	await page.goto('/');
	await expect(page).toHaveURL(/\/create\/interior\?view=chat&format=webp$/);
	await expect(page.getByRole('tab', { name: 'Проект', exact: true })).toHaveAttribute(
		'aria-selected',
		'true'
	);
	await expect(page.getByRole('heading', { name: 'Сначала добавьте исходное фото' })).toBeVisible();
});

test('direct navigation carries the scene and gated input view in the URL', async ({ page }) => {
	await page.goto('/create/exterior?view=graph');
	await expect(page).toHaveURL(/\/create\/exterior\?view=graph&format=webp$/);
	await expect(page.getByRole('tab', { name: 'Экстерьер' })).toHaveAttribute(
		'aria-selected',
		'true'
	);
	await expect(page.getByRole('tab', { name: 'Граф' })).toHaveCount(0);

	await unlockCreation(page);
	await expect(page.getByRole('tab', { name: 'Граф' })).toHaveAttribute('aria-selected', 'true');
});

test('direct /edit links preserve the requested tool through upload canonicalization and render', async ({
	page
}) => {
	await authenticate(page);
	await page.route('**/api/render', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				outputUrl: 'https://cdn.example.test/routing-base.webp',
				cost: 1,
				balance: 19
			})
		});
	});
	await page.goto('/edit?tool=add-object');
	await expect(page).toHaveURL(/\/edit\?tool=add-object$/);
	await expect(page.getByRole('tab', { name: 'Проект', exact: true })).toHaveAttribute(
		'aria-selected',
		'true'
	);
	await expect(page.getByRole('tab', { name: /Добавить объект/ })).toHaveCount(0);
	await expect(page.getByRole('heading', { name: 'Сначала добавьте исходное фото' })).toBeVisible();

	await unlockCreation(page);
	await expect(page).toHaveURL(/\/create\/interior\?.*tool=add-object/);
	await page.getByRole('button', { name: 'Сгенерировать' }).click();
	await expect(page.getByRole('tab', { name: /Добавить объект/ })).toHaveAttribute(
		'aria-selected',
		'true'
	);
});

test('direct replacement links normalize defaults while remaining gated', async ({ page }) => {
	await page.goto('/edit?tool=object-replacement');
	await expect(page).toHaveURL(/\/edit\?tool=object-replacement&source=current-result$/);
	await expect(page.locator('#edit-tool-panel-object-replacement')).toHaveCount(0);

	await page.goto('/edit?tool=texture-replacement');
	await expect(page).toHaveURL(/\/edit\?tool=texture-replacement&source=current-result$/);
	await expect(page.locator('#edit-tool-panel-texture-replacement')).toHaveCount(0);
});

test('the removed standalone replacement routes return 404', async ({ page }) => {
	expect((await page.goto('/object-replacement'))?.status()).toBe(404);
	expect((await page.goto('/texture-replacement'))?.status()).toBe(404);
});

test('direct style-transfer navigation normalizes defaults', async ({ page }) => {
	await page.goto('/style-transfer');
	await expect(page).toHaveURL(
		/\/style-transfer\/interior\?reference=photorealistic&format=webp&source=current-result&strength=0\.7$/
	);
	await expect(page.getByRole('tab', { name: 'Перенос стиля' })).toHaveAttribute(
		'aria-selected',
		'true'
	);
});

test('scene and prompt-view navigation update only their Project URL fields', async ({ page }) => {
	await page.goto('/create/interior?view=chat&format=webp');
	await unlockCreation(page);

	await page.getByRole('tab', { name: 'Экстерьер' }).click();
	await expect(page).toHaveURL(/\/create\/exterior\?view=chat&format=webp$/);
	await page.getByRole('tab', { name: 'Граф' }).click();
	await expect(page).toHaveURL(/\/create\/exterior\?view=graph&format=webp$/);
	await page.getByRole('tab', { name: 'Ключ-значение' }).click();
	await expect(page).toHaveURL(/\/create\/exterior\?view=key-value&format=webp$/);
});

test('editing tool navigation stays inside the unified Project route', async ({ page }) => {
	await prepareEditableProject(page);

	await page.getByRole('tab', { name: /Удалить объект/ }).click();
	await expect(page).toHaveURL(/\/edit\?tool=remove-object$/);
	await page.getByRole('tab', { name: /Атмосфера/ }).click();
	await expect(page).toHaveURL(/\/edit\?tool=atmosphere$/);
	await page.getByRole('tab', { name: /Замена объекта.*Альфа/ }).click();
	await expect(page).toHaveURL(/\/edit\?tool=object-replacement&source=current-result$/);
	await page.getByRole('tab', { name: /Замена текстуры.*Альфа/ }).click();
	await expect(page).toHaveURL(/\/edit\?tool=texture-replacement&source=current-result$/);
	await expect(page.getByRole('tab', { name: 'Проект', exact: true })).toHaveAttribute(
		'aria-selected',
		'true'
	);
});

test('browser Back steps between Project and Style transfer', async ({ page }) => {
	await page.goto('/create/exterior?view=chat&format=webp');
	await page.getByRole('tab', { name: 'Перенос стиля' }).click();
	await expect(page).toHaveURL(/\/style-transfer\/exterior\?/);
	await page.goBack();
	await expect(page).toHaveURL(/\/create\/exterior\?view=chat&format=webp$/);
	await expect(page.getByRole('tab', { name: 'Проект', exact: true })).toHaveAttribute(
		'aria-selected',
		'true'
	);
});

test('style transfer reference and prompt settings round-trip', async ({ page }) => {
	await page.goto('/style-transfer/interior?reference=photorealistic');
	await page.getByRole('tab', { name: 'Концептуальные' }).click();
	await expect(page).toHaveURL(/reference=conceptual/);
	await page.getByRole('tab', { name: 'Свои' }).click();
	await expect(page).toHaveURL(/reference=custom/);
	await page.getByLabel('Уточнение стиля').fill('use soft plaster texture');
	await expect
		.poll(() => new URL(page.url()).searchParams.get('prompt'))
		.toBe('use soft plaster texture');

	const sharedUrl = page.url();
	await page.goto(sharedUrl);
	await expect(page.getByLabel('Уточнение стиля')).toHaveValue('use soft plaster texture');
});

test('untrusted image URL parameters never populate upload state', async ({ page }) => {
	await page.goto('/create/interior?image=https://evil.example.com/x.jpg');
	await expect(page.getByRole('button', { name: 'Выбрать файл' })).toBeVisible();
	await expect(page.locator('#mode-panel-render .upload .preview')).toHaveCount(0);

	await page.goto(
		'/style-transfer/interior?reference=custom&styleImage=https://evil.example.com/x.jpg'
	);
	await expect(page.locator('#mode-panel-styleTransfer .upload .preview')).toHaveCount(0);
});

test('direct navigation to /usage is not rewritten by Project URL sync', async ({ page }) => {
	await page.goto('/usage');
	await page.waitForTimeout(500);
	await expect(page).toHaveURL(/\/usage$/);
	await expect(page.getByRole('tab', { name: 'Проект', exact: true })).toHaveCount(0);
});
