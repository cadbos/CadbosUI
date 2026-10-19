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

import { ru } from '$lib/i18n/locales/ru';
import { expect, test } from './fixtures';
import { media } from './helpers/media';
import {
	E2E_GENERATION_ID,
	E2E_PROJECT_ID,
	E2E_SESSION_ID
} from './helpers/project-session-routes';

async function openScene(page: Page, width = 1600, height = 900): Promise<void> {
	await page.route('**/auth/me', (route) =>
		route.fulfill({
			json: {
				user: { pubkey: 'a'.repeat(64), firstName: 'Ada', lastName: 'Lovelace' }
			}
		})
	);
	await page.route('**/auth/nostr-profile', (route) =>
		route.fulfill({ json: { profile: { relays: [] } } })
	);
	await page.route('**/api/generated-images**', (route) =>
		route.fulfill({
			json: {
				images: [],
				pagination: { offset: 0, size: 100, hasMore: false }
			}
		})
	);
	await page.route('**/api/media/**', (route) =>
		route.fulfill({
			contentType: 'image/svg+xml',
			body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#d9d1c7"/></svg>`
		})
	);
	await page.route(`**/api/projects/${E2E_PROJECT_ID}`, (route) =>
		route.fulfill({
			json: {
				id: E2E_PROJECT_ID,
				title: 'Living room',
				createdAt: 1,
				updatedAt: 1,
				shareActive: false,
				sessions: [
					{
						id: E2E_SESSION_ID,
						title: 'Main thread',
						parentSessionId: null,
						forkedFromGenerationId: null,
						createdAt: 1,
						updatedAt: 1,
						generations: [
							{
								id: E2E_GENERATION_ID,
								image: media('result', '/api/media/test-media/result.svg'),
								source: media('source', '/api/media/test-media/source.svg'),
								kind: 'render',
								createdAt: 1,
								amount: 5,
								balanceAfter: 95
							}
						]
					}
				]
			}
		})
	);
	await page.route(`**/api/generated-images/${E2E_GENERATION_ID}`, (route) =>
		route.fulfill({
			json: {
				id: E2E_GENERATION_ID,
				prompt: '',
				kind: 'render',
				createdAt: 1,
				amount: 5,
				balanceAfter: 95,
				image: media('result', '/api/media/test-media/result.svg'),
				source: media('source', '/api/media/test-media/source.svg'),
				formSnapshot: null,
				session: {
					projectId: E2E_PROJECT_ID,
					projectTitle: 'Living room',
					sessionId: E2E_SESSION_ID,
					sessionTitle: 'Main thread'
				},
				media: [
					media('result', '/api/media/test-media/result.svg'),
					media('source', '/api/media/test-media/source.svg')
				]
			}
		})
	);
	await page.goto(
		`/create/interior?view=chat&format=webp&project=${E2E_PROJECT_ID}&session=${E2E_SESSION_ID}&generation=${E2E_GENERATION_ID}`
	);
	await expect(sceneImage(page)).toHaveJSProperty('naturalWidth', width);
}

function sceneImage(page: Page): Locator {
	return page.getByRole('img', { name: ru['render.generate'], exact: true });
}

async function expectNoPageOverflow(page: Page): Promise<void> {
	const dimensions = await page.evaluate(() => ({
		width: document.documentElement.scrollWidth,
		height: document.documentElement.scrollHeight,
		layout: Array.from(
			document.querySelectorAll(
				'main.page, .workspace-main, .workspace-header, .canvas-layout, .canvas-col, .floating-tools-panel, .panel-bar, .panel-body'
			)
		).map((element) => ({
			cls: element.className,
			rect: element.getBoundingClientRect().toJSON(),
			scrollHeight: element.scrollHeight
		})),
		viewportWidth: window.innerWidth,
		viewportHeight: window.innerHeight
	}));
	expect(dimensions.width).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
	expect(dimensions.height, JSON.stringify(dimensions.layout)).toBeLessThanOrEqual(
		dimensions.viewportHeight + 1
	);
}

for (const [shape, width, height] of [
	['landscape', 1600, 900],
	['portrait', 900, 1600]
] as const) {
	test(`fits the complete ${shape} scene on a low laptop screen`, async ({ page }, testInfo) => {
		await page.setViewportSize({ width: 1280, height: 650 });
		await openScene(page, width, height);
		await expectNoPageOverflow(page);
		const image = sceneImage(page);
		const bounds = await image.boundingBox();
		expect(bounds).not.toBeNull();
		if (!bounds) throw new Error('Scene image has no visible bounds');
		expect(bounds.height).toBeGreaterThan(0);
		expect(bounds.y).toBeGreaterThanOrEqual(0);
		expect(bounds.y + bounds.height).toBeLessThanOrEqual(651);
		const fullscreen = page.getByRole('button', { name: ru['toolbar.fullscreen'], exact: true });
		const actionBounds = await fullscreen.boundingBox();
		expect(actionBounds).not.toBeNull();
		if (!actionBounds) throw new Error('Scene actions have no visible bounds');
		expect(actionBounds.y + actionBounds.height).toBeLessThanOrEqual(bounds.y + 1);
		await expect(image).toHaveCSS('object-fit', 'contain');
		await testInfo.attach(`scene-${shape}`, {
			body: await page.screenshot({ path: testInfo.outputPath('scene.png') }),
			contentType: 'image/png'
		});
	});
}

test('fullscreen keeps scene tools and restores focus and the active scene on exit', async ({
	page
}, testInfo) => {
	await openScene(page);
	const enter = page.getByRole('button', { name: ru['toolbar.fullscreen'], exact: true });
	const imageSource = await sceneImage(page).getAttribute('src');
	await enter.click();
	await expect(page.getByRole('navigation', { name: ru['workspace.tabs.label'] })).toBeHidden();
	await expect(page.getByRole('link', { name: ru['resources.title'], exact: true })).toBeHidden();
	const exit = page.getByRole('button', { name: ru['toolbar.exitFullscreen'], exact: true });
	await expect(exit).toBeVisible();
	await expect(page.getByRole('link', { name: ru['render.download'], exact: true })).toBeVisible();
	await expect(sceneImage(page)).toHaveAttribute('src', imageSource!);
	await expectNoPageOverflow(page);
	await testInfo.attach('scene-fullscreen', {
		body: await page.screenshot({ path: testInfo.outputPath('scene.png') }),
		contentType: 'image/png'
	});
	await page.getByRole('button', { name: ru['toolbar.reset'], exact: true }).click();
	await expect(page.getByRole('dialog')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('dialog')).toBeHidden();
	await expect(exit).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(enter).toBeFocused();
	await expect(sceneImage(page)).toHaveAttribute('src', imageSource!);
	await expect(page.getByRole('link', { name: ru['resources.title'], exact: true })).toBeVisible();
	await enter.click();
	await exit.click();
	await expect(enter).toBeFocused();
});

test('mobile shows financial values through one disclosure without page overflow', async ({
	page
}, testInfo) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await openScene(page, 900, 1600);
	const finances = page.getByLabel(ru['render.finances'], { exact: true });
	await expect(page.locator('details').filter({ has: finances })).toHaveJSProperty('open', false);
	await expectNoPageOverflow(page);
	await testInfo.attach('scene-mobile', {
		body: await page.screenshot({ path: testInfo.outputPath('scene.png') }),
		contentType: 'image/png'
	});
	const financeBounds = await finances.boundingBox();
	const sessionBounds = await page
		.getByRole('navigation', { name: ru['workspace.sessionTabs.label'] })
		.boundingBox();
	if (!financeBounds || !sessionBounds) throw new Error('Session header is missing');
	expect(Math.abs(financeBounds.y - sessionBounds.y)).toBeLessThanOrEqual(5);
	await finances.click();
	await expect(page.locator('details').filter({ has: finances })).toHaveJSProperty('open', true);
	await expect(page.locator('details').getByText(/^Стоимость:/)).toBeVisible();
	await expect(page.locator('details').getByText(/^Баланс:/)).toBeVisible();
	await expectNoPageOverflow(page);
});

test('plain action drag icon moves the panel, stays reachable and matches tools corners', async ({
	page
}) => {
	await page.setViewportSize({ width: 1280, height: 720 });
	await openScene(page);
	const actions = page.getByRole('toolbar', { name: ru['toolbar.move'], exact: true });
	const handle = actions.locator('.drag-handle');
	await expect(page.getByRole('button', { name: ru['toolbar.move'], exact: true })).toHaveCount(0);
	await expect(
		page.getByRole('button', { name: 'Вернуть панель действий на место', exact: true })
	).toHaveCount(0);
	const tools = page.locator('.floating-tools-panel:visible .panel-bar');
	expect(await actions.evaluate((node) => getComputedStyle(node).borderTopLeftRadius)).toBe(
		await tools.evaluate((node) => getComputedStyle(node).borderTopLeftRadius)
	);
	const original = await handle.boundingBox();
	if (!original) throw new Error('Scene actions drag icon is missing');
	await page.mouse.move(original.x + original.width / 2, original.y + original.height / 2);
	await page.mouse.down();
	await page.mouse.move(1100, 600, { steps: 8 });
	await page.mouse.up();
	const moved = await handle.boundingBox();
	if (!moved) throw new Error('Moved scene actions drag icon is missing');
	expect(moved.y).toBeGreaterThan(original.y + 50);
	await page.setViewportSize({ width: 800, height: 500 });
	const edge = await page
		.getByRole('button', { name: ru['toolbar.fullscreen'], exact: true })
		.boundingBox();
	if (!edge) throw new Error('Moved scene actions are missing after resize');
	expect(edge.x + edge.width).toBeLessThanOrEqual(801);
	expect(edge.y + edge.height).toBeLessThanOrEqual(501);
});

test('narrow mobile fullscreen retains both tool panels and a visible scene', async ({
	page
}, testInfo) => {
	await page.setViewportSize({ width: 320, height: 640 });
	await openScene(page, 900, 1600);
	const normalImage = await sceneImage(page).boundingBox();
	if (!normalImage) throw new Error('Mobile scene is missing');
	expect(normalImage.height).toBeGreaterThanOrEqual(80);
	await expectNoPageOverflow(page);
	await page.getByRole('button', { name: ru['toolbar.fullscreen'], exact: true }).click();
	await expect(
		page.getByRole('group', { name: ru['toolsPanel.title'], exact: true })
	).toBeVisible();
	await expect(
		page.getByRole('button', { name: ru['toolbar.exitFullscreen'], exact: true })
	).toBeVisible();
	const bounds = await sceneImage(page).boundingBox();
	if (!bounds) throw new Error('Fullscreen mobile scene is missing');
	expect(bounds.height).toBeGreaterThan(0);
	await expectNoPageOverflow(page);
	await testInfo.attach('scene-mobile-fullscreen', {
		body: await page.screenshot({ path: testInfo.outputPath('scene.png') }),
		contentType: 'image/png'
	});
	await page.keyboard.press('Escape');
	await expect(
		page.getByRole('button', { name: ru['toolbar.fullscreen'], exact: true })
	).toBeFocused();
});

test('fullscreen tool movement preserves the normal tool position and size', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await openScene(page);
	const tools = page.locator('.floating-tools-panel:visible');
	const title = tools.locator('.panel-title');
	const origin = await title.boundingBox();
	if (!origin) throw new Error('Tool panel title is missing');
	await page.mouse.move(origin.x + 20, origin.y + 10);
	await page.mouse.down();
	await page.mouse.move(origin.x - 100, origin.y + 100, { steps: 8 });
	await page.mouse.up();
	const normal = await tools.boundingBox();
	if (!normal) throw new Error('Tool panel is missing');
	await page.getByRole('button', { name: ru['toolbar.fullscreen'], exact: true }).click();
	const fullTitle = await title.boundingBox();
	if (!fullTitle) throw new Error('Fullscreen tool panel title is missing');
	await page.mouse.move(fullTitle.x + 20, fullTitle.y + 10);
	await page.mouse.down();
	await page.mouse.move(fullTitle.x - 80, fullTitle.y + 80, { steps: 8 });
	await page.mouse.up();
	await page.getByRole('button', { name: ru['toolbar.exitFullscreen'], exact: true }).click();
	await expect.poll(async () => (await tools.boundingBox())?.x).toBe(normal.x);
	await expect.poll(async () => (await tools.boundingBox())?.y).toBe(normal.y);
	await expect.poll(async () => (await tools.boundingBox())?.width).toBe(normal.width);
});

test('tool width preference survives viewport clamping and keyboard resize starts from visible width', async ({
	page
}) => {
	await page.setViewportSize({ width: 1400, height: 900 });
	await openScene(page);
	const tools = page.locator('.floating-tools-panel:visible');
	const resize = tools.getByRole('slider', { name: ru['toolsPanel.resizeHandle'], exact: true });
	await resize.press('End');
	await expect(resize).toHaveAttribute('aria-valuenow', '1368');
	const preferredWidth = await resize.getAttribute('aria-valuenow');
	await page.setViewportSize({ width: 1000, height: 900 });
	await expect(resize).toHaveAttribute('aria-valuenow', '968');
	await page.setViewportSize({ width: 1400, height: 900 });
	await expect(resize).toHaveAttribute('aria-valuenow', preferredWidth!);
	await page.setViewportSize({ width: 1000, height: 900 });
	await expect(resize).toHaveAttribute('aria-valuenow', '968');
	await resize.press('ArrowLeft');
	await expect(resize).toHaveAttribute('aria-valuenow', '944');
	await expect.poll(async () => (await tools.boundingBox())?.width).toBe(944);
});
