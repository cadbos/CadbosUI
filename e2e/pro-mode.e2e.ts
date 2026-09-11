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

import { expect, test } from './fixtures';
import { media, mediaKey } from './helpers/media';
import { E2E_SESSION_ID, mockProjectSessionRoutes } from './helpers/project-session-routes';

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
	await mockProjectSessionRoutes(page);
}

test('submits with only a scene image and promotes the completed result', async ({ page }) => {
	await authenticate(page);
	await page.route('**/api/uploads', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				image: media(1, 'https://cdn.example.test/scene.webp'),
				mime: 'image/webp',
				size: 1024,
				dimensions: [800, 600]
			})
		});
	});

	await page.goto('/edit?tool=pro-mode');
	const panel = page.locator('#edit-tool-panel-pro-mode');
	await panel
		.getByLabel(/Опишите точно, что нужно изменить/)
		.fill('замени розовый диван на голубой');

	let submittedBody: unknown;
	let polls = 0;
	await page.route('**/api/pro-mode', async (route) => {
		submittedBody = route.request().postDataJSON();
		await route.fulfill({
			status: 202,
			contentType: 'application/json',
			headers: { location: `/api/pro-mode/${JOB_ID}` },
			body: JSON.stringify({ id: JOB_ID, status: 'processing' })
		});
	});
	await page.route(`**/api/pro-mode/${JOB_ID}`, async (route) => {
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
				output: media(2, 'https://cdn.example.test/edited.webp'),
				cost: 2,
				balance: 18
			})
		});
	});

	// The room/main photo upload is deferred to submit time — pick it locally
	// (wait for the local preview to confirm it registered), then submit
	// without ever touching the optional reference upload.
	await page
		.locator('#mode-panel-edit input[type="file"]')
		.first()
		.setInputFiles({
			name: 'scene.webp',
			mimeType: 'image/webp',
			buffer: Buffer.from('scene')
		});
	await expect(page.getByRole('button', { name: 'Изменить фото' })).toBeVisible();
	await panel.getByRole('button', { name: 'Применить про режим' }).click();

	await expect(page).toHaveURL(new RegExp(`job=${JOB_ID}`));
	await expect(page.locator('.result img.output')).toHaveAttribute(
		'src',
		'https://cdn.example.test/edited.webp',
		{ timeout: 10_000 }
	);
	await expect(panel.locator('.job-success')).toHaveText('Редактирование в про режиме завершено.');
	await expect.poll(() => polls).toBe(2);
	expect(submittedBody).toEqual({
		imageKey: mediaKey(1),
		prompt: 'замени розовый диван на голубой',
		speedVsQuality: 0.5,
		sessionId: E2E_SESSION_ID
	});
});

test('includes the reference image key only when one is uploaded', async ({ page }) => {
	await authenticate(page);
	await page.route('**/api/uploads', async (route) => {
		const body = route.request().postDataBuffer();
		if (body === null) throw new Error('Upload request body is missing');
		const isScene = body.includes(Buffer.from('scene'));
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				image: isScene
					? media(1, 'https://cdn.example.test/scene.webp')
					: media(2, 'https://cdn.example.test/reference.webp'),
				mime: 'image/webp',
				size: 1024,
				dimensions: [800, 600]
			})
		});
	});

	await page.goto('/edit?tool=pro-mode');
	const panel = page.locator('#edit-tool-panel-pro-mode');
	const inputs = page.locator('#mode-panel-edit input[type="file"]');
	await inputs.nth(0).setInputFiles({
		name: 'scene.webp',
		mimeType: 'image/webp',
		buffer: Buffer.from('scene')
	});
	await expect(page.getByRole('button', { name: 'Изменить фото' })).toBeVisible();
	await Promise.all([
		page.waitForResponse((response) => response.url().includes('/api/uploads') && response.ok()),
		inputs.nth(1).setInputFiles({
			name: 'reference.webp',
			mimeType: 'image/webp',
			buffer: Buffer.from('reference')
		})
	]);
	await panel
		.getByLabel(/Опишите точно, что нужно изменить/)
		.fill('замени диван на диван с Изображения 2');

	let submittedBody: unknown;
	await page.route('**/api/pro-mode', async (route) => {
		submittedBody = route.request().postDataJSON();
		await route.fulfill({
			status: 202,
			contentType: 'application/json',
			body: JSON.stringify({ id: JOB_ID, status: 'processing' })
		});
	});
	await page.route(`**/api/pro-mode/${JOB_ID}`, async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'retry-after': '30' },
			body: JSON.stringify({ id: JOB_ID, status: 'processing' })
		});
	});

	await panel.getByRole('button', { name: 'Применить про режим' }).click();
	await expect(page).toHaveURL(new RegExp(`job=${JOB_ID}`));
	expect(submittedBody).toEqual({
		imageKey: mediaKey(1),
		referenceImageKey: mediaKey(2),
		prompt: 'замени диван на диван с Изображения 2',
		speedVsQuality: 0.5,
		sessionId: E2E_SESSION_ID
	});
});

test('requires authentication before starting a pro-mode edit', async ({ page }) => {
	await page.route('**/auth/me', async (route) => {
		await route.fulfill({
			status: 401,
			contentType: 'application/json',
			body: JSON.stringify({ error: { code: 'unauthorized', message: 'Authentication required' } })
		});
	});
	await page.goto('/edit?tool=pro-mode');

	const panel = page.locator('#edit-tool-panel-pro-mode');
	await expect(panel.getByText('Войдите, чтобы использовать про режим')).toBeVisible();
	await expect(panel.getByRole('button', { name: 'Применить про режим' })).toBeDisabled();
});
