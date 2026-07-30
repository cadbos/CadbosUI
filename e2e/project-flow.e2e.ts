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

const SOURCE_URL = 'https://cdn.example.test/project-source.webp';
const BASE_URL = 'https://cdn.example.test/project-base.webp';

async function authenticate(page: Page): Promise<void> {
	await page.route('**/auth/me', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				user: { pubkey: '0'.repeat(64), firstName: 'Ada', lastName: 'Lovelace' },
				credit: { balance: 100, updatedAt: 0, history: [] }
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

async function openProject(page: Page): Promise<void> {
	await page.goto('/create/interior?view=chat&format=webp');
}

async function uploadSource(page: Page): Promise<void> {
	await expect(page.getByRole('heading', { name: 'Сгенерированные изображения' })).toBeVisible();
	const input = page.locator('#mode-panel-render input[type="file"]');
	await expect(async () => {
		await input.setInputFiles([]);
		await input.setInputFiles({
			name: 'room.png',
			mimeType: 'image/png',
			buffer: Buffer.from('project-source')
		});
		await expect(
			page.locator('#mode-panel-render').getByRole('button', { name: 'Изменить фото' })
		).toBeVisible({ timeout: 2_000 });
	}).toPass({ timeout: 10_000 });
}

async function createBase(page: Page): Promise<void> {
	await uploadSource(page);
	await page.getByRole('button', { name: 'Сгенерировать' }).click();
	await expect(page.getByRole('img', { name: 'Результат создания' })).toHaveAttribute(
		'src',
		BASE_URL
	);
}

test('shows only Project and Style transfer at the top level and keeps /edit in Project', async ({
	page
}) => {
	await openProject(page);

	const modeTabs = page.locator('.mode-nav').getByRole('tab');
	await expect(modeTabs).toHaveCount(2);
	await expect(modeTabs).toHaveText(['Проект', 'Перенос стиля']);
	await expect(page.getByRole('tab', { name: 'Проект', exact: true })).toHaveAttribute(
		'aria-selected',
		'true'
	);

	await page.goto('/edit');

	await expect(page).toHaveURL(/\/edit\?tool=freeform$/);
	await expect(page.getByRole('tab', { name: 'Проект', exact: true })).toHaveAttribute(
		'aria-selected',
		'true'
	);
	await expect(page.locator('.mode-nav').getByRole('tab')).toHaveText(['Проект', 'Перенос стиля']);
});

test('unlocks creation after upload and editing only after the first render', async ({ page }) => {
	await authenticate(page);
	await page.route('**/api/uploads', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				url: SOURCE_URL,
				mime: 'image/webp',
				size: 1024,
				dimensions: [800, 600]
			})
		});
	});
	await page.route('**/api/render', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ outputUrl: BASE_URL, cost: 5, balance: 95 })
		});
	});

	await openProject(page);

	await expect(page.getByRole('heading', { name: 'Сначала добавьте исходное фото' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Сгенерировать' })).toHaveCount(0);
	await expect(page.locator('#project-edit-panel')).toHaveCount(0);

	await uploadSource(page);

	await expect(page.getByRole('heading', { name: 'Сначала добавьте исходное фото' })).toHaveCount(
		0
	);
	await expect(page.getByRole('button', { name: 'Сгенерировать' })).toBeEnabled();
	await expect(page.locator('#project-edit-panel')).toHaveCount(0);

	await page.getByRole('button', { name: 'Сгенерировать' }).click();

	await expect(page.getByRole('img', { name: 'Результат создания' })).toHaveAttribute(
		'src',
		BASE_URL
	);
	await expect(page.locator('#project-edit-panel')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Что изменить дальше?' })).toBeVisible();
	await expect(page.getByLabel('Этапы проекта').locator('[aria-current="step"]')).toContainText(
		'Последовательные правки'
	);
});

test('chains freeform edits, navigates history, and truncates a replaced future branch', async ({
	page
}) => {
	await authenticate(page);
	let uploads = 0;
	const editBodies: unknown[] = [];
	const editOutputs = [
		'https://cdn.example.test/edit-one.webp',
		'https://cdn.example.test/edit-two.webp',
		'https://cdn.example.test/edit-branch.webp'
	];

	await page.route('**/api/uploads', async (route) => {
		uploads += 1;
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				url: SOURCE_URL,
				mime: 'image/webp',
				size: 1024,
				dimensions: [800, 600]
			})
		});
	});
	await page.route('**/api/render', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ outputUrl: BASE_URL, cost: 5, balance: 95 })
		});
	});
	await page.route('**/api/edit', async (route) => {
		const outputUrl = editOutputs[editBodies.length];
		if (outputUrl === undefined) throw new Error('Unexpected extra edit request');
		editBodies.push(route.request().postDataJSON());
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ outputUrl, cost: 2, balance: 93 - editBodies.length })
		});
	});

	await openProject(page);
	await createBase(page);

	const resultImage = page.getByRole('img', { name: 'Результат создания' });
	const instruction = page.getByLabel('Инструкция для правки');
	await instruction.fill('Сделать диван светлее');
	await page.getByRole('button', { name: 'Применить правку' }).click();
	await expect(resultImage).toHaveAttribute('src', editOutputs[0]);
	await instruction.fill('Добавить тёплый свет');
	await page.getByRole('button', { name: 'Применить правку' }).click();
	await expect(resultImage).toHaveAttribute('src', editOutputs[1]);

	expect(uploads).toBe(1);
	expect(editBodies).toEqual([
		{ image: BASE_URL, prompt: 'Сделать диван светлее' },
		{ image: editOutputs[0], prompt: 'Добавить тёплый свет' }
	]);
	await expect(page.getByRole('heading', { name: 'История версий' })).toBeVisible();
	await expect(page.locator('.revision')).toHaveCount(3);
	await expect(page.getByText('Основа', { exact: true })).toBeVisible();
	await expect(page.getByText('Правка 1', { exact: true })).toBeVisible();
	await expect(page.getByText('Правка 2', { exact: true })).toBeVisible();

	await page.getByRole('button', { name: 'Открыть версию 2' }).click();
	await expect(resultImage).toHaveAttribute('src', editOutputs[0]);
	await page.getByRole('button', { name: 'Отменить последнюю правку' }).click();
	await expect(resultImage).toHaveAttribute('src', BASE_URL);
	await page.getByRole('button', { name: 'Вернуть отменённую правку' }).click();
	await expect(resultImage).toHaveAttribute('src', editOutputs[0]);

	await instruction.fill('Сделать стены голубыми');
	await page.getByRole('button', { name: 'Применить правку' }).click();
	await expect(resultImage).toHaveAttribute('src', editOutputs[2]);

	expect(editBodies[2]).toEqual({
		image: editOutputs[0],
		prompt: 'Сделать стены голубыми'
	});
	await expect(page.locator('.revision')).toHaveCount(3);
	await expect(page.locator(`.revision img[src="${editOutputs[1]}"]`)).toHaveCount(0);
	await expect(page.locator(`.revision img[src="${editOutputs[2]}"]`)).toHaveCount(1);
});

test('keeps the project source and history when starting another object replacement', async ({
	page
}) => {
	await authenticate(page);
	let uploads = 0;
	const jobId = '11111111-1111-4111-8111-111111111111';

	await page.route('**/api/uploads', async (route) => {
		uploads += 1;
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				url: uploads === 1 ? SOURCE_URL : 'https://cdn.example.test/chair-reference.webp',
				mime: 'image/webp',
				size: 1024,
				dimensions: [800, 600]
			})
		});
	});
	await page.route('**/api/render', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ outputUrl: BASE_URL, cost: 5, balance: 95 })
		});
	});
	await page.route('**/api/object-replacement', async (route) => {
		await route.fulfill({
			status: 202,
			contentType: 'application/json',
			body: JSON.stringify({ id: jobId, status: 'processing' })
		});
	});
	await page.route(`**/api/object-replacement/${jobId}`, async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				id: jobId,
				status: 'completed',
				outputUrl: 'https://cdn.example.test/replaced-chair.webp',
				cost: 2,
				balance: 93
			})
		});
	});

	await openProject(page);
	await createBase(page);
	await page.getByRole('tab', { name: /Замена объекта/ }).click();

	const panel = page.locator('#edit-tool-panel-object-replacement');
	await expect(panel.getByRole('img', { name: 'Текущий результат' })).toHaveAttribute(
		'src',
		BASE_URL
	);
	await Promise.all([
		page.waitForResponse((response) => response.url().includes('/api/uploads') && response.ok()),
		panel.locator('input[type="file"]').setInputFiles({
			name: 'chair.png',
			mimeType: 'image/png',
			buffer: Buffer.from('chair-reference')
		})
	]);
	await panel.getByLabel(/Точно опишите существующий объект/).fill('серое кресло');
	await panel.getByRole('button', { name: 'Заменить объект' }).click();

	await expect(page.getByRole('img', { name: 'Результат создания' })).toHaveAttribute(
		'src',
		'https://cdn.example.test/replaced-chair.webp'
	);
	await expect(page.locator('.revision')).toHaveCount(2);
	await panel.getByRole('button', { name: 'Новая замена' }).click();

	await expect(page.locator('.revision')).toHaveCount(2);
	await expect(page.getByRole('img', { name: 'Результат создания' })).toHaveAttribute(
		'src',
		'https://cdn.example.test/replaced-chair.webp'
	);
	await expect(panel.getByRole('img', { name: 'Текущий результат' })).toHaveAttribute(
		'src',
		'https://cdn.example.test/replaced-chair.webp'
	);
	await expect(uploads).toBe(2);

	await page.getByRole('button', { name: 'Начать с другого фото' }).click();

	await expect(page.getByRole('button', { name: 'Изменить фото' })).toBeVisible();
	await expect(page.getByRole('img', { name: 'Фото комнаты' })).toHaveAttribute('src', SOURCE_URL);
	await expect(page.getByRole('img', { name: 'Результат создания' })).toHaveCount(0);
	await expect(page.locator('#project-edit-panel')).toHaveCount(0);
	await expect(uploads).toBe(2);
});

test('preserves exterior and PNG settings across edit Back and Forward navigation', async ({
	page
}) => {
	await authenticate(page);
	await page.route('**/api/uploads', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				url: SOURCE_URL,
				mime: 'image/webp',
				size: 1024,
				dimensions: [800, 600]
			})
		});
	});
	await page.route('**/api/render/exterior', async (route) => {
		expect(route.request().postDataJSON()).toMatchObject({ outputFormat: 'png' });
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ outputUrl: BASE_URL, cost: 5, balance: 95 })
		});
	});

	await page.goto('/create/exterior?view=chat&format=png');
	await uploadSource(page);
	await page.getByRole('button', { name: 'Сгенерировать' }).click();
	await page.getByRole('button', { name: 'Перейти к правкам' }).click();
	await expect(page).toHaveURL(/\/edit\?tool=freeform$/);

	await page.goBack();
	await expect(page).toHaveURL(/\/create\/exterior\?view=chat&format=png$/);
	await page.goForward();
	await expect(page).toHaveURL(/\/edit\?tool=freeform$/);
	await page.getByRole('button', { name: 'Начать с другого фото' }).click();
	await expect(page).toHaveURL(/\/create\/exterior\?view=chat&format=png$/);
	await expect(page.getByRole('tab', { name: 'Экстерьер' })).toHaveAttribute(
		'aria-selected',
		'true'
	);
	await expect(page.locator('#mode-panel-render').getByLabel('Формат')).toHaveValue('png');
});

test('style transfer appends current-result history but room-photo transfer starts a new root', async ({
	page
}) => {
	await authenticate(page);
	let uploads = 0;
	const submittedImages: string[] = [];
	await page.route('**/api/uploads', async (route) => {
		uploads += 1;
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				url: SOURCE_URL,
				mime: 'image/webp',
				size: 1024,
				dimensions: [800, 600]
			})
		});
	});
	await page.route('**/api/render', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ outputUrl: BASE_URL, cost: 5, balance: 95 })
		});
	});
	let transfers = 0;
	await page.route('**/api/style-transfer', async (route) => {
		transfers += 1;
		submittedImages.push((route.request().postDataJSON() as { image: string }).image);
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				outputUrl:
					transfers === 1
						? 'https://cdn.example.test/styled-child.webp'
						: 'https://cdn.example.test/styled-root.webp',
				cost: 2,
				balance: 93
			})
		});
	});

	await openProject(page);
	await createBase(page);
	await page.getByRole('tab', { name: 'Перенос стиля' }).click();
	const stylePanel = page.locator('#mode-panel-styleTransfer');
	await stylePanel.getByRole('radio', { name: 'Спа-ванная из бетона' }).click();
	await stylePanel.getByRole('button', { name: 'Перенести стиль' }).click();
	await page.getByRole('tab', { name: 'Проект', exact: true }).click();
	await expect(page.getByRole('img', { name: 'Результат создания' })).toHaveAttribute(
		'src',
		'https://cdn.example.test/styled-child.webp'
	);
	await expect(page.locator('.revision')).toHaveCount(2);

	await page.getByRole('tab', { name: 'Перенос стиля' }).click();
	await stylePanel.getByRole('button', { name: 'Фото комнаты' }).click();
	await stylePanel.getByRole('button', { name: 'Перенести стиль' }).click();
	await page.getByRole('tab', { name: 'Проект', exact: true }).click();
	await expect(page.getByRole('img', { name: 'Результат создания' })).toHaveAttribute(
		'src',
		'https://cdn.example.test/styled-root.webp'
	);
	await expect(page.locator('.revision')).toHaveCount(1);
	expect(submittedImages).toEqual([BASE_URL, SOURCE_URL]);
	expect(uploads).toBe(1);
});

test('attaches a delayed freeform result to its snapshot source and replaces that future branch', async ({
	page
}) => {
	await authenticate(page);
	await page.route('**/api/uploads', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				url: SOURCE_URL,
				mime: 'image/webp',
				size: 1024,
				dimensions: [800, 600]
			})
		});
	});
	await page.route('**/api/render', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ outputUrl: BASE_URL, cost: 5, balance: 95 })
		});
	});
	let releaseDelayed: (() => void) | undefined;
	const delayedGate = new Promise<void>((resolve) => {
		releaseDelayed = resolve;
	});
	const editBodies: { image: string; prompt: string }[] = [];
	const outputs = [
		'https://cdn.example.test/branch-one.webp',
		'https://cdn.example.test/old-future.webp',
		'https://cdn.example.test/new-future.webp'
	];
	await page.route('**/api/edit', async (route) => {
		const index = editBodies.length;
		editBodies.push(route.request().postDataJSON() as { image: string; prompt: string });
		if (index === 2) await delayedGate;
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ outputUrl: outputs[index], cost: 1, balance: 90 - index })
		});
	});

	await openProject(page);
	await createBase(page);
	const instruction = page.getByLabel('Инструкция для правки');
	for (const prompt of ['Первая правка', 'Старая будущая правка']) {
		await instruction.fill(prompt);
		await page.getByRole('button', { name: 'Применить правку' }).click();
	}
	await page.getByRole('button', { name: 'Открыть версию 2' }).click();
	await instruction.fill('Новая ветка');
	await page.getByRole('button', { name: 'Применить правку' }).click();
	await expect.poll(() => editBodies.length).toBe(3);
	await page.getByRole('button', { name: 'Открыть версию 1' }).focus();
	await page.keyboard.press('Enter');
	releaseDelayed?.();

	await expect(page.getByRole('img', { name: 'Результат создания' })).toHaveAttribute(
		'src',
		outputs[2]
	);
	expect(editBodies[2]).toEqual({ image: outputs[0], prompt: 'Новая ветка' });
	await expect(page.locator('.revision')).toHaveCount(3);
	await expect(page.locator(`.revision img[src="${outputs[1]}"]`)).toHaveCount(0);
	await expect(page.locator(`.revision img[src="${outputs[2]}"]`)).toHaveCount(1);
});
