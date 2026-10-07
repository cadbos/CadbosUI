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

import { ru } from '$lib/i18n/locales/ru';
import { expect, test } from './fixtures';

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

test('root opens the workspace with no mode selected', async ({ page }) => {
	await page.goto('/');
	await expect(page).toHaveURL(/\/$/);
	for (const name of ['Создание', 'Редактирование', 'Миграция стиля']) {
		await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'false');
	}
	await expect(page.getByText('Выберите, с чего начать.')).toBeVisible();
	await expect(page.locator('.mode-clouds')).toBeVisible();
	await page.getByRole('tab', { name: 'Создание' }).click();
	await expect(page).toHaveURL(/\/create\/interior\?view=chat&format=webp$/);
	await expect(page.getByRole('tab', { name: 'Создание' })).toHaveAttribute(
		'aria-selected',
		'true'
	);
	await expect(page.getByRole('tab', { name: 'Интерьер' })).toHaveAttribute(
		'aria-selected',
		'true'
	);
});

test('direct navigation to /create/exterior opens the exterior scene', async ({ page }) => {
	await page.goto('/create/exterior');
	await expect(page.getByRole('tab', { name: 'Экстерьер' })).toHaveAttribute(
		'aria-selected',
		'true'
	);
});

test('direct navigation to /create/interior?view=graph opens the graph tab', async ({ page }) => {
	await page.goto('/create/interior?view=graph');
	await expect(page.getByRole('tab', { name: 'Граф' })).toHaveAttribute('aria-selected', 'true');
});

test('direct navigation to /edit opens the edit tab with the add-object tool explicit', async ({
	page
}) => {
	await page.goto('/edit');
	await expect(page).toHaveURL(/\/edit\?tool=add-object$/);
	await expect(page.getByRole('tab', { name: 'Редактирование' })).toHaveAttribute(
		'aria-selected',
		'true'
	);
});

test('direct navigation to /edit?tool=add-object opens the add-object tool tab', async ({
	page
}) => {
	await page.goto('/edit?tool=add-object');
	await expect(page.getByRole('tab', { name: /Добавление объекта/ })).toHaveAttribute(
		'aria-selected',
		'true'
	);
});

test('direct navigation to /style-transfer redirects to the interior scene with defaults explicit', async ({
	page
}) => {
	await page.goto('/style-transfer');
	await expect(page).toHaveURL(
		/\/style-transfer\/interior\?reference=photorealistic&format=webp&strength=0\.7$/
	);
	await expect(page.getByRole('tab', { name: 'Миграция стиля' })).toHaveAttribute(
		'aria-selected',
		'true'
	);
});

test('direct navigation opens object replacement inside edit with explicit defaults', async ({
	page
}) => {
	await page.goto('/edit?tool=object-replacement');
	await expect(page).toHaveURL(/\/edit\?tool=object-replacement$/);
	await expect(page.getByRole('tab', { name: 'Редактирование' })).toHaveAttribute(
		'aria-selected',
		'true'
	);
	const replacementTab = page.getByRole('tab', { name: 'Замена объекта' });
	await expect(replacementTab).toHaveAttribute('aria-selected', 'true');
	await expect(replacementTab.locator('svg')).toHaveCount(1);

	const panel = page.locator('#edit-tool-panel-object-replacement');
	await expect(panel.getByLabel(/Точно опишите существующий объект/)).toBeVisible();
});

test('the removed standalone object replacement route returns 404', async ({ page }) => {
	const response = await page.goto('/object-replacement');
	expect(response?.status()).toBe(404);
});

test('direct navigation opens texture replacement inside edit with explicit defaults', async ({
	page
}) => {
	await page.goto('/edit?tool=texture-replacement');
	await expect(page).toHaveURL(/\/edit\?tool=texture-replacement$/);
	await expect(page.getByRole('tab', { name: 'Редактирование' })).toHaveAttribute(
		'aria-selected',
		'true'
	);
	const replacementTab = page.getByRole('tab', { name: 'Замена текстуры' });
	await expect(replacementTab).toHaveAttribute('aria-selected', 'true');
	await expect(replacementTab.locator('svg')).toHaveCount(1);

	const panel = page.locator('#edit-tool-panel-texture-replacement');
	await expect(panel.getByRole('region', { name: /Референс новой текстуры/ })).toBeVisible();
	// Mask-based replacement is the only mode (the free-text surface field is
	// retired) — the panel shows the canvas hint instead, even before a source
	// photo exists.
	await expect(
		panel.getByText('Выделите область для замены прямо на изображении выше.')
	).toBeVisible();
});

test('the removed standalone texture replacement route returns 404', async ({ page }) => {
	const response = await page.goto('/texture-replacement');
	expect(response?.status()).toBe(404);
});

test('clicking the scene toggle changes the path, keeping the current view/format', async ({
	page
}) => {
	await page.goto('/create/interior?view=key-value');
	await page.getByRole('tab', { name: 'Экстерьер' }).click();
	await expect(page).toHaveURL(/\/create\/exterior\?view=key-value&format=webp$/);
});

test('switching mode tabs opens each mode default, carrying scene but not sub-tabs across', async ({
	page
}) => {
	await page.goto('/create/exterior');

	await page.getByRole('tab', { name: 'Редактирование' }).click();
	// Edit has no scene concept, so it isn't in the path.
	await expect(page).toHaveURL(/\/edit\?tool=add-object$/);

	await page.getByRole('tab', { name: 'Миграция стиля' }).click();
	// Style transfer's scene toggle is bound to the same request.sceneType, so
	// exterior carries over from before the excursion into edit.
	await expect(page).toHaveURL(
		/\/style-transfer\/exterior\?reference=photorealistic&format=webp&strength=0\.7$/
	);

	await page.getByRole('tab', { name: 'Редактирование' }).click();
	await page.getByRole('tab', { name: /Замена объекта/ }).click();
	await expect(page).toHaveURL(/\/edit\?tool=object-replacement$/);

	await page.getByRole('tab', { name: 'Создание' }).click();
	await expect(page).toHaveURL(/\/create\/exterior\?view=chat&format=webp$/);
});

test('mode tabs stay in the tools header without toggling the panel', async ({ page }) => {
	await page.goto('/create/interior');

	const toolsHeader = page.getByRole('group', { name: ru['toolsPanel.title'] });
	const toolsPanel = toolsHeader.locator('..');
	const modeTabs = toolsHeader.getByRole('tablist', { name: ru['mode.switcher.label'] });
	const modeLabels = [ru['mode.render'], ru['mode.edit'], ru['mode.styleTransfer']];

	await expect(modeTabs).toBeVisible();
	for (const label of modeLabels) {
		const tab = modeTabs.getByRole('tab', { name: label });
		await expect(tab.locator('svg')).toHaveCount(1);
		await expect(tab.locator('.mode-label')).toBeHidden();
	}

	const titleBox = await toolsHeader.locator('.panel-title').boundingBox();
	const tabsBox = await modeTabs.boundingBox();
	expect(titleBox).not.toBeNull();
	expect(tabsBox).not.toBeNull();
	expect(titleBox!.x + titleBox!.width).toBeLessThanOrEqual(tabsBox!.x + 1);

	const resizeHandle = toolsPanel.getByRole('slider', { name: ru['toolsPanel.resizeHandle'] });
	await resizeHandle.press('End');
	for (const label of modeLabels) {
		await expect(modeTabs.getByRole('tab', { name: label }).locator('.mode-label')).toBeVisible();
	}
	await resizeHandle.press('Home');

	const compactTitleBox = await toolsHeader.locator('.panel-title').boundingBox();
	const compactTabsBox = await modeTabs.boundingBox();
	const moveIconBox = await toolsHeader.locator('.drag-icon').boundingBox();
	expect(compactTitleBox).not.toBeNull();
	expect(compactTabsBox).not.toBeNull();
	expect(moveIconBox).not.toBeNull();
	expect(compactTitleBox!.x + compactTitleBox!.width).toBeLessThanOrEqual(compactTabsBox!.x + 1);
	expect(compactTabsBox!.x + compactTabsBox!.width).toBeLessThanOrEqual(moveIconBox!.x + 1);

	await modeTabs.getByRole('tab', { name: ru['mode.render'] }).focus();
	await page.keyboard.press('ArrowRight');
	await expect(page).toHaveURL(/\/edit\?tool=add-object$/);
	await expect(modeTabs.getByRole('tab', { name: ru['mode.edit'] })).toBeFocused();
	await expect(page.getByRole('button', { name: ru['toolsPanel.collapse'] })).toBeVisible();
	await expect(toolsPanel.locator('.panel-body')).toBeVisible();

	await page.getByRole('button', { name: ru['toolsPanel.collapse'] }).click();
	await expect(toolsPanel.locator('.panel-body')).toBeHidden();

	await modeTabs.getByRole('tab', { name: ru['mode.styleTransfer'] }).click();
	await expect(page).toHaveURL(
		/\/style-transfer\/interior\?reference=photorealistic&format=webp&strength=0\.7$/
	);
	await expect(page.getByRole('button', { name: ru['toolsPanel.expand'] })).toBeVisible();
	await expect(toolsPanel.locator('.panel-body')).toBeHidden();

	await toolsHeader.locator('.panel-title').click();
	await expect(toolsPanel.locator('.panel-body')).toBeHidden();

	await page.getByRole('button', { name: ru['toolsPanel.expand'] }).click();
	await expect(toolsPanel.locator('.panel-body')).toBeVisible();
});

test('tools panel size button cycles three presets and the resize handle reaches the screen edges', async ({
	page
}) => {
	await page.goto('/create/interior');

	const viewport = page.viewportSize();
	expect(viewport).not.toBeNull();
	const toolsHeader = page.getByRole('group', { name: ru['toolsPanel.title'] });
	const toolsPanel = toolsHeader.locator('..');
	const sizeButton = toolsHeader.getByRole('button', { name: ru['toolsPanel.sizePreset'] });
	const moveIcon = toolsHeader.locator('.drag-icon');

	const sizeBox = await sizeButton.boundingBox();
	const moveBox = await moveIcon.boundingBox();
	expect(sizeBox).not.toBeNull();
	expect(moveBox).not.toBeNull();
	expect(sizeBox!.x + sizeBox!.width).toBeLessThanOrEqual(moveBox!.x + 1);

	const widths: number[] = [];
	for (let step = 0; step < 3; step += 1) {
		await sizeButton.click();
		const box = await toolsPanel.boundingBox();
		expect(box).not.toBeNull();
		widths.push(box!.width);
	}
	expect(widths[0]).toBeGreaterThan(360);
	expect(widths[1]).toBeGreaterThan(widths[0]);
	expect(widths[2]).toBeGreaterThan(widths[1]);
	expect(widths[2]).toBeLessThan(viewport!.width);

	await sizeButton.click();
	const wrapped = await toolsPanel.boundingBox();
	expect(wrapped).not.toBeNull();
	expect(wrapped!.width).toBeCloseTo(widths[0], 0);
	await expect(toolsPanel.locator('.panel-body')).toBeVisible();

	const resizeHandle = toolsPanel.getByRole('slider', { name: ru['toolsPanel.resizeHandle'] });
	await resizeHandle.press('End');
	const full = await toolsPanel.boundingBox();
	expect(full).not.toBeNull();
	expect(full!.x).toBeLessThanOrEqual(1);
	expect(full!.x + full!.width).toBeGreaterThanOrEqual(viewport!.width - 1);

	await resizeHandle.press('Home');
	const compact = await toolsPanel.boundingBox();
	expect(compact).not.toBeNull();
	expect(compact!.width).toBeCloseTo(280, 0);
});

test('object replacement scene-object text round-trips without image URLs or a legacy source mode', async ({
	page
}) => {
	await page.goto(
		'/edit?tool=object-replacement&source=room-photo&object=gray%20sofa&image=https://evil.example.com/scene.jpg&referenceImage=https://evil.example.com/chair.jpg'
	);

	await expect(page.getByLabel(/Точно опишите существующий объект/)).toHaveValue('gray sofa');
	await expect(page).not.toHaveURL(/source=/);
	await expect(page).toHaveURL(/object=gray(?:%20|\+)sofa/);
	await expect(page).not.toHaveURL(/image=/);
	await expect(page).not.toHaveURL(/referenceImage=/);

	await page.getByRole('tab', { name: 'Миграция стиля' }).click();
	await expect(page).not.toHaveURL(/source=/);
	await page.getByRole('tab', { name: 'Редактирование' }).click();
	await page.getByRole('tab', { name: /Замена объекта/ }).click();
	await expect(page).not.toHaveURL(/source=/);

	const sharedUrl = page.url();
	await page.goto(sharedUrl);
	await expect(page.getByLabel(/Точно опишите существующий объект/)).toHaveValue('gray sofa');
});

test('browser Back steps through mode tabs instead of leaving the app', async ({ page }) => {
	await page.goto('/create/exterior');

	await page.getByRole('tab', { name: 'Редактирование' }).click();
	await expect(page).toHaveURL(/\/edit\?tool=add-object$/);

	await page.getByRole('tab', { name: 'Миграция стиля' }).click();
	await expect(page).toHaveURL(/\/style-transfer\/exterior\?/);

	await page.goBack();
	await expect(page).toHaveURL(/\/edit\?tool=add-object$/);
	await expect(page.getByRole('tab', { name: 'Редактирование' })).toHaveAttribute(
		'aria-selected',
		'true'
	);

	await page.goBack();
	await expect(page).toHaveURL(/\/create\/exterior\?view=chat&format=webp$/);
	await expect(page.getByRole('tab', { name: 'Создание' })).toHaveAttribute(
		'aria-selected',
		'true'
	);
});

test('switching view tabs updates only the view query param', async ({ page }) => {
	await page.goto('/create/interior?view=chat');

	await page.getByRole('tab', { name: 'Граф' }).click();
	await expect(page).toHaveURL(/\/create\/interior\?view=graph&format=webp$/);

	await page.getByRole('tab', { name: 'Ключ-значение' }).click();
	await expect(page).toHaveURL(/\/create\/interior\?view=key-value&format=webp$/);
});

test('switching edit tool tabs updates only the tool query param', async ({ page }) => {
	await page.goto('/edit?tool=freeform');

	await page.getByRole('tab', { name: /Удаление объекта/ }).click();
	await expect(page).toHaveURL(/\/edit\?tool=remove-object$/);

	await page.getByRole('tab', { name: 'Управление освещением' }).click();
	await expect(page).toHaveURL(/\/edit\?tool=light-settings$/);

	await page.getByRole('tab', { name: 'Замена объекта' }).click();
	await expect(page).toHaveURL(/\/edit\?tool=object-replacement$/);

	await page.getByRole('tab', { name: 'Замена текстуры' }).click();
	await expect(page).toHaveURL(/\/edit\?tool=texture-replacement$/);

	await page.getByRole('tab', { name: 'Замена цвета' }).click();
	await expect(page).toHaveURL(/\/edit\?tool=repaint&color=f4f1ea$/);
});

test('texture replacement surface text round-trips without image URLs or a legacy source mode', async ({
	page
}) => {
	await page.goto(
		'/edit?tool=texture-replacement&source=room-photo&surface=sofa%20upholstery&image=https://evil.example.com/scene.jpg&referenceImage=https://evil.example.com/fabric.jpg'
	);

	// The free-text surface field is retired from the UI (mask-based
	// replacement is the only mode), so a legacy `surface=` link no longer
	// populates a visible field — it just has to round-trip harmlessly
	// through the URL below without ever restoring the image URLs.
	await expect(page).not.toHaveURL(/source=/);
	await expect(page).toHaveURL(/surface=sofa(?:%20|\+)upholstery/);
	await expect(page).not.toHaveURL(/image=/);
	await expect(page).not.toHaveURL(/referenceImage=/);

	await page.getByRole('tab', { name: 'Миграция стиля' }).click();
	await expect(page).not.toHaveURL(/source=/);
	await page.getByRole('tab', { name: 'Редактирование' }).click();
	await page.getByRole('tab', { name: /Замена текстуры/ }).click();
	await expect(page).not.toHaveURL(/source=/);

	const sharedUrl = page.url();
	await page.goto(sharedUrl);
	await expect(page).toHaveURL(/surface=sofa(?:%20|\+)upholstery/);
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
	await page.goto('/create/interior?view=key-value');
	await page.getByRole('button', { name: 'Добавить фрагмент' }).click();
	await page.getByLabel('Текст 1').fill('warm natural light');
	await expect(page).toHaveURL(/fragments=/);

	await page.getByRole('tab', { name: 'Редактирование' }).click();
	await expect(page).not.toHaveURL(/fragments=/);

	await page.getByRole('tab', { name: 'Миграция стиля' }).click();
	await expect(page).not.toHaveURL(/fragments=/);
});

test('edit and style transfer prompts round-trip through their own query params', async ({
	page
}) => {
	await page.goto('/edit?tool=freeform&prompt=brighten%20the%20sofa');
	await expect(page.getByLabel('Инструкция для правки')).toHaveValue('brighten the sofa');

	await page.getByLabel('Инструкция для правки').fill('replace the chair');
	await expect.poll(() => new URL(page.url()).searchParams.get('prompt')).toBe('replace the chair');

	await page.goto(
		'/style-transfer/interior?reference=custom&format=webp&strength=0.7&prompt=keep%20warm%20materials'
	);
	await expect(page.getByLabel('Уточнение стиля')).toHaveValue('keep warm materials');

	await page.getByLabel('Уточнение стиля').fill('use soft plaster texture');
	await expect
		.poll(() => new URL(page.url()).searchParams.get('prompt'))
		.toBe('use soft plaster texture');

	await page.getByRole('tab', { name: 'Создание' }).click();
	await expect.poll(() => new URL(page.url()).searchParams.get('prompt')).toBeNull();
});

test('style transfer settings never appear on render or edit URLs', async ({ page }) => {
	await authenticate(page);
	await page.goto('/style-transfer/interior');

	await page.getByRole('slider', { name: 'Сила переноса' }).fill('0.35');
	await expect(page).toHaveURL(/strength=0\.35/);

	await page.getByRole('tab', { name: 'Создание' }).click();
	await expect(page).not.toHaveURL(/strength=/);

	await page.getByRole('tab', { name: 'Редактирование' }).click();
	await expect(page).not.toHaveURL(/strength=/);
});

test('scene, format and key-value fragments survive a fresh load of the shared URL', async ({
	page
}) => {
	await page.goto('/create/interior?view=key-value');

	const renderPanel = page.locator('#mode-panel-render');
	await page.getByRole('tab', { name: 'Экстерьер' }).click();
	await renderPanel.getByLabel('Формат').selectOption('jpg');
	await page.getByRole('button', { name: 'Добавить фрагмент' }).click();
	await page.getByLabel('Текст 1').fill('warm natural light');

	await expect(page).toHaveURL(/\/create\/exterior\?/);
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

test('a crafted image/styleImage query param is ignored, not accepted as an unvalidated URL', async ({
	page
}) => {
	await page.goto('/create/interior?view=chat&format=webp&image=https://evil.example.com/x.jpg');

	// The only trusted way to populate the room photo is the /api/uploads
	// pipeline (see url-state.ts) — a raw `image` param must never pre-fill it.
	await expect(page.getByRole('button', { name: 'Выбрать файл' })).toBeVisible();
	await expect(page.locator('.upload .preview')).toHaveCount(0);

	await page.goto(
		'/style-transfer/interior?reference=custom&format=webp&strength=0.7&styleImage=https://evil.example.com/x.jpg'
	);
	const styleTransferPanel = page.locator('#mode-panel-styleTransfer');
	await expect(styleTransferPanel.locator('.upload .preview')).toHaveCount(0);
});

test('direct navigation to /usage stays on /usage instead of bouncing to the render tab', async ({
	page
}) => {
	await page.goto('/usage');
	await expect(page).toHaveURL(/\/usage$/);

	// Regression guard for the workspace's debounced URL-sync effect: it used to
	// mount unconditionally, default an unrecognized route id to 'render', and
	// rewrite the address bar to /render/* after its 400ms debounce fired.
	await page.waitForTimeout(500);
	await expect(page).toHaveURL(/\/usage$/);
	await expect(page.getByRole('tab', { name: 'Рендер' })).toHaveCount(0);
});

// Regression guard: a route's title must be part of the server-rendered HTML,
// not assigned only after hydration via $effect (which never runs during SSR) —
// otherwise view-source, share previews, and the pre-hydration paint all show
// the generic app title instead of the page's own.
test('the server-rendered HTML already has the route-specific title, before any client JS runs', async ({
	request
}) => {
	const response = await request.get('/expenses');
	const html = await response.text();
	expect(html).toContain(`<title>${ru['expenses.title']}</title>`);
});

// Regression guard: each page's <svelte:head><title> compiles to an effect with
// no cleanup, so leaving a titled page for a route with no title of its own (the
// workspace routes the logo links to) used to leave the tab title stuck forever.
// Every workspace leaf page now asserts the app title on mount for exactly this
// reason (see src/routes/create/[scene=scene]/+page.svelte).
for (const [path, title] of [
	['/expenses', ru['expenses.title']],
	['/resources', ru['resources.title']],
	['/projects', ru['projects.title']]
] as const) {
	test(`clicking the logo restores the app title after leaving ${path}`, async ({ page }) => {
		await page.goto(path);
		await expect(page).toHaveTitle(title);

		await page.locator('.brand').click();
		await expect(page).toHaveURL(/\/$/);
		await expect(page).toHaveTitle(ru['app.title']);
	});
}
