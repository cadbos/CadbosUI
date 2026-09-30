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
import { mockResourceDetail } from './helpers/resource-routes';

const PROJECT_ID = '00000000-0000-4000-8000-000000000a00';
const SESSION_ID = '00000000-0000-4000-8000-000000000a01';
const OPENABLE_ID = '00000000-0000-4000-8000-000000000a02';
const ARCHIVED_ID = '00000000-0000-4000-8000-000000000a03';
const LEGACY_ID = '00000000-0000-4000-8000-000000000a04';

const chair = media(1, '/api/media/test-media/chair.png');
const room = media(2, '/api/media/test-media/room.jpg');
const replaced = media(3, '/api/media/test-media/replaced.webp');
const archivedResult = media(4, '/api/media/test-media/archived.webp');
const legacyResult = media(5, '/api/media/test-media/legacy.webp');

const SESSION = {
	projectId: PROJECT_ID,
	projectTitle: 'Living room',
	sessionId: SESSION_ID,
	sessionTitle: 'Main thread'
};

async function authenticate(page: Page): Promise<void> {
	await page.route('**/auth/me', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				user: { pubkey: '0'.repeat(64), firstName: 'Ada', lastName: 'Lovelace' }
			})
		})
	);
	await page.route('**/auth/nostr-profile', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ profile: { relays: [] } })
		})
	);
	await page.route('**/api/generated-images?**', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ images: [], pagination: { offset: 0, size: 100, hasMore: false } })
		})
	);
}

async function mockChairResource(page: Page): Promise<void> {
	await page.route('**/api/resources?**', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				images: [{ image: chair, createdAt: 2000, roles: ['object-reference'] }],
				pagination: { offset: 0, size: 30, hasMore: false }
			})
		})
	);
	await mockResourceDetail(page, {
		image: chair,
		roles: ['object-reference'],
		generations: [
			{
				id: OPENABLE_ID,
				kind: 'object-replacement',
				createdAt: 2000,
				image: replaced,
				roles: ['object-reference'],
				session: SESSION,
				settingsSaved: true
			},
			{
				id: LEGACY_ID,
				kind: 'object-replacement',
				createdAt: 1500,
				image: legacyResult,
				roles: ['object-reference'],
				session: SESSION,
				settingsSaved: false
			},
			{
				id: ARCHIVED_ID,
				kind: 'object-replacement',
				createdAt: 1000,
				image: archivedResult,
				roles: ['object-reference'],
				session: null,
				settingsSaved: true
			}
		]
	});
}

async function mockGenerationDetail(page: Page): Promise<void> {
	await page.route(`**/api/generated-images/${OPENABLE_ID}`, (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				id: OPENABLE_ID,
				prompt: 'серый диван',
				kind: 'object-replacement',
				createdAt: 2000,
				amount: 2,
				balanceAfter: 18,
				image: replaced,
				source: room,
				formSnapshot: null,
				session: SESSION,
				media: [replaced, room, chair]
			})
		})
	);
}

test('a reference opens its page, listing every generation it took part in', async ({ page }) => {
	await authenticate(page);
	await mockChairResource(page);

	await page.goto('/resources');
	await page.getByRole('link', { name: 'Открыть ресурс 1' }).click();

	await expect(page).toHaveURL(`/resources/${encodeURIComponent(chair.key)}`);
	await expect(page.getByRole('img', { name: 'Изображение ресурса' })).toHaveAttribute(
		'src',
		chair.url
	);
	await expect(page.getByRole('list', { name: 'Как использовалось' })).toHaveText(
		'Референс объекта'
	);
	// Only a source photo can start a fresh generation.
	await expect(
		page.getByRole('button', { name: 'Начать новую генерацию с этим фото' })
	).toHaveCount(0);

	const generations = page.getByRole('list', {
		name: 'Генерации с этим изображением, сначала новые'
	});
	const cards = generations.getByRole('listitem');
	await expect(cards).toHaveCount(3);
	await expect(cards.nth(0)).toContainText('Замена объекта');
	await expect(cards.nth(0)).toContainText('Living room · Main thread');
	await expect(
		cards.nth(0).getByRole('button', { name: 'Открыть генерацию 1 в рабочей области' })
	).toBeVisible();
	// One made before form settings were saved couldn't bring its reference
	// or settings back, so it isn't offered for restoring either.
	await expect(cards.nth(1)).toContainText('Living room · Main thread');
	await expect(cards.nth(1)).toContainText(
		'Создано до того, как настройки стали сохраняться, — восстановить нельзя'
	);
	await expect(cards.nth(1).getByRole('button')).toHaveCount(0);
	// A generation whose project/session was archived has nothing to open into.
	await expect(cards.nth(2)).toContainText('Проект или сессия удалены');
	await expect(cards.nth(2).getByRole('button')).toHaveCount(0);
});

test('opening a generation restores it in the workspace, on the tool that made it', async ({
	page
}) => {
	await authenticate(page);
	await mockChairResource(page);
	await mockGenerationDetail(page);

	await page.goto(`/resources/${encodeURIComponent(chair.key)}`);
	await page.getByRole('button', { name: 'Открыть генерацию 1 в рабочей области' }).click();

	await expect(page).toHaveURL(/\/edit\?tool=object-replacement/);
	await expect(page).toHaveURL(new RegExp(`project=${PROJECT_ID}`));
	await expect(page).toHaveURL(new RegExp(`session=${SESSION_ID}`));
	await expect(page).toHaveURL(new RegExp(`generation=${OPENABLE_ID}`));
	await expect(
		page.locator('#mode-panel-edit').getByRole('img', { name: 'Сгенерировать' })
	).toHaveAttribute('src', replaced.url);
	const tabs = page.getByRole('navigation', { name: 'Открытые проекты' });
	await expect(tabs.getByRole('tab', { name: 'Living room', selected: true })).toBeVisible();
});

test('a generation that can no longer be opened says so and stays on the page', async ({
	page
}) => {
	await authenticate(page);
	await mockChairResource(page);
	await page.route(`**/api/generated-images/${OPENABLE_ID}`, (route) =>
		route.fulfill({
			status: 404,
			contentType: 'application/json',
			body: JSON.stringify({
				error: { code: 'generation_not_found', message: 'Generation not found' }
			})
		})
	);

	await page.goto(`/resources/${encodeURIComponent(chair.key)}`);
	await page.getByRole('button', { name: 'Открыть генерацию 1 в рабочей области' }).click();

	await expect(page.getByRole('alert')).toHaveText(
		'Не удалось открыть генерацию. Попробуйте ещё раз.'
	);
	await expect(page).toHaveURL(`/resources/${encodeURIComponent(chair.key)}`);
});

test('an image that isn’t one of your resources shows as not found', async ({ page }) => {
	await authenticate(page);
	await page.route('**/api/resources/**', (route) =>
		route.fulfill({
			status: 404,
			contentType: 'application/json',
			body: JSON.stringify({ error: { code: 'resource_not_found', message: 'Not found' } })
		})
	);

	await page.goto(`/resources/${encodeURIComponent('test-media/someone-else.jpg')}`);

	await expect(page.getByText('Ресурс не найден.')).toBeVisible();
});
