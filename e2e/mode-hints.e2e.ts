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

import { expect, test } from './fixtures';

test('object replacement suggests the custom prompt for adding an object and carries the text over', async ({
	page
}) => {
	await page.goto('/edit?tool=object-replacement');
	const panel = page.locator('#edit-tool-panel-object-replacement');
	const objectField = panel.getByPlaceholder('например: серый диван у окна');

	await objectField.fill('серый диван у окна');
	await expect(panel.getByText('Похоже', { exact: false })).toHaveCount(0);

	await objectField.fill('добавь стол у окна');
	await expect(panel.getByText('Похоже, вы хотите добавить новый предмет.')).toBeVisible();
	await panel.getByRole('button', { name: 'Перейти в «Свой промпт»' }).click();

	await expect(page).toHaveURL(/tool=freeform/);
	await expect(page.getByRole('tab', { name: 'Свой промпт' })).toHaveAttribute(
		'aria-selected',
		'true'
	);
	await expect(page.getByRole('textbox', { name: 'Инструкция для правки' })).toHaveValue(
		'добавь стол у окна'
	);
});

test('object replacement explains the field format when the whole swap is typed into it', async ({
	page
}) => {
	await page.goto('/edit?tool=object-replacement');
	const panel = page.locator('#edit-tool-panel-object-replacement');

	await panel.getByPlaceholder('например: серый диван у окна').fill('замени диван на кресло');
	await expect(
		panel.getByText('Опишите только предмет, который уже есть на фото', { exact: false })
	).toBeVisible();
	await expect(panel.getByRole('button', { name: /Перейти/ })).toHaveCount(0);
});

test('the custom prompt suggests the removal tool', async ({ page }) => {
	await page.goto('/edit?tool=freeform');

	await page.getByRole('textbox', { name: 'Инструкция для правки' }).fill('убери стул у окна');
	await page.getByRole('button', { name: 'Перейти в «Удалить объект»' }).click();

	await expect(page).toHaveURL(/tool=remove-object/);
	await expect(page.getByRole('tab', { name: 'Удалить объект' })).toHaveAttribute(
		'aria-selected',
		'true'
	);
});

test('the create prompt suggests editing tools for targeted changes', async ({ page }) => {
	await page.goto('/create/interior?view=chat&format=webp');

	await page.getByRole('textbox', { name: 'Промпт чата' }).fill('Замени кресло на пуф');
	await page.getByRole('button', { name: 'Перейти в «Свой промпт»' }).click();

	await expect(page).toHaveURL(/\/edit.*tool=freeform/);
	await expect(page.getByRole('textbox', { name: 'Инструкция для правки' })).toHaveValue(
		'Замени кресло на пуф'
	);
});

test('adding a preset object opens Add object with that preset selected', async ({ page }) => {
	await page.goto('/edit?tool=object-replacement');
	const panel = page.locator('#edit-tool-panel-object-replacement');

	await panel.getByPlaceholder('например: серый диван у окна').fill('добавь растение в угол');
	await panel.getByRole('button', { name: 'Перейти в «Добавить объект»' }).click();

	await expect(page).toHaveURL(/tool=add-object/);
	await expect(page.getByRole('radio', { name: 'Комнатное растение' })).toHaveAttribute(
		'aria-checked',
		'true'
	);
});
