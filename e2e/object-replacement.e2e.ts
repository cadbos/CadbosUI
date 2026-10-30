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
import { readFile } from 'node:fs/promises';

import { expect, test } from './fixtures';
import { ru } from '$lib/i18n/locales/ru';
import { media, mediaKey } from './helpers/media';
import {
	E2E_PROJECT_ID,
	E2E_SESSION_ID,
	mockProjectSessionRoutes
} from './helpers/project-session-routes';

const JOB_ID = '123e4567-e89b-42d3-a456-426614174000';

async function authenticate(page: Page): Promise<void> {
	await page.route('**/auth/me', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				user: { pubkey: '0'.repeat(64), firstName: 'Ada', lastName: 'Lovelace' },
				featurebaseJwt: null,
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
	await mockProjectSessionRoutes(page);
}

async function uploadInputs(page: Page, sceneBuffer?: Buffer): Promise<void> {
	await page.route('**/api/uploads', async (route) => {
		const body = route.request().postDataBuffer();
		if (body === null) throw new Error('Upload request body is missing');
		const isScene = body.includes(Buffer.from('scene'));
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				image: isScene
					? media(1, '/api/media/test-media/scene.webp')
					: media(2, '/api/media/test-media/reference-chair.webp'),
				mime: 'image/webp',
				size: 1024,
				dimensions: [800, 600]
			})
		});
	});

	await expect(page.locator('html')).not.toHaveAttribute('data-client-load-state', 'loading');
	const inputs = page.locator('#mode-panel-edit input[type="file"]');
	// The room/main photo upload (nth(0)) is deferred to submit time — just
	// pick the file locally here; the actual /api/uploads call fires once the
	// test later submits the object-replacement request. Wait for the local
	// preview to render before continuing, so validation/canSubmit has settled
	// on the picked file rather than racing a still-pending reactive update.
	await inputs.nth(0).setInputFiles({
		name: sceneBuffer ? 'scene.png' : 'scene.webp',
		mimeType: sceneBuffer ? 'image/png' : 'image/webp',
		buffer: sceneBuffer ?? Buffer.from('scene')
	});
	await expect(page.getByRole('button', { name: 'Выбрать фото' })).toBeVisible();
	await Promise.all([
		page.waitForResponse((response) => response.url().includes('/api/uploads') && response.ok()),
		inputs.nth(1).setInputFiles({
			name: 'chair.webp',
			mimeType: 'image/webp',
			buffer: Buffer.from('chair')
		})
	]);
}

for (const balance of [18, -1]) {
	test(`submits two uploaded images, polls the job, and promotes the completed result (balance ${balance})`, async ({
		page
	}) => {
		await authenticate(page);
		await page.goto('/edit?tool=object-replacement');
		await uploadInputs(page);

		let submittedBody: unknown;
		let polls = 0;
		await page.route('**/api/object-replacement', async (route) => {
			submittedBody = route.request().postDataJSON();
			await route.fulfill({
				status: 202,
				contentType: 'application/json',
				headers: { location: `/api/object-replacement/${JOB_ID}` },
				body: JSON.stringify({
					id: JOB_ID,
					status: 'processing',
					elapsedMs: 0,
					queue: { status: 'unknown' }
				})
			});
		});
		await page.route(`**/api/object-replacement/${JOB_ID}`, async (route) => {
			polls += 1;
			if (polls === 1) {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					headers: { 'retry-after': '0' },
					body: JSON.stringify({
						id: JOB_ID,
						status: 'processing',
						elapsedMs: 0,
						queue: { status: 'unknown' }
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
					output: media(3, '/api/media/test-media/replaced.webp'),
					cost: 2,
					balance
				})
			});
		});

		const panel = page.locator('#edit-tool-panel-object-replacement');
		await panel.getByLabel(/Точно опишите существующий объект/).fill('  серый диван у окна  ');
		await panel.getByRole('button', { name: 'Заменить объект' }).click();

		await expect(page).toHaveURL(new RegExp(`job=${JOB_ID}`));
		await expect(panel.locator('.job-status')).toContainText('Заменяем объект');
		await expect(page.locator('.result:visible img.output')).toHaveAttribute(
			'src',
			'/api/media/test-media/replaced.webp',
			{ timeout: 10_000 }
		);
		await expect(panel.getByText('Замена объекта завершена.', { exact: true })).toHaveCount(0);
		await expect(
			page.locator('.scene-finances .desktop').getByText('Стоимость: 2.00')
		).toBeVisible();
		await expect(
			page.locator('.scene-finances .desktop').getByText(`Баланс: ${balance.toFixed(2)}`)
		).toBeVisible();
		await expect.poll(() => polls).toBe(2);
		expect(submittedBody).toEqual({
			imageKey: mediaKey(1),
			referenceImageKey: mediaKey(2),
			replacementObject: 'серый диван у окна',
			sessionId: E2E_SESSION_ID,
			formSnapshot: expect.any(Object)
		});

		await page.getByRole('tab', { name: 'Редактирование' }).click();
		await expect(page.getByRole('button', { name: 'Сравнить до/после' })).toBeEnabled();
		await page.getByRole('tab', { name: /Замена объекта/ }).click();
		await expect(page).not.toHaveURL(/job=/);
		await expect(panel.getByRole('button', { name: 'Новая замена' })).toHaveCount(0);
		await expect(panel.getByLabel(/Точно опишите существующий объект/)).toHaveValue(
			'  серый диван у окна  '
		);
		await expect(panel.getByRole('button', { name: 'Выбрать референс объекта' })).toBeEnabled();

		// Choosing another reference drops the current one and returns to the
		// reference picker, focused, ready for a file, a drop or a link.
		await panel.getByRole('button', { name: 'Выбрать референс объекта' }).click();
		await expect(panel.getByRole('button', { name: 'Выбрать референс объекта' })).toHaveCount(0);
		await expect(panel.getByRole('button', { name: /^Референс нового объекта/ })).toBeFocused();
	});
}

test('submits an adjusted area and clears it independently', async ({ page }) => {
	await authenticate(page);
	await page.goto('/edit?tool=object-replacement');
	await uploadInputs(page, await readFile(new URL('../static/icon-192.png', import.meta.url)));

	const panel = page.locator('#edit-tool-panel-object-replacement');
	const select = panel.getByRole('button', { name: 'Выбрать область' });
	await select.click();
	const box = page.getByRole('button', { name: /Выбранная область/ });
	await expect(box).toBeVisible();
	await panel.getByRole('button', { name: 'Очистить область' }).click();
	await expect(box).toHaveCount(0);
	await select.click();
	await box.focus();
	await box.press('ArrowRight');
	await page.getByRole('button', { name: ru['scene.zoomIn'], exact: true }).click();
	await expect(page.getByRole('slider', { name: ru['scene.zoom'], exact: true })).toHaveValue(
		'125'
	);
	const pan = page.getByRole('button', { name: ru['scene.panMode'], exact: true });
	await pan.focus();
	await pan.press('ArrowLeft');
	const regionBeforePan = await box.getAttribute('style');
	const panBounds = await box.boundingBox();
	if (!panBounds) throw new Error('Region box missing before panning');
	await page.mouse.move(panBounds.x + panBounds.width / 2, panBounds.y + panBounds.height / 2);
	await page.mouse.down({ button: 'middle' });
	await page.mouse.move(
		panBounds.x + panBounds.width / 2 + 16,
		panBounds.y + panBounds.height / 2 + 16,
		{ steps: 5 }
	);
	await page.mouse.up({ button: 'middle' });
	await expect(box).toHaveAttribute('style', regionBeforePan!);
	const surface = page.locator('#mode-panel-edit .surface');
	const surfaceBounds = await surface.boundingBox();
	const boxBounds = await box.boundingBox();
	if (!surfaceBounds || !boxBounds) throw new Error('Region selection surface missing');
	await page.mouse.move(boxBounds.x + boxBounds.width / 2, boxBounds.y + boxBounds.height / 2);
	await page.mouse.down();
	await page.mouse.move(
		boxBounds.x + boxBounds.width / 2 + surfaceBounds.width * 0.1,
		boxBounds.y + boxBounds.height / 2,
		{ steps: 5 }
	);
	await page.mouse.up();

	let submittedBody: unknown;
	await page.route('**/api/object-replacement', async (route) => {
		submittedBody = route.request().postDataJSON();
		await route.fulfill({
			status: 202,
			contentType: 'application/json',
			headers: { location: `/api/object-replacement/${JOB_ID}` },
			body: JSON.stringify({
				id: JOB_ID,
				status: 'processing',
				elapsedMs: 0,
				queue: { status: 'unknown' }
			})
		});
	});
	await page.route(`**/api/object-replacement/${JOB_ID}`, async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'retry-after': '30' },
			body: JSON.stringify({
				id: JOB_ID,
				status: 'processing',
				elapsedMs: 0,
				queue: { status: 'unknown' }
			})
		});
	});
	await panel.getByLabel(/Точно опишите существующий объект/).fill('серый диван');
	await panel.getByRole('button', { name: 'Заменить объект' }).click();
	await expect(page).toHaveURL(new RegExp(`job=${JOB_ID}`));
	const expectedRegion = {
		x: expect.closeTo(0.41, 2),
		y: expect.closeTo(0.3, 2),
		width: expect.closeTo(0.4, 2),
		height: expect.closeTo(0.4, 2)
	};
	expect(submittedBody).toMatchObject({
		region: expectedRegion,
		formSnapshot: { objectReplacementRegion: expectedRegion }
	});
});

for (const withSession of [true, false]) {
	test(`restores a completed result after reload without submitting or polling again ${withSession ? 'with a session' : 'from a bare job link'}`, async ({
		page
	}) => {
		await authenticate(page);
		await page.route(`**/api/projects/${E2E_PROJECT_ID}`, async (route) => {
			await route.fulfill({
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
							generations: []
						}
					]
				}
			});
		});
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
					output: media(3, '/api/media/test-media/recovered.webp'),
					cost: 2,
					balance: 18
				})
			});
		});

		await page.route(`**/api/generated-images/${JOB_ID}`, async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					rating: null,
					comment: null,
					id: JOB_ID,
					prompt: 'sofa',
					kind: 'object-replacement',
					createdAt: 1,
					amount: 2,
					balanceAfter: 18,
					image: media(3, '/api/media/test-media/recovered.webp'),
					source: media(1, '/api/media/test-media/scene.webp'),
					formSnapshot: null,
					session: withSession
						? {
								projectId: E2E_PROJECT_ID,
								projectTitle: 'Living room',
								sessionId: E2E_SESSION_ID,
								sessionTitle: 'Main thread'
							}
						: null,
					media: [
						media(3, '/api/media/test-media/recovered.webp'),
						media(1, '/api/media/test-media/scene.webp')
					]
				})
			});
		});
		await page.goto(
			`/edit?tool=object-replacement&object=sofa&job=${JOB_ID}${withSession ? `&project=${E2E_PROJECT_ID}&session=${E2E_SESSION_ID}` : ''}`
		);
		await expect(page.locator('.result:visible img.output')).toHaveAttribute(
			'src',
			'/api/media/test-media/recovered.webp'
		);
		await expect(page).not.toHaveURL(/job=/);
		await expect(page).toHaveURL(new RegExp(`generation=${JOB_ID}`));
		await page.reload();
		await expect(page.locator('.result:visible img.output')).toHaveAttribute(
			'src',
			'/api/media/test-media/recovered.webp'
		);
		expect(getCount).toBe(2);
		expect(postCount).toBe(0);
	});
}

test('keeps the submitted result’s lineage when another render finishes first', async ({
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
				image:
					uploads === 1
						? media(1, '/api/media/test-media/room.webp')
						: media(2, '/api/media/test-media/reference.webp'),
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
				id: `00000000-0000-4000-8000-00000000010${renders}`,
				output:
					renders === 1
						? media(3, '/api/media/test-media/original-result.webp')
						: media(4, '/api/media/test-media/newer-result.webp'),
				cost: 1,
				balance: 19 - renders
			})
		});
	});

	let submittedImage = '';
	let polls = 0;
	await page.route('**/api/object-replacement', async (route) => {
		submittedImage = (route.request().postDataJSON() as { imageKey: string }).imageKey;
		await route.fulfill({
			status: 202,
			contentType: 'application/json',
			body: JSON.stringify({
				id: JOB_ID,
				status: 'processing',
				elapsedMs: 0,
				queue: { status: 'unknown' }
			})
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
					? { id: JOB_ID, status: 'processing', elapsedMs: 0, queue: { status: 'unknown' } }
					: {
							id: JOB_ID,
							status: 'completed',
							output: media(5, '/api/media/test-media/replaced.webp'),
							cost: 2,
							balance: 16
						}
			)
		});
	});

	await page.goto('/create/interior');
	await expect(page.locator('html')).not.toHaveAttribute('data-client-load-state', 'loading');
	// The room/main photo upload is deferred to generate time — picking the
	// file only produces a local preview here, no /api/uploads call yet.
	const renderPanel = page.locator('#mode-panel-render');
	await renderPanel.locator('input[type="file"]').setInputFiles({
		name: 'room.webp',
		mimeType: 'image/webp',
		buffer: Buffer.from('room')
	});
	await expect(renderPanel.getByRole('button', { name: 'Выбрать фото' })).toBeVisible();
	await Promise.all([
		page.waitForResponse((response) => response.url().includes('/api/uploads') && response.ok()),
		page.waitForResponse((response) => response.url().endsWith('/api/render') && response.ok()),
		page.getByRole('button', { name: 'Сгенерировать' }).click()
	]);
	await expect(page.locator('.result:visible img.output')).toHaveAttribute(
		'src',
		'/api/media/test-media/original-result.webp'
	);

	await page.getByRole('tab', { name: 'Редактирование' }).click();
	await page.getByRole('tab', { name: /Замена объекта/ }).click();
	const panel = page.locator('#edit-tool-panel-object-replacement');
	await Promise.all([
		page.waitForResponse((response) => response.url().includes('/api/uploads') && response.ok()),
		panel.locator('input[type="file"]').setInputFiles({
			name: 'reference.webp',
			mimeType: 'image/webp',
			buffer: Buffer.from('reference')
		})
	]);
	await panel.getByLabel(/Точно опишите существующий объект/).fill('gray sofa');
	await panel.getByRole('button', { name: 'Заменить объект' }).click();
	await expect(page).toHaveURL(new RegExp(`job=${JOB_ID}`));

	// The full-screen generation overlay blocks pointer clicks while the object-
	// replacement job is in flight, so drive this interleaving with the keyboard
	// (a focused button's Enter key dispatches a native click, unaffected by the
	// overlay's pointer-events) to still exercise the lineage-priority logic.
	await page.getByRole('tab', { name: 'Создание' }).focus();
	await page.keyboard.press('Enter');
	await page.getByRole('button', { name: 'Сгенерировать' }).focus();
	await page.keyboard.press('Enter');
	await expect(page.locator('.result:visible img.output')).toHaveAttribute(
		'src',
		'/api/media/test-media/newer-result.webp'
	);
	await expect(page.locator('.result:visible img.output')).toHaveAttribute(
		'src',
		'/api/media/test-media/replaced.webp',
		{ timeout: 10_000 }
	);
	await page.getByRole('button', { name: 'Предыдущая генерация' }).click();
	await expect(page.locator('.result:visible img.output')).toHaveAttribute(
		'src',
		'/api/media/test-media/original-result.webp'
	);
	await expect.poll(() => submittedImage).toBe(mediaKey(3));
});

test('surfaces submission credit errors and prevents duplicate starts', async ({ page }) => {
	await authenticate(page);
	await page.goto('/edit?tool=object-replacement');
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

	const panel = page.locator('#edit-tool-panel-object-replacement');
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
	await page.goto('/edit?tool=object-replacement');

	const panel = page.locator('#edit-tool-panel-object-replacement');
	await expect(panel.getByText('Войдите, чтобы запустить генерацию')).toBeVisible();
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
		await page.goto('/edit?tool=object-replacement');
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

		const panel = page.locator('#edit-tool-panel-object-replacement');
		await panel.getByLabel(/Точно опишите существующий объект/).fill('gray sofa');
		await panel.getByRole('button', { name: 'Заменить объект' }).click();
		await expect(panel.getByRole('alert')).toContainText(responseCase.message);
	});
}

test('shows only the queue position while a restored job waits, then its progress once it runs', async ({
	page
}) => {
	await authenticate(page);
	await page.route('**/api/generation-estimates', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				estimates: [{ kind: 'object-replacement', provider: 'comfyui', seconds: 60 }]
			})
		});
	});
	let polls = 0;
	await page.route(`**/api/object-replacement/${JOB_ID}`, async (route) => {
		polls += 1;
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'retry-after': polls === 1 ? '1' : '30' },
			body: JSON.stringify({
				id: JOB_ID,
				status: 'processing',
				elapsedMs: 30_000,
				queue: polls === 1 ? { status: 'waiting', ahead: 2 } : { status: 'running' }
			})
		});
	});

	await page.goto(`/edit?tool=object-replacement&job=${JOB_ID}`);

	const progress = page.getByRole('progressbar', { name: ru['generationOverlay.progressLabel'] });
	await expect(page.getByText('Перед вами в очереди: 2')).toBeVisible();
	await expect(progress).toHaveCount(0);
	await expect(page.getByText(/^Осталось примерно/)).toHaveCount(0);

	await expect(progress).toBeVisible();
	await expect(page.getByText('Перед вами в очереди: 2')).toHaveCount(0);
	expect(Number(await progress.getAttribute('aria-valuenow'))).toBeLessThan(10);
	await expect(page.getByText(/^Осталось примерно \d+\sс$/)).toBeVisible();
	await expect(page.getByText(ru['generationOverlay.objectReplacementDetail'])).toHaveCount(0);
});

test('finishes the progress at 100% when a job completes ahead of its estimate', async ({
	page
}) => {
	await authenticate(page);
	await page.route('**/api/generation-estimates', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				estimates: [{ kind: 'object-replacement', provider: 'comfyui', seconds: 600 }]
			})
		});
	});
	let polls = 0;
	await page.route(`**/api/object-replacement/${JOB_ID}`, async (route) => {
		polls += 1;
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'retry-after': '1' },
			body: JSON.stringify(
				polls === 1
					? { id: JOB_ID, status: 'processing', elapsedMs: 10_000, queue: { status: 'unknown' } }
					: {
							id: JOB_ID,
							status: 'completed',
							output: media(3, '/api/media/test-media/replaced.webp'),
							cost: 2,
							balance: 18
						}
			)
		});
	});

	await page.goto(`/edit?tool=object-replacement&job=${JOB_ID}`);

	const progress = page.getByRole('progressbar', { name: ru['generationOverlay.progressLabel'] });
	await expect(progress).toBeVisible();
	await expect(progress).toHaveAttribute('aria-valuenow', '100');
	await expect(page.getByText(ru['generationOverlay.done'], { exact: true })).toBeVisible();
	await expect(progress).toBeHidden();
	await expect(page.locator('.result:visible img.output')).toHaveAttribute(
		'src',
		'/api/media/test-media/replaced.webp'
	);
});

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

	await page.goto(`/edit?tool=object-replacement&job=${JOB_ID}`);
	await expect(
		page.locator('#edit-tool-panel-object-replacement').getByRole('alert')
	).toContainText('Не удалось найти эту задачу замены объекта');
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

	await page.goto(`/edit?tool=object-replacement&job=${JOB_ID}`);
	await expect(
		page.locator('#edit-tool-panel-object-replacement').getByRole('alert')
	).toContainText('Не удалось заменить объект');
});

test('does not navigate back when an accepted submission finishes after a mode switch', async ({
	page
}) => {
	await authenticate(page);
	await page.goto('/edit?tool=object-replacement');
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
			body: JSON.stringify({
				id: JOB_ID,
				status: 'processing',
				elapsedMs: 0,
				queue: { status: 'unknown' }
			})
		});
	});
	await page.route(`**/api/object-replacement/${JOB_ID}`, async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'retry-after': '30' },
			body: JSON.stringify({
				id: JOB_ID,
				status: 'processing',
				elapsedMs: 0,
				queue: { status: 'unknown' }
			})
		});
	});

	const panel = page.locator('#edit-tool-panel-object-replacement');
	await panel.getByLabel(/Точно опишите существующий объект/).fill('gray sofa');
	await panel.getByRole('button', { name: 'Заменить объект' }).click();
	await expect.poll(() => postCount).toBe(1);
	// The full-screen generation overlay blocks pointer clicks while the
	// submission is in flight, so drive the mode switch with the keyboard (a
	// focused button's Enter key dispatches a native click, unaffected by the
	// overlay's pointer-events) to still exercise the beforeNavigate guard.
	await page.getByRole('tab', { name: 'Редактирование' }).focus();
	await page.keyboard.press('Enter');
	releaseResponse?.();
	// The submission above lazily provisioned a project/session (see
	// mockProjectSessionRoutes) — the mode switch carries that forward instead
	// of dropping it (see buildWorkspaceUrl in url-state.ts).
	await expect(page).toHaveURL(
		new RegExp(`/edit\\?tool=add-object&project=${E2E_PROJECT_ID}&session=${E2E_SESSION_ID}$`)
	);
	await expect(page).not.toHaveURL(/tool=object-replacement/);
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

	await page.goto(`/edit?tool=object-replacement&object=sofa&job=${JOB_ID}`);
	const panel = page.locator('#edit-tool-panel-object-replacement');
	await expect(panel.getByRole('alert')).toContainText('Время ожидания замены истекло');
	await panel.getByRole('button', { name: 'Попробовать снова' }).click();
	await expect(page).not.toHaveURL(/job=/);
	await expect(panel.getByLabel(/Точно опишите существующий объект/)).toBeEnabled();
});

test('repeats object replacement directly and retries a failed second submission without reviving its completed job', async ({
	page
}) => {
	await authenticate(page);
	await page.goto('/edit?tool=object-replacement');
	await uploadInputs(page);
	const requests: { imageKey: string; referenceImageKey: string; replacementObject: string }[] = [];
	const polls: string[] = [];
	const secondJobId = '123e4567-e89b-42d3-a456-426614174001';
	await page.route('**/api/object-replacement', async (route) => {
		requests.push(route.request().postDataJSON());
		if (requests.length === 2) {
			await route.fulfill({ status: 503, json: { error: { code: 'object_replacement_failed' } } });
			return;
		}
		const id = requests.length === 1 ? JOB_ID : secondJobId;
		await route.fulfill({
			status: 202,
			json: { id, status: 'processing', elapsedMs: 0, queue: { status: 'unknown' } }
		});
	});
	await page.route('**/api/object-replacement/*', async (route) => {
		const id = route.request().url().split('/').at(-1)!;
		polls.push(id);
		await route.fulfill({
			status: 200,
			json: {
				id,
				status: 'completed',
				output: media(id === JOB_ID ? 3 : 4, `/api/media/test-media/${id}.webp`),
				cost: 2,
				balance: 16
			}
		});
	});
	const panel = page.locator('#edit-tool-panel-object-replacement');
	const description = panel.getByLabel(/Точно опишите существующий объект/);
	const apply = panel.getByRole('button', { name: ru['objectReplacement.apply'], exact: true });
	await description.fill('серый диван');
	await apply.click();
	await expect(page.locator('.result:visible img.output')).toHaveAttribute(
		'src',
		`/api/media/test-media/${JOB_ID}.webp`
	);
	await expect(page).not.toHaveURL(/job=/);
	await expect(description).toHaveValue('серый диван');
	await expect(panel.getByRole('button', { name: 'Новая замена' })).toHaveCount(0);
	await expect(apply).toBeEnabled();
	await expect(panel.getByText('Замена объекта завершена.', { exact: true })).toHaveCount(0);
	await description.fill('кресло у окна');
	await apply.click();
	await expect(panel.getByRole('alert')).toBeVisible();
	await expect(apply).toBeEnabled();
	await expect(page).not.toHaveURL(/job=/);
	expect(requests).toHaveLength(2);
	expect(polls).toEqual([JOB_ID]);
	await apply.click();
	await expect(page.locator('.result:visible img.output')).toHaveAttribute(
		'src',
		`/api/media/test-media/${secondJobId}.webp`
	);
	await expect(apply).toBeEnabled();
	await expect(panel.getByText('Замена объекта завершена.', { exact: true })).toHaveCount(0);
	expect(requests).toHaveLength(3);
	expect(requests[1]).toMatchObject({
		imageKey: mediaKey(3),
		referenceImageKey: mediaKey(2),
		replacementObject: 'кресло у окна'
	});
	expect(requests[2]).toMatchObject(requests[1]);
	expect(polls).toEqual([JOB_ID, secondJobId]);
});
