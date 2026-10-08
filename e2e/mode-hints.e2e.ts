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

import { ru } from '$lib/i18n/locales/ru';
import { expect, test } from './fixtures';

test('object replacement suggests the custom prompt for adding an object and carries the text over', async ({
	page
}) => {
	await page.goto('/edit?tool=object-replacement');
	const panel = page.locator('#edit-tool-panel-object-replacement');
	const objectField = panel.getByPlaceholder('например: серый диван у окна');

	await objectField.fill('серый диван у окна');
	await expect(panel.getByText('похоже', { exact: false })).toHaveCount(0);

	await objectField.fill('добавь стол у окна');
	const hint = panel.getByRole('status').filter({ has: page.locator('q') });
	await expect(
		hint.getByText('похоже, вы хотите добавить новый предмет', { exact: false })
	).toBeVisible();
	await expect(hint.locator('q')).toHaveText(['добавь']);
	await panel.getByRole('button', { name: 'Перейти в «Добавить объект»' }).click();

	await expect(page).toHaveURL(/tool=add-object/);
	await expect(page.getByRole('tab', { name: 'Добавление объекта' })).toHaveAttribute(
		'aria-selected',
		'true'
	);
	await expect(page.getByRole('textbox', { name: ru['edit.addObject.customLabel'] })).toHaveValue(
		'добавь стол у окна'
	);
});

test('object replacement explains the field format when the whole swap is typed into it', async ({
	page
}) => {
	await page.goto('/edit?tool=object-replacement');
	const panel = page.locator('#edit-tool-panel-object-replacement');

	await panel.getByPlaceholder('например: серый диван у окна').fill('Замени диван на кресло');
	const hint = panel.getByRole('status').filter({ has: page.locator('q') });
	await expect(
		hint.getByText('опишите только предмет, который уже есть на фото', { exact: false })
	).toBeVisible();
	await expect(hint.locator('q')).toHaveText(['Замени']);
	await expect(panel.getByRole('button', { name: /Перейти/ })).toHaveCount(0);
});

test('the custom prompt suggests the removal tool', async ({ page }) => {
	await page.goto('/edit?tool=freeform');

	await page.getByRole('textbox', { name: 'Инструкция для правки' }).fill('убери стул у окна');
	await page.getByRole('button', { name: 'Перейти в «Удалить объект»' }).click();

	await expect(page).toHaveURL(/tool=remove-object/);
	await expect(page.getByRole('tab', { name: 'Удаление объекта' })).toHaveAttribute(
		'aria-selected',
		'true'
	);
});

test('the custom prompt suggests Repaint for a color change, and Repaint explains its field', async ({
	page
}) => {
	await page.goto('/edit?tool=freeform');

	await page
		.getByRole('textbox', { name: 'Инструкция для правки' })
		.fill('перекрась стены в белый');
	await page.getByRole('button', { name: 'Перейти в «Перекраска»' }).click();

	await expect(page).toHaveURL(/tool=repaint/);
	await expect(page.getByRole('tab', { name: 'Перекраска' })).toHaveAttribute(
		'aria-selected',
		'true'
	);

	const panel = page.locator('#edit-tool-panel-repaint');
	await panel.getByRole('textbox', { name: 'Объект' }).fill('перекрась стены');
	await expect(panel.locator('.mode-hint q')).toHaveText(['перекрась']);
	await expect(panel.getByRole('button', { name: /Перейти/ })).toHaveCount(0);
});

test('the create prompt suggests editing tools for targeted changes', async ({ page }) => {
	await page.goto('/create/interior?view=chat&format=webp');

	await page.getByRole('textbox', { name: 'Промпт чата' }).fill('Замени кресло на пуф');
	await page.getByRole('button', { name: 'Перейти в «Замена объекта»' }).click();

	await expect(page).toHaveURL(/\/edit.*tool=object-replacement/);
	await expect(page.getByRole('tab', { name: /Замена объекта/ })).toHaveAttribute(
		'aria-selected',
		'true'
	);
});

test('adding a preset object opens Add object with the template text filled in', async ({
	page
}) => {
	await page.goto('/edit?tool=object-replacement');
	const panel = page.locator('#edit-tool-panel-object-replacement');

	await panel.getByPlaceholder('например: серый диван у окна').fill('добавь растение в угол');
	await panel.getByRole('button', { name: 'Перейти в «Добавить объект»' }).click();

	await expect(page).toHaveURL(/tool=add-object/);
	await expect(page.getByRole('textbox', { name: ru['edit.addObject.customLabel'] })).toHaveValue(
		ru['edit.addObject.houseplant.phrase']
	);
});
