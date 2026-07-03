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

test('renders the workspace and switches views', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await expect(page.getByRole('tab', { name: 'Чат' })).toHaveAttribute('aria-selected', 'true');
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

test('keeps the prompt byte-identical when switching from chat to key-value', async ({ page }) => {
	await page.goto('/');
	const prompt = 'Scandinavian style, warm natural light';

	await page.getByPlaceholder('Скандинавский стиль, тёплые тона, натуральный свет…').fill(prompt);

	await page.getByRole('tab', { name: 'Ключ-значение' }).click();
	await expect(page.getByRole('tab', { name: 'Ключ-значение' })).toHaveAttribute(
		'aria-selected',
		'true'
	);

	await expect(promptPreview(page)).toHaveValue(prompt);
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

test('serves security headers and a content security policy', async ({ request }) => {
	const response = await request.get('/');
	const headers = response.headers();

	expect(headers['x-content-type-options']).toBe('nosniff');
	expect(headers['x-frame-options']).toBe('DENY');
	expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
	expect(headers['permissions-policy']).toContain('geolocation=()');
	expect(headers['content-security-policy']).toContain("default-src 'self'");
});
