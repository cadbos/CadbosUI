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
						: 'https://cdn.example.test/reference-fabric.webp',
				mime: 'image/webp',
				size: 1024,
				dimensions: [800, 600]
			})
		});
	});

	const inputs = page.locator('#mode-panel-edit input[type="file"]');
	await Promise.all([
		page.waitForResponse((response) => response.url().includes('/api/uploads') && response.ok()),
		inputs.nth(0).setInputFiles({
			name: 'scene.webp',
			mimeType: 'image/webp',
			buffer: Buffer.from('scene')
		})
	]);
	await Promise.all([
		page.waitForResponse((response) => response.url().includes('/api/uploads') && response.ok()),
		inputs.nth(1).setInputFiles({
			name: 'fabric.webp',
			mimeType: 'image/webp',
			buffer: Buffer.from('fabric')
		})
	]);
}

test('submits texture inputs and completes inside the nested edit tool', async ({ page }) => {
	await authenticate(page);
	await page.goto('/edit?tool=texture-replacement');
	await uploadInputs(page);

	let submittedBody: unknown;
	await page.route('**/api/texture-replacement', async (route) => {
		submittedBody = route.request().postDataJSON();
		await route.fulfill({
			status: 202,
			contentType: 'application/json',
			body: JSON.stringify({ id: JOB_ID, status: 'processing' })
		});
	});
	await page.route(`**/api/texture-replacement/${JOB_ID}`, async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				id: JOB_ID,
				status: 'completed',
				outputUrl: 'https://cdn.example.test/retextured.webp',
				cost: 2,
				balance: 18
			})
		});
	});

	const panel = page.locator('#edit-tool-panel-texture-replacement');
	await panel.getByLabel(/Укажите поверхность или материал/).fill('  обивка дивана  ');
	await panel.getByRole('button', { name: 'Заменить текстуру' }).click();

	await expect(page).toHaveURL(new RegExp(`tool=texture-replacement.*job=${JOB_ID}`));
	await expect(page.locator('.result img.output')).toHaveAttribute(
		'src',
		'https://cdn.example.test/retextured.webp'
	);
	await expect(panel.locator('.job-success')).toHaveText('Замена текстуры завершена.');
	expect(submittedBody).toEqual({
		image: 'https://cdn.example.test/scene.webp',
		referenceImage: 'https://cdn.example.test/reference-fabric.webp',
		replacementSurface: 'обивка дивана'
	});
});

test('does not navigate back after switching tools during submission', async ({ page }) => {
	await authenticate(page);
	await page.goto('/edit?tool=texture-replacement');
	await uploadInputs(page);

	let releaseResponse: (() => void) | undefined;
	const responseGate = new Promise<void>((resolve) => {
		releaseResponse = resolve;
	});
	let postCount = 0;
	await page.route('**/api/texture-replacement', async (route) => {
		postCount += 1;
		await responseGate;
		await route.fulfill({
			status: 202,
			contentType: 'application/json',
			body: JSON.stringify({ id: JOB_ID, status: 'processing' })
		});
	});
	await page.route(`**/api/texture-replacement/${JOB_ID}`, async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'retry-after': '30' },
			body: JSON.stringify({ id: JOB_ID, status: 'processing' })
		});
	});

	const panel = page.locator('#edit-tool-panel-texture-replacement');
	await panel.getByLabel(/Укажите поверхность или материал/).fill('sofa upholstery');
	await panel.getByRole('button', { name: 'Заменить текстуру' }).click();
	await expect.poll(() => postCount).toBe(1);
	await page.getByRole('tab', { name: 'Свой промпт' }).focus();
	await page.keyboard.press('Enter');
	releaseResponse?.();

	await expect(page).toHaveURL(/\/edit\?tool=freeform$/);
	await expect(page).not.toHaveURL(/tool=texture-replacement/);
});
