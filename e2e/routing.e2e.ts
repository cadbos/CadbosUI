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

test('root redirects to /render/interior with the current scene/view/format always explicit', async ({
	page
}) => {
	await page.goto('/');
	await expect(page).toHaveURL(/\/render\/interior\?view=chat&format=webp$/);
	await expect(page.getByRole('tab', { name: 'Интерьер' })).toHaveAttribute(
		'aria-selected',
		'true'
	);
	await expect(page.getByRole('tab', { name: 'Чат' })).toHaveAttribute('aria-selected', 'true');
});

test('direct navigation to /render/exterior opens the exterior scene', async ({ page }) => {
	await page.goto('/render/exterior');
	await expect(page.getByRole('tab', { name: 'Экстерьер' })).toHaveAttribute(
		'aria-selected',
		'true'
	);
});

test('direct navigation to /render/interior?view=graph opens the graph tab', async ({ page }) => {
	await page.goto('/render/interior?view=graph');
	await expect(page.getByRole('tab', { name: 'Граф' })).toHaveAttribute('aria-selected', 'true');
});

test('direct navigation to /edit opens the edit tab with the freeform tool explicit', async ({
	page
}) => {
	await page.goto('/edit');
	await expect(page).toHaveURL(/\/edit\?tool=freeform$/);
	await expect(page.getByRole('tab', { name: 'Редактирование' })).toHaveAttribute(
		'aria-selected',
		'true'
	);
});

test('direct navigation to /edit?tool=add-object opens the add-object tool tab', async ({
	page
}) => {
	await page.goto('/edit?tool=add-object');
	await expect(page.getByRole('tab', { name: /Добавить объект/ })).toHaveAttribute(
		'aria-selected',
		'true'
	);
});

test('direct navigation to /style-transfer redirects to the interior scene with defaults explicit', async ({
	page
}) => {
	await page.goto('/style-transfer');
	await expect(page).toHaveURL(
		/\/style-transfer\/interior\?reference=photorealistic&format=webp&source=current-result&strength=0\.7$/
	);
	await expect(page.getByRole('tab', { name: 'Перенос стиля' })).toHaveAttribute(
		'aria-selected',
		'true'
	);
});

test('clicking the scene toggle changes the path, keeping the current view/format', async ({
	page
}) => {
	await page.goto('/render/interior?view=key-value');
	await page.getByRole('tab', { name: 'Экстерьер' }).click();
	await expect(page).toHaveURL(/\/render\/exterior\?view=key-value&format=webp$/);
});

test('switching mode tabs opens each mode default, carrying scene but not sub-tabs across', async ({
	page
}) => {
	await page.goto('/render/exterior');

	await page.getByRole('tab', { name: 'Редактирование' }).click();
	// Edit has no scene concept, so it isn't in the path.
	await expect(page).toHaveURL(/\/edit\?tool=freeform$/);

	await page.getByRole('tab', { name: 'Перенос стиля' }).click();
	// Style transfer's scene toggle is bound to the same request.sceneType, so
	// exterior carries over from before the excursion into edit.
	await expect(page).toHaveURL(
		/\/style-transfer\/exterior\?reference=photorealistic&format=webp&source=current-result&strength=0\.7$/
	);

	await page.getByRole('tab', { name: 'Рендер' }).click();
	await expect(page).toHaveURL(/\/render\/exterior\?view=chat&format=webp$/);
});

test('switching view tabs updates only the view query param', async ({ page }) => {
	await page.goto('/render/interior?view=chat');

	await page.getByRole('tab', { name: 'Граф' }).click();
	await expect(page).toHaveURL(/\/render\/interior\?view=graph&format=webp$/);

	await page.getByRole('tab', { name: 'Ключ-значение' }).click();
	await expect(page).toHaveURL(/\/render\/interior\?view=key-value&format=webp$/);
});

test('switching edit tool tabs updates only the tool query param', async ({ page }) => {
	await page.goto('/edit?tool=freeform');

	await page.getByRole('tab', { name: /Удалить объект/ }).click();
	await expect(page).toHaveURL(/\/edit\?tool=remove-object$/);

	await page.getByRole('tab', { name: /Атмосфера/ }).click();
	await expect(page).toHaveURL(/\/edit\?tool=atmosphere$/);
});

test('switching style transfer reference tabs updates only the reference query param', async ({
	page
}) => {
	await page.goto('/style-transfer/interior?reference=photorealistic');

	await page.getByRole('tab', { name: 'Концептуальные' }).click();
	await expect(page).toHaveURL(/\/style-transfer\/interior\?reference=conceptual/);

	await page.getByRole('tab', { name: 'Свои' }).click();
	await expect(page).toHaveURL(/\/style-transfer\/interior\?reference=custom/);
});

test('render-only content (prompt/fragments) never appears on edit or style transfer URLs', async ({
	page
}) => {
	await page.goto('/render/interior?view=key-value');
	await page.getByRole('button', { name: 'Добавить фрагмент' }).click();
	await page.getByLabel('Текст 1').fill('warm natural light');
	await expect(page).toHaveURL(/fragments=/);

	await page.getByRole('tab', { name: 'Редактирование' }).click();
	await expect(page).not.toHaveURL(/fragments=/);

	await page.getByRole('tab', { name: 'Перенос стиля' }).click();
	await expect(page).not.toHaveURL(/fragments=/);
});

test('style transfer settings never appear on render or edit URLs', async ({ page }) => {
	await authenticate(page);
	await page.goto('/style-transfer/interior');

	await page.getByRole('slider', { name: 'Сила переноса' }).fill('0.35');
	await expect(page).toHaveURL(/strength=0\.35/);

	await page.getByRole('tab', { name: 'Рендер' }).click();
	await expect(page).not.toHaveURL(/strength=/);

	await page.getByRole('tab', { name: 'Редактирование' }).click();
	await expect(page).not.toHaveURL(/strength=/);
});

test('scene, format and key-value fragments survive a fresh load of the shared URL', async ({
	page
}) => {
	await page.goto('/render/interior?view=key-value');

	const renderPanel = page.locator('#mode-panel-render');
	await page.getByRole('tab', { name: 'Экстерьер' }).click();
	await renderPanel.getByLabel('Формат').selectOption('jpg');
	await page.getByRole('button', { name: 'Добавить фрагмент' }).click();
	await page.getByLabel('Текст 1').fill('warm natural light');

	await expect(page).toHaveURL(/\/render\/exterior\?/);
	await expect(page).toHaveURL(/format=jpg/);
	await expect(page).toHaveURL(/fragments=/);

	const sharedUrl = page.url();
	await page.goto(sharedUrl);

	await expect(page.getByRole('tab', { name: 'Экстерьер' })).toHaveAttribute(
		'aria-selected',
		'true'
	);
	await expect(renderPanel.getByLabel('Формат')).toHaveValue('jpg');
	await expect(page.getByLabel('Текст 1')).toHaveValue('warm natural light');
});

test('a style preset round-trips as a preset id, not a raw image URL', async ({ page }) => {
	await authenticate(page);
	await page.goto('/style-transfer/interior');

	const panel = page.locator('#mode-panel-styleTransfer');
	const preset = panel.getByRole('radio', { name: 'Спа-ванная из бетона' });
	await preset.click();
	await expect(preset).toHaveAttribute('aria-checked', 'true');

	await expect(page).toHaveURL(/preset=interior-concrete-spa-bathroom/);
	await expect(page).not.toHaveURL(/styleImage=/);

	const sharedUrl = page.url();
	await page.goto(sharedUrl);

	await expect(panel.getByRole('radio', { name: 'Спа-ванная из бетона' })).toHaveAttribute(
		'aria-checked',
		'true'
	);
});
