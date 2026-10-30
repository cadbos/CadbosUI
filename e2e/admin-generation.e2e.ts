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
import type {
	AdminGenerationDetailResponse,
	GenerationKind,
	RequestFormSnapshot
} from '$lib/api/contract';
import { defaultPhotoAdjustments } from '$lib/photo-adjustments';
import { expect, test } from './fixtures';
import { mockFeaturebase } from './featurebase';
import { media } from './helpers/media';

const ID = '00000000-0000-4000-8000-000000000801';
const NEXT_ID = '00000000-0000-4000-8000-000000000802';
const PATH = `/usage/generations/${ID}`;
const SOURCE = media('source', '/api/media/test-media/source.jpg');
const RESULT = media('result', '/api/media/test-media/result.webp');
const REFERENCE = media('reference', '/api/media/test-media/reference.jpg');
const MASK = media('mask', '/api/media/test-media/mask.png');

const SNAPSHOT: RequestFormSnapshot = {
	promptFragments: [{ id: 'one', text: 'Warm lighting', label: 'Lighting', order: 0 }],
	promptOverride: 'Warm oak room',
	autoEnhance: false,
	editPrompt: 'A blue ceiling',
	addObjectInstruction: 'A brass floor lamp',
	removeObjectText: 'The sofa',
	editOperationType: null,
	outputFormat: 'png',
	sceneType: 'exterior',
	styleTransferPrompt: 'Coastal architecture',
	styleTransferStrength: 0.42,
	styleNegativePrompt: 'Avoid plastic',
	styleReferenceImage: { mediaKey: REFERENCE.key },
	objectReplacementObject: 'A velvet chair',
	objectReplacementScale: 1.25,
	objectReplacementRegion: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
	objectReferenceImage: { mediaKey: REFERENCE.key },
	textureReplacementSurface: 'The kitchen floor',
	textureReplacementMasked: true,
	textureReferenceImage: { mediaKey: REFERENCE.key },
	textureMaskImage: { mediaKey: MASK.key },
	textureMaskSourceKey: SOURCE.key,
	lightSettingsPresetIds: ['midday', 'retired-light-preset'],
	lightSettingsInstruction: 'Light the reading corner',
	repaintTarget: 'The north wall',
	repaintColor: '#12ab34',
	repaintRegion: { x: 0.2, y: 0.1, width: 0.4, height: 0.3 },
	photoAdjustments: { ...defaultPhotoAdjustments(), exposure: 37 }
};

function detail(
	kind: GenerationKind = 'render',
	extra: Partial<AdminGenerationDetailResponse> = {}
): AdminGenerationDetailResponse {
	return {
		id: ID,
		kind,
		prompt: 'Исходная инструкция',
		translatedPrompt: 'Original instruction',
		createdAt: Date.UTC(2026, 9, 1),
		image: RESULT,
		source: SOURCE,
		reference: REFERENCE,
		hasReference: true,
		formSnapshot: SNAPSHOT,
		media: [RESULT, SOURCE, REFERENCE, MASK],
		project: { title: 'Customer apartment' },
		session: { title: 'Living room iteration' },
		...extra
	};
}

async function authenticate(page: Page, signedIn = true): Promise<void> {
	await page.route('**/auth/me', (route) =>
		route.fulfill({
			status: signedIn ? 200 : 401,
			json: signedIn
				? {
						user: { pubkey: 'a'.repeat(64), firstName: 'Ada', lastName: 'Lovelace' },
						featurebaseJwt: null
					}
				: { error: { code: 'authentication_required', message: 'Sign in required' } }
		})
	);
	await page.route('**/auth/nostr-profile', (route) =>
		route.fulfill({ json: { profile: { relays: [] } } })
	);
}

async function mockDetail(page: Page, body = detail()): Promise<void> {
	await page.route(`**/api/usage/generations/${body.id}`, (route) => route.fulfill({ json: body }));
}

test.beforeEach(async ({ page }) => {
	await mockFeaturebase(page);
	await authenticate(page);
	await page.addInitScript(() => localStorage.setItem('cadbos.locale.v1', 'en'));
});

test('direct links and reloads show one saved generation, its names, prompt, translation and comparison', async ({
	page
}) => {
	await mockDetail(page);
	const mutations: string[] = [];
	page.on('request', (request) => {
		if (new URL(request.url()).pathname.startsWith('/api/') && request.method() !== 'GET')
			mutations.push(request.url());
	});
	await page.goto(PATH);
	await expect(page.getByText('Customer apartment', { exact: true })).toBeVisible();
	await expect(page.getByText('Living room iteration', { exact: true })).toBeVisible();
	await expect(page.getByText('Исходная инструкция', { exact: true })).toBeVisible();
	await expect(page.getByText('Original instruction', { exact: true })).toBeVisible();
	await expect(page.locator(`img[src="${RESULT.url}"]`).first()).toBeVisible();
	await expect(page.getByRole('textbox')).toHaveCount(0);
	await expect(page.getByRole('button', { name: /generate/i })).toHaveCount(0);
	await page.getByRole('button', { name: 'Compare before/after' }).click();
	const slider = page.getByRole('slider', { name: 'Compare before/after' });
	await expect(slider).toBeVisible();
	await slider.focus();
	await page.keyboard.press('ArrowRight');
	await expect(slider).toHaveAttribute('aria-valuenow', '52');
	await page.getByRole('button', { name: 'Compare before/after' }).click();
	await page.reload();
	await expect(page.getByText('Customer apartment', { exact: true })).toBeVisible();
	expect(mutations).toEqual([]);
});

const cases: { kind: GenerationKind; text: string; snapshot?: Partial<RequestFormSnapshot> }[] = [
	{ kind: 'render', text: 'Warm oak room' },
	{ kind: 'edit', text: 'A blue ceiling', snapshot: { editOperationType: 'freeform' } },
	{ kind: 'edit', text: 'A brass floor lamp', snapshot: { editOperationType: 'add-object' } },
	{ kind: 'edit', text: 'The sofa', snapshot: { editOperationType: 'remove-object' } },
	{ kind: 'style-transfer', text: 'Coastal architecture' },
	{ kind: 'object-replacement', text: 'A velvet chair' },
	{
		kind: 'texture-replacement',
		text: 'The kitchen floor',
		snapshot: { textureReplacementMasked: false }
	},
	{ kind: 'light-settings', text: 'Light the reading corner' },
	{ kind: 'repaint', text: 'The north wall' },
	{ kind: 'photo-processing', text: '37', snapshot: { editOperationType: 'photo-processing' } },
	{ kind: 'upscale', text: 'PNG', snapshot: { editOperationType: 'upscale' } }
];
for (const example of cases) {
	test(`shows saved settings for ${example.kind}/${example.snapshot?.editOperationType ?? 'default'}`, async ({
		page
	}) => {
		await mockDetail(
			page,
			detail(example.kind, {
				translatedPrompt: null,
				formSnapshot: { ...SNAPSHOT, ...example.snapshot }
			})
		);
		await page.goto(PATH);
		await expect(page.getByText(example.text, { exact: true }).first()).toBeVisible();
		if (example.kind === 'style-transfer') {
			await expect(page.getByText('Avoid plastic', { exact: true })).toBeVisible();
			await expect(page.locator(`img[src="${REFERENCE.url}"]`).first()).toBeVisible();
		}
		if (example.kind === 'light-settings')
			await expect(page.getByText(/retired-light-preset/)).toBeVisible();
		if (example.kind === 'repaint' || example.kind === 'object-replacement') {
			await expect(page.locator('.saved-region')).toBeVisible();
		}
	});
}

test('shows the saved texture mask and missing reference images without discarding settings', async ({
	page
}) => {
	await mockDetail(
		page,
		detail('texture-replacement', { media: [RESULT, SOURCE, MASK], reference: null })
	);
	await page.goto(PATH);
	await expect(page.locator(`img[src="${MASK.url}"]`)).toBeVisible();
	await expect(page.getByText(/unavailable/i).first()).toBeVisible();
});

test('keeps the prompt and recorded reference available without a snapshot or project/session', async ({
	page
}) => {
	await mockDetail(page, detail('upscale', { formSnapshot: null, project: null, session: null }));
	await page.goto(PATH);
	await expect(page.getByText('Исходная инструкция', { exact: true })).toBeVisible();
	await expect(page.locator(`img[src="${REFERENCE.url}"]`)).toBeVisible();
	await expect(page.getByText(/unavailable/i).first()).toBeVisible();
});

for (const status of [401, 403, 404, 503]) {
	test(`handles a protected detail response ${status}`, async ({ page }) => {
		await page.route(`**/api/usage/generations/${ID}`, (route) =>
			route.fulfill({ status, json: { error: { code: 'test_error', message: 'Request failed' } } })
		);
		await page.goto(PATH);
		await expect(page.getByText('Customer apartment', { exact: true })).toHaveCount(0);
		await expect(page.getByRole('alert')).toBeVisible();
		if (status === 503) {
			await mockDetail(page);
			await page.getByRole('button', { name: /retry/i }).click();
			await expect(page.getByText('Customer apartment', { exact: true })).toBeVisible();
		}
	});
}

test('clears protected details on logout', async ({ page }) => {
	await mockDetail(page);
	await page.route('**/auth/logout', (route) => route.fulfill({ json: { ok: true } }));
	await page.goto(PATH);
	await expect(page.getByText('Customer apartment', { exact: true })).toBeVisible();
	await page.locator('.auth-trigger').click();
	await page.getByTestId('logout-button').click();
	await expect(page.getByText('Customer apartment', { exact: true })).toHaveCount(0);
});

test('navigating between inspector IDs replaces the result and supports browser back', async ({
	page
}) => {
	await mockDetail(page);
	await mockDetail(
		page,
		detail('render', { id: NEXT_ID, project: { title: 'Another apartment' } })
	);
	await page.goto(PATH);
	await expect(page.getByText('Customer apartment', { exact: true })).toBeVisible();
	await page.evaluate((href) => {
		const link = document.createElement('a');
		link.href = href;
		link.textContent = 'Open another inspector';
		document.body.append(link);
	}, `/usage/generations/${NEXT_ID}`);
	await page.getByRole('link', { name: 'Open another inspector' }).click();
	await expect(page.getByText('Another apartment', { exact: true })).toBeVisible();
	await expect(page.getByText('Customer apartment', { exact: true })).toHaveCount(0);
	await page.goBack();
	await expect(page.getByText('Customer apartment', { exact: true })).toBeVisible();
});

test('localizes the inspector into Russian', async ({ page }) => {
	await page.addInitScript(() => localStorage.setItem('cadbos.locale.v1', 'ru'));
	await mockDetail(page);
	await page.goto(PATH);
	await expect(page.getByText('Customer apartment', { exact: true })).toBeVisible();
	await expect(page.getByRole('heading', { name: /генераци/i }).first()).toBeVisible();
});

test('inspection preserves the admin’s unsaved generation prompt', async ({ page }) => {
	await mockDetail(page);
	await page.route('**/api/generated-images?**', (route) =>
		route.fulfill({ json: { images: [], pagination: { offset: 0, size: 100, hasMore: false } } })
	);
	await page.goto('/create/interior');
	const prompt = page.getByRole('textbox', { name: 'Chat prompt' });
	await prompt.fill('Admin unsaved prompt');
	await page.evaluate((href) => {
		const link = document.createElement('a');
		link.href = href;
		link.textContent = 'Inspect customer generation';
		document.body.append(link);
	}, PATH);
	await page.getByRole('link', { name: 'Inspect customer generation' }).click();
	await expect(page.getByText('Customer apartment', { exact: true })).toBeVisible();
	await page.goBack();
	await expect(page.getByRole('textbox', { name: 'Chat prompt' })).toHaveValue(
		'Admin unsaved prompt'
	);
	await page.getByRole('textbox', { name: 'Chat prompt' }).fill('Admin revised prompt');
	await page.getByRole('link', { name: 'Inspect customer generation' }).click();
	await expect(page.getByText('Customer apartment', { exact: true })).toBeVisible();
	await page.goBack();
	await expect(page.getByRole('textbox', { name: 'Chat prompt' })).toHaveValue(
		'Admin revised prompt'
	);
	await expect(page).toHaveURL(/prompt=Admin(?:\+|%20)revised(?:\+|%20)prompt/);
	await page.reload();
	await expect(page.getByRole('textbox', { name: 'Chat prompt' })).toHaveValue(
		'Admin revised prompt'
	);
});

test('shows an unavailable result/source without hiding saved metadata or instructions', async ({
	page
}) => {
	await mockDetail(
		page,
		detail('render', { image: null, source: null, reference: null, hasReference: false, media: [] })
	);
	await page.goto(PATH);
	await expect(page.getByText('Customer apartment', { exact: true })).toBeVisible();
	await expect(page.getByText('Исходная инструкция', { exact: true })).toBeVisible();
	await expect(page.getByText(/unavailable/i).first()).toBeVisible();
	await expect(page.getByRole('button', { name: /compare/i })).toHaveCount(0);
});

test('does not request protected generation details while signed out', async ({ page }) => {
	await authenticate(page, false);
	const requests: string[] = [];
	await page.route('**/api/usage/generations/**', (route) => {
		requests.push(route.request().url());
		return route.fulfill({
			status: 401,
			json: { error: { code: 'unauthorized', message: 'Authentication required' } }
		});
	});
	await page.goto(PATH);
	await expect(page.getByRole('alert')).toBeVisible();
	expect(requests).toEqual([]);
});

test('reports invalid detail data and allows a fresh retry', async ({ page }) => {
	await page.route(`**/api/usage/generations/${ID}`, (route) =>
		route.fulfill({ json: { id: ID } })
	);
	await page.goto(PATH);
	await expect(page.getByRole('alert')).toBeVisible();
	await mockDetail(page);
	await page.getByRole('button', { name: /retry/i }).click();
	await expect(page.getByText('Customer apartment', { exact: true })).toBeVisible();
});

test('aligns a saved region to the source image’s actual aspect ratio', async ({ page }) => {
	await page.route('**/api/media/test-media/source.jpg', (route) =>
		route.fulfill({
			contentType: 'image/svg+xml',
			body: '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="500"><rect width="1000" height="500" fill="#ddd"/></svg>'
		})
	);
	await mockDetail(page, detail('object-replacement'));
	await page.goto(PATH);
	const overlay = page.locator('.saved-region');
	await expect(overlay).toBeVisible();
	await expect(async () => {
		const boxes = await overlay.evaluate((node) => {
			const parent = node.parentElement;
			if (!parent) throw new Error('region has no image container');
			const image = parent.getBoundingClientRect();
			const region = node.getBoundingClientRect();
			return {
				ratio: image.width / image.height,
				x: (region.x - image.x) / image.width,
				y: (region.y - image.y) / image.height,
				width: region.width / image.width,
				height: region.height / image.height
			};
		});
		expect(boxes.ratio).toBeCloseTo(2, 2);
		expect(boxes.x).toBeCloseTo(0.1, 2);
		expect(boxes.y).toBeCloseTo(0.2, 2);
		expect(boxes.width).toBeCloseTo(0.3, 2);
		expect(boxes.height).toBeCloseTo(0.4, 2);
	}).toPass();
});

test('formats and right-aligns saved quantities consistently in both locales', async ({ page }) => {
	await mockDetail(
		page,
		detail('style-transfer', { formSnapshot: { ...SNAPSHOT, styleTransferStrength: 0.07 } })
	);
	await page.goto(PATH);
	const strength = page.getByText('7%', { exact: true });
	await expect(strength).toBeVisible();
	expect(
		await strength.evaluate((node) => {
			const label = node.previousElementSibling;
			if (!label) throw new Error('numeric value has no label');
			return [getComputedStyle(node).textAlign, getComputedStyle(label).textAlign];
		})
	).toEqual(['right', 'right']);
	await page.evaluate(() => localStorage.setItem('cadbos.locale.v1', 'ru'));
	await page.reload();
	await expect(strength).toBeVisible();
});

test('shows an unavailable image when stored media fails to load', async ({ page }) => {
	await page.route('**/api/media/test-media/result.webp', (route) =>
		route.fulfill({ status: 404, body: '' })
	);
	await mockDetail(page);
	await page.goto(PATH);
	await expect(
		page
			.getByRole('region', { name: 'Result', exact: true })
			.getByText('Image unavailable', { exact: true })
	).toBeVisible();
	await expect(page.getByText('Customer apartment', { exact: true })).toBeVisible();
	await expect(page.getByText('Исходная инструкция', { exact: true })).toBeVisible();
});
