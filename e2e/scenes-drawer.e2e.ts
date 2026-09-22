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
import { media } from './helpers/media';

const GENERATION_ID = '00000000-0000-4000-8000-000000000200';

const FORM_SNAPSHOT = {
	promptFragments: [],
	promptOverride: null,
	editPrompt: '',
	addObjectPresetId: null,
	removeObjectText: '',
	outputFormat: 'webp',
	sceneType: 'interior',
	styleTransferPrompt: 'archived style note',
	styleTransferStrength: 0.42,
	styleNegativePrompt: '',
	styleSourceMode: 'room-photo',
	objectReplacementObject: '',
	objectReplacementSourceMode: 'current-result',
	objectReplacementScale: 1,
	textureReplacementSurface: '',
	textureReplacementSourceMode: 'current-result',
	textureReplacementMasked: false,
	lightSettingsPresetIds: [],
	lightSettingsInstruction: ''
};

async function authenticate(page: Page): Promise<void> {
	await page.route('**/auth/me', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				user: { pubkey: '0'.repeat(64), firstName: 'Ada', lastName: 'Lovelace' }
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
}

async function mockSingleStyleTransferScene(page: Page): Promise<void> {
	await page.route('**/api/generated-images**', async (route) => {
		if (route.request().method() !== 'GET') return route.fallback();
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				images: [
					{
						id: GENERATION_ID,
						image: media(2, 'https://cdn.example.test/result.webp'),
						source: media(1, 'https://cdn.example.test/scene.jpg'),
						kind: 'style-transfer',
						createdAt: Date.UTC(2026, 0, 1)
					}
				],
				pagination: { offset: 0, size: 100, hasMore: false }
			})
		});
	});
	await page.route(`**/api/generated-images/${GENERATION_ID}`, async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				id: GENERATION_ID,
				prompt: '',
				kind: 'style-transfer',
				createdAt: Date.UTC(2026, 0, 1),
				source: media(1, 'https://cdn.example.test/scene.jpg'),
				formSnapshot: FORM_SNAPSHOT,
				media: [media(1, 'https://cdn.example.test/scene.jpg')]
			})
		});
	});
}

test('restores a past generation’s exact settings from the scenes drawer', async ({ page }) => {
	await authenticate(page);
	await mockSingleStyleTransferScene(page);

	await page.goto('/create/interior?view=chat&format=webp');
	await page.getByRole('button', { name: 'Сцены' }).click();
	// The restore button only becomes interactive once its result thumbnail
	// is hovered (see .actions in ScenesDrawer.svelte's styles).
	await page.locator('.image-frame.result-frame').hover();
	await page.getByRole('button', { name: /Восстановить настройки сцены/ }).click();

	// Navigated to the tool the restored generation was made with, with the
	// original source image and the archived settings both in place — not
	// just the image (that much "use result" already did before this
	// feature).
	await expect(page).toHaveURL(/\/style-transfer/);
	await expect(page.locator('.image-wrapper img').first()).toHaveAttribute(
		'src',
		'https://cdn.example.test/scene.jpg'
	);
	await expect(page.getByLabel('Уточнение стиля')).toHaveValue('archived style note');
});

test('asks for confirmation before restoring over unsaved form changes', async ({ page }) => {
	await authenticate(page);
	await mockSingleStyleTransferScene(page);

	await page.goto('/create/interior?view=chat&format=webp');
	// Gives the form something to lose: an uploaded image with no matching
	// confirmed generation behind it yet.
	await page.setInputFiles('input[type="file"]', {
		name: 'room.jpg',
		mimeType: 'image/jpeg',
		buffer: Buffer.from('fake-image-bytes')
	});
	await expect(page.locator('.image-wrapper img').first()).toBeVisible();

	await page.getByRole('button', { name: 'Сцены' }).click();
	await page.locator('.image-frame.result-frame').hover();
	await page.getByRole('button', { name: /Восстановить настройки сцены/ }).click();

	const dialog = page.getByRole('dialog', { name: 'Восстановить настройки?' });
	await expect(dialog).toBeVisible();
	await dialog.getByRole('button', { name: 'Восстановить' }).click();

	await expect(page).toHaveURL(/\/style-transfer/);
	await expect(page.getByLabel('Уточнение стиля')).toHaveValue('archived style note');
});
