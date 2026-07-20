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

async function uploadInputs(page: Page): Promise<void> {
	let upload = 0;
	await page.route('**/api/uploads', async (route) => {
		upload += 1;
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				url:
					upload === 1
						? 'https://cdn.example.test/scene.webp'
						: 'https://cdn.example.test/reference-chair.webp',
				mime: 'image/webp',
				size: 1024,
				dimensions: [800, 600]
			})
		});
	});

	const panel = page.locator('#mode-panel-objectReplacement');
	const inputs = panel.locator('input[type="file"]');
	await inputs.nth(0).setInputFiles({
		name: 'scene.webp',
		mimeType: 'image/webp',
		buffer: Buffer.from('scene')
	});
	await inputs.nth(1).setInputFiles({
		name: 'chair.webp',
		mimeType: 'image/webp',
		buffer: Buffer.from('chair')
	});
}

test('submits two uploaded images, polls the job, and promotes the completed result', async ({
	page
}) => {
	await authenticate(page);
	await page.goto('/object-replacement');
	await uploadInputs(page);

	let submittedBody: unknown;
	let polls = 0;
	await page.route('**/api/object-replacement', async (route) => {
		submittedBody = route.request().postDataJSON();
		await route.fulfill({
			status: 202,
			contentType: 'application/json',
			headers: { location: `/api/object-replacement/${JOB_ID}` },
			body: JSON.stringify({ id: JOB_ID, status: 'processing' })
		});
	});
	await page.route(`**/api/object-replacement/${JOB_ID}`, async (route) => {
		polls += 1;
		if (polls === 1) {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				headers: { 'retry-after': '0' },
				body: JSON.stringify({ id: JOB_ID, status: 'processing' })
			});
			return;
		}
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				id: JOB_ID,
				status: 'completed',
				outputUrl: 'https://cdn.example.test/replaced.webp',
				cost: 2,
				balance: 18
			})
		});
	});

	const panel = page.locator('#mode-panel-objectReplacement');
	await panel.getByLabel(/Точно опишите существующий объект/).fill('  серый диван у окна  ');
	await panel.getByRole('button', { name: 'Заменить объект' }).click();

	await expect(page).toHaveURL(new RegExp(`job=${JOB_ID}`));
	await expect(panel.locator('.job-status')).toContainText('Заменяем объект');
	await expect(page.locator('.result img.output')).toHaveAttribute(
		'src',
		'https://cdn.example.test/replaced.webp',
		{ timeout: 10_000 }
	);
	await expect(panel.locator('.job-success')).toHaveText('Замена объекта завершена.');
	await expect(page.getByText('Стоимость: 2.00')).toBeVisible();
	await expect(page.getByText('Баланс: 18.00')).toBeVisible();
	await expect.poll(() => polls).toBe(2);
	expect(submittedBody).toEqual({
		image: 'https://cdn.example.test/scene.webp',
		referenceImage: 'https://cdn.example.test/reference-chair.webp',
		replacementObject: 'серый диван у окна'
	});

	await page.getByRole('tab', { name: 'Редактирование' }).click();
	await expect(page.getByRole('button', { name: 'Сравнить до/после' })).toBeDisabled();
	await page.getByRole('tab', { name: /Замена объекта/ }).click();
	await expect(page).toHaveURL(new RegExp(`job=${JOB_ID}`));

	await panel.getByRole('button', { name: 'Новая замена' }).click();
	await expect(page).not.toHaveURL(/job=/);
	await expect(panel.getByLabel(/Точно опишите существующий объект/)).toHaveValue(
		'  серый диван у окна  '
	);
});

test('resumes a stored completed job after reload without submitting again', async ({ page }) => {
	await authenticate(page);
	let postCount = 0;
	let getCount = 0;
	await page.route('**/api/object-replacement', async (route) => {
		postCount += 1;
		await route.abort();
	});
	await page.route(`**/api/object-replacement/${JOB_ID}`, async (route) => {
		getCount += 1;
		if (getCount === 1) {
			await route.fulfill({
				status: 502,
				contentType: 'application/json',
				body: JSON.stringify({
					error: { code: 'object_replacement_poll_failed', message: 'Poll failed' }
				})
			});
			return;
		}
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

	await page.goto(`/object-replacement?source=room-photo&object=sofa&job=${JOB_ID}`);
	await expect(page.locator('.result img.output')).toHaveAttribute(
		'src',
		'https://cdn.example.test/recovered.webp'
	);
	await page.reload();
	await expect(page.locator('.result img.output')).toHaveAttribute(
		'src',
		'https://cdn.example.test/recovered.webp'
	);
	await expect.poll(() => getCount).toBe(3);
	expect(postCount).toBe(0);
});

test('keeps the accepted current-result lineage when another render finishes first', async ({
	page
}) => {
	await authenticate(page);
	let uploads = 0;
	await page.route('**/api/uploads', async (route) => {
		uploads += 1;
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				url:
					uploads === 1
						? 'https://cdn.example.test/room.webp'
						: 'https://cdn.example.test/reference.webp',
				mime: 'image/webp',
				size: 1024,
				dimensions: [800, 600]
			})
		});
	});

	let renders = 0;
	await page.route('**/api/render', async (route) => {
		renders += 1;
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				outputUrl:
					renders === 1
						? 'https://cdn.example.test/original-result.webp'
						: 'https://cdn.example.test/newer-result.webp',
				cost: 1,
				balance: 19 - renders
			})
		});
	});

	let submittedImage = '';
	let polls = 0;
	await page.route('**/api/object-replacement', async (route) => {
		submittedImage = (route.request().postDataJSON() as { image: string }).image;
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
			headers: polls === 1 ? { 'retry-after': '2' } : undefined,
			body: JSON.stringify(
				polls === 1
					? { id: JOB_ID, status: 'processing' }
					: {
							id: JOB_ID,
							status: 'completed',
							outputUrl: 'https://cdn.example.test/replaced.webp',
							cost: 2,
							balance: 16
						}
			)
		});
	});

	await page.goto('/create/interior');
	await page.locator('#mode-panel-render input[type="file"]').setInputFiles({
		name: 'room.webp',
		mimeType: 'image/webp',
		buffer: Buffer.from('room')
	});
	await page.getByRole('button', { name: 'Сгенерировать' }).click();
	await expect(page.locator('.result img.output')).toHaveAttribute(
		'src',
		'https://cdn.example.test/original-result.webp'
	);

	await page.getByRole('tab', { name: /Замена объекта/ }).click();
	const panel = page.locator('#mode-panel-objectReplacement');
	await panel.locator('input[type="file"]').setInputFiles({
		name: 'reference.webp',
		mimeType: 'image/webp',
		buffer: Buffer.from('reference')
	});
	await panel.getByLabel(/Точно опишите существующий объект/).fill('gray sofa');
	await panel.getByRole('button', { name: 'Заменить объект' }).click();
	await expect(page).toHaveURL(new RegExp(`job=${JOB_ID}`));

	await page.getByRole('tab', { name: 'Создание' }).click();
	await page.getByRole('button', { name: 'Сгенерировать' }).click();
	await expect(page.locator('.result img.output')).toHaveAttribute(
		'src',
		'https://cdn.example.test/newer-result.webp'
	);
	await expect(page.locator('.result img.output')).toHaveAttribute(
		'src',
		'https://cdn.example.test/replaced.webp',
		{ timeout: 10_000 }
	);
	await page.getByRole('button', { name: 'Отменить' }).click();
	await expect(page.locator('.result img.output')).toHaveAttribute(
		'src',
		'https://cdn.example.test/original-result.webp'
	);
	await expect.poll(() => submittedImage).toBe('https://cdn.example.test/original-result.webp');
});

test('surfaces submission credit errors and prevents duplicate starts', async ({ page }) => {
	await authenticate(page);
	await page.goto('/object-replacement');
	await uploadInputs(page);
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

	const panel = page.locator('#mode-panel-objectReplacement');
	await panel.getByLabel(/Точно опишите существующий объект/).fill('gray sofa');
	await panel.getByRole('button', { name: 'Заменить объект' }).dblclick();
	await expect(panel.getByRole('alert')).toContainText('Тестовый баланс исчерпан');
	expect(postCount).toBe(1);
});

test('requires authentication before starting a replacement', async ({ page }) => {
	await page.route('**/auth/me', async (route) => {
		await route.fulfill({
			status: 401,
			contentType: 'application/json',
			body: JSON.stringify({ error: { code: 'unauthorized', message: 'Authentication required' } })
		});
	});
	await page.goto('/object-replacement');

	const panel = page.locator('#mode-panel-objectReplacement');
	await expect(panel.getByText('Войдите, чтобы заменить объект')).toBeVisible();
	await expect(panel.getByRole('button', { name: 'Заменить объект' })).toBeDisabled();
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
		await page.goto('/object-replacement');
		await uploadInputs(page);
		await page.route('**/api/object-replacement', async (route) => {
			await route.fulfill({
				status: responseCase.status,
				contentType: 'application/json',
				body: JSON.stringify({
					error: { code: responseCase.code, message: 'Request rejected' }
				})
			});
		});

		const panel = page.locator('#mode-panel-objectReplacement');
		await panel.getByLabel(/Точно опишите существующий объект/).fill('gray sofa');
		await panel.getByRole('button', { name: 'Заменить объект' }).click();
		await expect(panel.getByRole('alert')).toContainText(responseCase.message);
	});
}

test('surfaces a missing restored job', async ({ page }) => {
	await authenticate(page);
	await page.route(`**/api/object-replacement/${JOB_ID}`, async (route) => {
		await route.fulfill({
			status: 404,
			contentType: 'application/json',
			body: JSON.stringify({
				error: { code: 'object_replacement_not_found', message: 'Not found' }
			})
		});
	});

	await page.goto(`/object-replacement?job=${JOB_ID}`);
	await expect(page.locator('#mode-panel-objectReplacement').getByRole('alert')).toContainText(
		'Не удалось найти эту задачу замены объекта'
	);
});

test('surfaces a generic terminal job failure', async ({ page }) => {
	await authenticate(page);
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

	await page.goto(`/object-replacement?job=${JOB_ID}`);
	await expect(page.locator('#mode-panel-objectReplacement').getByRole('alert')).toContainText(
		'Не удалось заменить объект'
	);
});

test('does not navigate back when an accepted submission finishes after a mode switch', async ({
	page
}) => {
	await authenticate(page);
	await page.goto('/object-replacement');
	await uploadInputs(page);
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

	const panel = page.locator('#mode-panel-objectReplacement');
	await panel.getByLabel(/Точно опишите существующий объект/).fill('gray sofa');
	await panel.getByRole('button', { name: 'Заменить объект' }).click();
	await expect.poll(() => postCount).toBe(1);
	await page.getByRole('tab', { name: 'Редактирование' }).click();
	releaseResponse?.();
	await expect(page).toHaveURL(/\/edit\?tool=freeform$/);
	await expect(page).not.toHaveURL(/object-replacement/);
});

test('surfaces a terminal timeout and unlocks the retained form for retry', async ({ page }) => {
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

	await page.goto(`/object-replacement?source=room-photo&object=sofa&job=${JOB_ID}`);
	const panel = page.locator('#mode-panel-objectReplacement');
	await expect(panel.getByRole('alert')).toContainText('Время ожидания замены истекло');
	await panel.getByRole('button', { name: 'Попробовать снова' }).click();
	await expect(page).not.toHaveURL(/job=/);
	await expect(panel.getByLabel(/Точно опишите существующий объект/)).toBeEnabled();
});
