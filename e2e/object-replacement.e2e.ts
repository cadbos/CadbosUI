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

const JOB_ID = '123e4567-e89b-42d3-a456-426614174000';
const SOURCE_URL = 'https://cdn.example.test/scene.webp';
const BASE_URL = 'https://cdn.example.test/scene-render.webp';
const REFERENCE_URL = 'https://cdn.example.test/reference-chair.webp';

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

async function openObjectReplacement(page: Page): Promise<void> {
	let uploads = 0;
	await page.route('**/api/uploads', async (route) => {
		uploads += 1;
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				url: uploads === 1 ? SOURCE_URL : REFERENCE_URL,
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
			body: JSON.stringify({ outputUrl: BASE_URL, cost: 1, balance: 19 })
		});
	});
	await page.goto('/create/interior?view=chat&format=webp');
	await expect(page.getByRole('heading', { name: 'Сгенерированные изображения' })).toBeVisible();
	await Promise.all([
		page.waitForResponse((response) => response.url().includes('/api/uploads') && response.ok()),
		page.locator('#mode-panel-render input[type="file"]').setInputFiles({
			name: 'scene.png',
			mimeType: 'image/png',
			buffer: Buffer.from('project-source')
		})
	]);
	await page.getByRole('button', { name: 'Сгенерировать' }).click();
	await expect(page.getByRole('img', { name: 'Результат создания' })).toHaveAttribute(
		'src',
		BASE_URL
	);
	await page.getByRole('tab', { name: /Замена объекта/ }).click();
	await Promise.all([
		page.waitForResponse((response) => response.url().includes('/api/uploads') && response.ok()),
		page.locator('#edit-tool-panel-object-replacement input[type="file"]').setInputFiles({
			name: 'chair.png',
			mimeType: 'image/png',
			buffer: Buffer.from('chair-reference')
		})
	]);
}

test('submits the current result and reference, polls, and appends project history', async ({
	page
}) => {
	await authenticate(page);
	await openObjectReplacement(page);
	let submittedBody: unknown;
	let polls = 0;
	await page.route('**/api/object-replacement', async (route) => {
		submittedBody = route.request().postDataJSON();
		await route.fulfill({
			status: 202,
			contentType: 'application/json',
			body: JSON.stringify({ id: JOB_ID, status: 'processing' })
		});
	});
	await page.route(`**/api/object-replacement/${JOB_ID}`, async (route) => {
		polls += 1;
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: polls === 1 ? { 'retry-after': '0' } : undefined,
			body: JSON.stringify(
				polls === 1
					? { id: JOB_ID, status: 'processing' }
					: {
							id: JOB_ID,
							status: 'completed',
							outputUrl: 'https://cdn.example.test/replaced.webp',
							cost: 2,
							balance: 18
						}
			)
		});
	});

	const panel = page.locator('#edit-tool-panel-object-replacement');
	await panel.getByLabel(/Точно опишите существующий объект/).fill('  серый диван у окна  ');
	await panel.getByRole('button', { name: 'Заменить объект' }).click();

	await expect(page).toHaveURL(new RegExp(`job=${JOB_ID}`));
	await expect(page.getByRole('img', { name: 'Результат создания' })).toHaveAttribute(
		'src',
		'https://cdn.example.test/replaced.webp',
		{ timeout: 10_000 }
	);
	await expect(panel.locator('.job-success')).toHaveText('Замена объекта завершена.');
	await expect(page.locator('.revision')).toHaveCount(2);
	await expect.poll(() => polls).toBe(2);
	expect(submittedBody).toEqual({
		image: BASE_URL,
		referenceImage: REFERENCE_URL,
		replacementObject: 'серый диван у окна'
	});

	await panel.getByRole('button', { name: 'Новая замена' }).click();
	await expect(page).not.toHaveURL(/job=/);
	await expect(page.locator('.revision')).toHaveCount(2);
	await expect(panel.getByLabel(/Точно опишите существующий объект/)).toHaveValue('');
});

test('surfaces a credit error and prevents duplicate starts', async ({ page }) => {
	await authenticate(page);
	await openObjectReplacement(page);
	let postCount = 0;
	await page.route('**/api/object-replacement', async (route) => {
		postCount += 1;
		await route.fulfill({
			status: 402,
			contentType: 'application/json',
			body: JSON.stringify({
				error: { code: 'insufficient_credit', message: 'Test balance exhausted' }
			})
		});
	});

	const panel = page.locator('#edit-tool-panel-object-replacement');
	await panel.getByLabel(/Точно опишите существующий объект/).fill('gray sofa');
	await panel.getByRole('button', { name: 'Заменить объект' }).dblclick();
	await expect(panel.getByRole('alert')).toContainText('Тестовый баланс исчерпан');
	expect(postCount).toBe(1);
});

for (const responseCase of [
	{
		status: 403,
		code: 'generation_restricted',
		message: 'Генерация доступна ограниченному кругу пользователей'
	},
	{
		status: 429,
		code: 'rate_limited',
		message: 'Слишком много запросов на замену'
	}
]) {
	test(`maps submission status ${responseCase.status} to a localized error`, async ({ page }) => {
		await authenticate(page);
		await openObjectReplacement(page);
		await page.route('**/api/object-replacement', async (route) => {
			await route.fulfill({
				status: responseCase.status,
				contentType: 'application/json',
				body: JSON.stringify({
					error: { code: responseCase.code, message: 'Request rejected' }
				})
			});
		});

		const panel = page.locator('#edit-tool-panel-object-replacement');
		await panel.getByLabel(/Точно опишите существующий объект/).fill('gray sofa');
		await panel.getByRole('button', { name: 'Заменить объект' }).click();
		await expect(panel.getByRole('alert')).toContainText(responseCase.message);
	});
}

test('does not navigate back when an accepted submission finishes after switching modes', async ({
	page
}) => {
	await authenticate(page);
	await openObjectReplacement(page);
	let releaseResponse: (() => void) | undefined;
	const responseGate = new Promise<void>((resolve) => {
		releaseResponse = resolve;
	});
	let postCount = 0;
	await page.route('**/api/object-replacement', async (route) => {
		postCount += 1;
		await responseGate;
		await route.fulfill({
			status: 202,
			contentType: 'application/json',
			body: JSON.stringify({ id: JOB_ID, status: 'processing' })
		});
	});
	await page.route(`**/api/object-replacement/${JOB_ID}`, async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'retry-after': '30' },
			body: JSON.stringify({ id: JOB_ID, status: 'processing' })
		});
	});

	const panel = page.locator('#edit-tool-panel-object-replacement');
	await panel.getByLabel(/Точно опишите существующий объект/).fill('gray sofa');
	await panel.getByRole('button', { name: 'Заменить объект' }).click();
	await expect.poll(() => postCount).toBe(1);
	await page.getByRole('tab', { name: 'Перенос стиля' }).focus();
	await page.keyboard.press('Enter');
	releaseResponse?.();
	await expect(page).toHaveURL(/\/style-transfer\/interior\?/);
	await expect(page).not.toHaveURL(/tool=object-replacement/);
});

test('resumes a completed job after reload without submitting again', async ({ page }) => {
	await authenticate(page);
	let postCount = 0;
	let getCount = 0;
	await page.route('**/api/object-replacement', async (route) => {
		postCount += 1;
		await route.abort();
	});
	await page.route(`**/api/object-replacement/${JOB_ID}`, async (route) => {
		getCount += 1;
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				id: JOB_ID,
				status: 'completed',
				outputUrl: 'https://cdn.example.test/recovered.webp',
				cost: 2,
				balance: 18
			})
		});
	});

	await page.goto(`/edit?tool=object-replacement&source=room-photo&object=sofa&job=${JOB_ID}`);
	await expect(page.getByRole('img', { name: 'Результат создания' })).toHaveAttribute(
		'src',
		'https://cdn.example.test/recovered.webp'
	);
	await page.reload();
	await expect(page.getByRole('img', { name: 'Результат создания' })).toHaveAttribute(
		'src',
		'https://cdn.example.test/recovered.webp'
	);
	await expect.poll(() => getCount).toBe(2);
	expect(postCount).toBe(0);
});

test('keeps a restored job visible while requiring authentication for a new replacement', async ({
	page
}) => {
	await page.route('**/auth/me', async (route) => {
		await route.fulfill({
			status: 401,
			contentType: 'application/json',
			body: JSON.stringify({ error: { code: 'unauthorized', message: 'Authentication required' } })
		});
	});
	await page.route(`**/api/object-replacement/${JOB_ID}`, async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'retry-after': '30' },
			body: JSON.stringify({ id: JOB_ID, status: 'processing' })
		});
	});

	await page.goto(`/edit?tool=object-replacement&object=sofa&job=${JOB_ID}`);
	const panel = page.locator('#edit-tool-panel-object-replacement');
	await expect(panel.getByText('Войдите, чтобы заменить объект')).toBeVisible();
	await expect(panel.getByRole('button', { name: /Заменяем объект/ })).toBeDisabled();
});

test('surfaces missing and terminally failed restored jobs', async ({ page }) => {
	await authenticate(page);
	await page.route(`**/api/object-replacement/${JOB_ID}`, async (route) => {
		const failure = new URL(route.request().url()).searchParams.get('failure');
		if (failure === 'terminal') {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					id: JOB_ID,
					status: 'failed',
					error: { code: 'object_replacement_failed', message: 'Replacement failed' }
				})
			});
			return;
		}
		await route.fulfill({
			status: 404,
			contentType: 'application/json',
			body: JSON.stringify({
				error: { code: 'object_replacement_not_found', message: 'Not found' }
			})
		});
	});

	await page.goto(`/edit?tool=object-replacement&job=${JOB_ID}`);
	await expect(page.getByRole('alert')).toContainText('Не удалось найти эту задачу замены объекта');

	await page.route(`**/api/object-replacement/${JOB_ID}`, async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				id: JOB_ID,
				status: 'failed',
				error: { code: 'object_replacement_failed', message: 'Replacement failed' }
			})
		});
	});
	await page.goto(`/edit?tool=object-replacement&job=${JOB_ID}`);
	await expect(page.getByRole('alert')).toContainText('Не удалось заменить объект');
});

test('a restored timeout unlocks the retained form for retry', async ({ page }) => {
	await authenticate(page);
	await page.route(`**/api/object-replacement/${JOB_ID}`, async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				id: JOB_ID,
				status: 'failed',
				error: {
					code: 'object_replacement_timeout',
					message: 'Object replacement timed out'
				}
			})
		});
	});

	await page.goto(`/edit?tool=object-replacement&source=room-photo&object=sofa&job=${JOB_ID}`);
	const panel = page.locator('#edit-tool-panel-object-replacement');
	await expect(panel.getByRole('alert')).toContainText('Время ожидания замены истекло');
	await panel.getByRole('button', { name: 'Попробовать снова' }).click();
	await expect(page).not.toHaveURL(/job=/);
	await expect(page.getByRole('heading', { name: 'Сначала добавьте исходное фото' })).toBeVisible();
});

test('attaches a delayed replacement to its accepted revision after the user selects an earlier one', async ({
	page
}) => {
	await authenticate(page);
	await openObjectReplacement(page);
	await page.route('**/api/edit', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				outputUrl: 'https://cdn.example.test/pre-replacement-edit.webp',
				cost: 1,
				balance: 18
			})
		});
	});
	await page.getByRole('tab', { name: 'Свой промпт' }).click();
	await page.getByLabel('Инструкция для правки').fill('Сделать диван светлее');
	await page.getByRole('button', { name: 'Применить правку' }).click();
	await page.getByRole('tab', { name: /Замена объекта/ }).click();

	let pollStarted = false;
	let releasePoll: (() => void) | undefined;
	const pollGate = new Promise<void>((resolve) => {
		releasePoll = resolve;
	});
	await page.route('**/api/object-replacement', async (route) => {
		await route.fulfill({
			status: 202,
			contentType: 'application/json',
			body: JSON.stringify({ id: JOB_ID, status: 'processing' })
		});
	});
	await page.route(`**/api/object-replacement/${JOB_ID}`, async (route) => {
		pollStarted = true;
		await pollGate;
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				id: JOB_ID,
				status: 'completed',
				outputUrl: 'https://cdn.example.test/delayed-replacement.webp',
				cost: 2,
				balance: 16
			})
		});
	});

	const panel = page.locator('#edit-tool-panel-object-replacement');
	await panel.getByLabel(/Точно опишите существующий объект/).fill('gray sofa');
	await panel.getByRole('button', { name: 'Заменить объект' }).click();
	await expect.poll(() => pollStarted).toBe(true);
	await page.getByRole('button', { name: 'Открыть версию 1' }).focus();
	await page.keyboard.press('Enter');
	releasePoll?.();

	await expect(page.getByRole('img', { name: 'Результат создания' })).toHaveAttribute(
		'src',
		'https://cdn.example.test/delayed-replacement.webp'
	);
	await expect(page.locator('.revision')).toHaveCount(3);
	await page.getByRole('button', { name: 'Отменить последнюю правку' }).click();
	await expect(page.getByRole('img', { name: 'Результат создания' })).toHaveAttribute(
		'src',
		'https://cdn.example.test/pre-replacement-edit.webp'
	);
});
