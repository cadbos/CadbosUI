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

import type { Page, Route } from '@playwright/test';

import { ru } from '$lib/i18n/locales/ru';
import { expect, test } from './fixtures';
import { media } from './helpers/media';
import {
	E2E_GENERATION_ID,
	E2E_PROJECT_ID,
	E2E_SESSION_ID,
	mockProjectSessionRoutes
} from './helpers/project-session-routes';
import { mockSceneFilterOptions } from './helpers/scene-routes';

const BEFORE_URL = '/api/media/test-media/room.webp';
const AFTER_URL = '/api/media/test-media/render.webp';

const FORM_SNAPSHOT = {
	promptFragments: [],
	promptOverride: 'scandinavian living room',
	editPrompt: '',
	addObjectPresetId: null,
	removeObjectText: '',
	outputFormat: 'webp',
	sceneType: 'interior',
	styleTransferPrompt: '',
	styleTransferStrength: 0.7,
	styleNegativePrompt: '',
	objectReplacementObject: '',
	objectReplacementScale: 1,
	textureReplacementSurface: '',
	textureReplacementMasked: false,
	lightSettingsPresetIds: [],
	lightSettingsInstruction: ''
};

const GENERATION_DETAIL = {
	id: E2E_GENERATION_ID,
	prompt: 'scandinavian living room',
	kind: 'render',
	createdAt: Date.UTC(2026, 0, 1),
	amount: 1.5,
	balanceAfter: 8.5,
	image: media(2, AFTER_URL),
	source: media(1, BEFORE_URL),
	formSnapshot: FORM_SNAPSHOT,
	session: {
		projectId: E2E_PROJECT_ID,
		projectTitle: 'Living room',
		sessionId: E2E_SESSION_ID,
		sessionTitle: 'Main thread'
	},
	media: [media(2, AFTER_URL), media(1, BEFORE_URL)]
};

const PROJECT_DETAIL = {
	id: E2E_PROJECT_ID,
	title: 'Living room',
	createdAt: Date.UTC(2026, 0, 1),
	updatedAt: Date.UTC(2026, 0, 1),
	shareActive: false,
	sessions: [
		{
			id: E2E_SESSION_ID,
			title: 'Main thread',
			parentSessionId: null,
			forkedFromGenerationId: null,
			createdAt: Date.UTC(2026, 0, 1),
			updatedAt: Date.UTC(2026, 0, 1),
			generations: [
				{
					id: E2E_GENERATION_ID,
					image: media(2, AFTER_URL),
					source: media(1, BEFORE_URL),
					kind: 'render',
					createdAt: Date.UTC(2026, 0, 1),
					amount: 1.5,
					balanceAfter: 8.5
				}
			]
		}
	]
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

// `delayMs` stands in for a slow connection; `failing` for a request that
// never reaches the server (an ad blocker, a proxy out of traffic).
interface SessionMockOptions {
	delayMs?: number;
	failing?: () => boolean;
}

async function mockSessionData(page: Page, options: SessionMockOptions = {}): Promise<void> {
	const respond = async (route: Route, body: unknown): Promise<void> => {
		if (options.failing?.()) return route.abort('internetdisconnected');
		if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(body)
		});
	};
	await page.route('**/api/generated-images**', async (route) => {
		if (route.request().method() !== 'GET') return route.fallback();
		const { pathname } = new URL(route.request().url());
		if (pathname.endsWith(`/api/generated-images/${E2E_GENERATION_ID}`)) {
			return respond(route, GENERATION_DETAIL);
		}
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				images: [
					{
						id: E2E_GENERATION_ID,
						image: media(2, AFTER_URL),
						source: media(1, BEFORE_URL),
						kind: 'render',
						createdAt: Date.UTC(2026, 0, 1),
						session: null,
						iteration: null,
						number: 1
					}
				],
				pagination: { offset: 0, size: 100, hasMore: false }
			})
		});
	});
	await mockSceneFilterOptions(page);
	await page.route(`**/api/projects/${E2E_PROJECT_ID}`, async (route) => {
		if (route.request().method() !== 'GET') return route.fallback();
		await respond(route, PROJECT_DETAIL);
	});
}

// The browser's own "Duplicate tab" command can't be triggered from
// Playwright, but what it does to this app is exactly this: a fresh document
// load of the same URL over the same origin storage (localStorage, where the
// open workspace tabs persist) — with nothing of the original tab's memory.
async function duplicateTab(page: Page): Promise<void> {
	await page.goto(page.url());
}

async function waitForClientReady(page: Page): Promise<void> {
	await expect(page.locator('html')).not.toHaveAttribute('data-client-load-state', 'loading');
}

async function expectGenerationOnScreen(page: Page): Promise<void> {
	const renderPanel = page.locator('#mode-panel-render');
	await expect(renderPanel.getByRole('button', { name: ru['toolbar.compare'] })).toBeEnabled();
	await expect(renderPanel.locator('input[type="file"]')).toHaveCount(0);
	await expect(renderPanel.getByRole('img', { name: 'Сгенерировать' })).toHaveAttribute(
		'src',
		AFTER_URL
	);
	await expect(page).toHaveURL(new RegExp(`project=${E2E_PROJECT_ID}`));
	await expect(page).toHaveURL(new RegExp(`session=${E2E_SESSION_ID}`));
	await expect(page).toHaveURL(new RegExp(`generation=${E2E_GENERATION_ID}`));
}

// Uploads a photo and generates from it, provisioning the project/session the
// way a first generation does — the result is E2E_GENERATION_ID.
async function generateFromUpload(page: Page): Promise<void> {
	await authenticate(page);
	await mockSessionData(page);
	await mockProjectSessionRoutes(page);
	await page.route('**/api/uploads', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				image: media(1, BEFORE_URL),
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
			body: JSON.stringify({
				id: E2E_GENERATION_ID,
				output: media(2, AFTER_URL),
				cost: 1.5,
				balance: 8.5
			})
		});
	});

	await page.goto('/create/interior?view=chat&format=webp');
	await waitForClientReady(page);
	await page
		.locator('#mode-panel-render input[type="file"]')
		.setInputFiles({ name: 'room.png', mimeType: 'image/png', buffer: Buffer.from('fake-image') });
	await Promise.all([
		page.waitForResponse((response) => response.url().endsWith('/api/render') && response.ok()),
		page.getByRole('button', { name: 'Сгенерировать' }).click()
	]);
}

test('a duplicated tab reopens the result a fresh generation just produced', async ({ page }) => {
	await generateFromUpload(page);
	await expectGenerationOnScreen(page);

	await duplicateTab(page);

	await expectGenerationOnScreen(page);
});

test('a duplicated tab reopens the original photo when undo went back to it', async ({ page }) => {
	await generateFromUpload(page);
	const renderPanel = page.locator('#mode-panel-render');
	await renderPanel.getByRole('button', { name: ru['toolbar.previousGeneration'] }).click();
	await expect(page).toHaveURL(new RegExp(`generation=${E2E_GENERATION_ID}&step=before`));

	await duplicateTab(page);

	await expect(page).toHaveURL(new RegExp(`generation=${E2E_GENERATION_ID}&step=before`));
	await expect(renderPanel.getByRole('img', { name: 'Сгенерировать' })).toHaveAttribute(
		'src',
		BEFORE_URL
	);
	await renderPanel.getByRole('button', { name: ru['toolbar.nextGeneration'] }).click();
	await expectGenerationOnScreen(page);
	await expect(page).not.toHaveURL(/step=/);
});

test('a scene restored from the scenes drawer survives a duplicated tab, form included', async ({
	page
}) => {
	await authenticate(page);
	await mockSessionData(page);

	await page.goto('/create/interior?view=chat&format=webp');
	await page.getByRole('button', { name: 'Сцены', exact: true }).click();
	await page.locator('.image-frame.result-frame').hover();
	await page.getByRole('button', { name: /Восстановить настройки сцены/ }).click();
	await expectGenerationOnScreen(page);

	await duplicateTab(page);

	await expectGenerationOnScreen(page);
	await expect(page).toHaveURL(/prompt=scandinavian/);
});

test('a session continued from its project page survives a duplicated tab, form included', async ({
	page
}) => {
	await authenticate(page);
	await mockSessionData(page);

	await page.goto(`/projects/${E2E_PROJECT_ID}`);
	await page.getByRole('button', { name: 'Продолжить сессию «Main thread»' }).click();
	await expectGenerationOnScreen(page);
	await expect(page).toHaveURL(/prompt=scandinavian/);

	await duplicateTab(page);

	await expectGenerationOnScreen(page);
	await expect(page).toHaveURL(/prompt=scandinavian/);
});

test('a slow connection never strips the session out of a duplicated tab’s URL', async ({
	page
}) => {
	await authenticate(page);
	await mockSessionData(page, { delayMs: 2500 });
	const url = `/create/interior?view=chat&format=webp&prompt=scandinavian+living+room&project=${E2E_PROJECT_ID}&session=${E2E_SESSION_ID}&generation=${E2E_GENERATION_ID}`;

	await page.goto(url);

	await expect(
		page.getByRole('status').filter({ hasText: ru['workspace.urlTarget.loading'] })
	).toBeVisible();
	// Well past the URL-sync debounce (400ms) while the session is still
	// loading — the address bar must still point at it.
	await page.waitForTimeout(1200);
	await expect(page).toHaveURL(new RegExp(`generation=${E2E_GENERATION_ID}`));

	await expectGenerationOnScreen(page);
	await expect(
		page.getByRole('status').filter({ hasText: ru['workspace.urlTarget.loading'] })
	).toHaveCount(0);
});

test('a blocked connection keeps the link and offers a retry instead of a blank workspace', async ({
	page
}) => {
	let offline = true;
	await authenticate(page);
	await mockSessionData(page, { failing: () => offline });
	const url = `/create/interior?view=chat&format=webp&project=${E2E_PROJECT_ID}&session=${E2E_SESSION_ID}&generation=${E2E_GENERATION_ID}`;

	await page.goto(url);

	const alert = page.getByRole('alert').filter({ hasText: ru['workspace.urlTarget.failed'] });
	await expect(alert).toBeVisible();
	await page.waitForTimeout(1000);
	await expect(page).toHaveURL(new RegExp(`generation=${E2E_GENERATION_ID}`));
	await expect(page.locator('#mode-panel-render')).toBeHidden();

	offline = false;
	await alert.getByRole('button', { name: ru['workspace.urlTarget.retry'] }).click();

	await expect(alert).toHaveCount(0);
	await expectGenerationOnScreen(page);
});
