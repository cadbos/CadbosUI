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

import type { Locator, Page } from '@playwright/test';
import { npubEncode } from 'nostr-tools/nip19';
import type { UsageGenerationsResponse, UserUsageDetailResponse } from '$lib/api/contract';
import { ru } from '$lib/i18n/locales/ru';

import { mockFeaturebase } from './featurebase';
import { expect, test } from './fixtures';

const PUBKEY = 'c'.repeat(64);
const NPUB = npubEncode(PUBKEY);
// Moscow has no DST, so the local day 2026-01-03 is exactly [Jan 2 21:00, Jan 3 21:00) UTC.
const DAY_FROM = Date.UTC(2026, 0, 2, 21);
const DAY_TO = Date.UTC(2026, 0, 3, 21);
const HOUR = 60 * 60 * 1000;
const LONG_PROMPT = `scandinavian living room with ${'warm oak floors and linen curtains, '.repeat(12)}soft light`;

test.use({ timezoneId: 'Europe/Moscow', viewport: { width: 1400, height: 900 } });

function detail(generationCount: number): UserUsageDetailResponse {
	return {
		user: {
			pubkey: PUBKEY,
			balance: 42.5,
			totalDeposit: 100,
			lastDepositAt: null,
			projectCount: 3,
			sessionCount: 4,
			generationCount,
			sourceCount: 1,
			sourceBytes: null,
			referenceCount: 1,
			referenceBytes: null,
			totalSpend: 57.5,
			latestSpendAt: DAY_FROM + 12 * HOUR
		},
		generationKinds: [
			{ kind: 'render', count: generationCount - 1 },
			{ kind: 'style-transfer', count: 1 }
		]
	};
}

const GENERATIONS: UsageGenerationsResponse = {
	generations: [
		{
			id: 'generation-2',
			kind: 'style-transfer',
			createdAt: DAY_FROM + 13 * HOUR,
			prompt: LONG_PROMPT,
			source: { key: 'uploads/source.webp', url: '/api/media/uploads/source.webp' },
			result: { key: 'uploads/result-2.webp', url: '/api/media/uploads/result-2.webp' },
			reference: { key: 'uploads/reference.webp', url: '/api/media/uploads/reference.webp' }
		},
		{
			id: 'generation-1',
			kind: 'render',
			createdAt: DAY_FROM + 12 * HOUR,
			prompt: 'cozy bedroom',
			source: { key: 'uploads/source.webp', url: '/api/media/uploads/source.webp' },
			result: { key: 'uploads/result-1.webp', url: '/api/media/uploads/result-1.webp' },
			reference: null
		}
	],
	pagination: { offset: 0, size: 20, hasMore: false }
};

// Every /api/usage request the page made, in order.
async function mockUsage(page: Page): Promise<URL[]> {
	const requests: URL[] = [];
	await page.route('**/auth/me', async (route) => {
		await route.fulfill({
			json: {
				user: { pubkey: '0'.repeat(64), firstName: 'Ada', lastName: 'Lovelace' },
				featurebaseJwt: null
			}
		});
	});
	await page.route('**/auth/nostr-profile', async (route) => {
		await route.fulfill({ json: { profile: { relays: [] } } });
	});
	await page.route('**/api/media/**', async (route) => {
		await route.fulfill({
			contentType: 'image/svg+xml',
			body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#c96"/></svg>'
		});
	});
	await page.route('**/api/usage/**', async (route) => {
		const url = new URL(route.request().url());
		requests.push(url);
		if (url.pathname === '/api/usage/profiles') {
			return route.fulfill({ json: { profiles: { [PUBKEY]: { name: 'Carol' } } } });
		}
		if (url.pathname === `/api/usage/users/${PUBKEY}`) {
			return route.fulfill({ json: detail(url.searchParams.has('from') ? 2 : 5) });
		}
		if (url.pathname === `/api/usage/users/${PUBKEY}/generations`) {
			return route.fulfill({ json: GENERATIONS });
		}
		return route.fulfill({ status: 403 });
	});
	return requests;
}

function requested(requests: URL[], pathname: string): string[] {
	return requests.filter((url) => url.pathname === pathname).map((url) => url.search);
}

async function box(
	locator: Locator
): Promise<{ x: number; y: number; width: number; height: number }> {
	const result = await locator.boundingBox();
	if (!result) throw new Error('element is not rendered');
	return result;
}

test.beforeEach(async ({ page }) => {
	await mockFeaturebase(page);
});

test("shows the user's figures as tiles and the rest side by side", async ({ page }) => {
	const requests = await mockUsage(page);

	await page.goto(`/usage/by-user?npub=${NPUB}`);

	const totals = page.getByRole('region', {
		name: ru['usage.byUser.totalsTitle'].replace('{user}', NPUB)
	});
	await expect(totals).toContainText(`${ru['usage.column.balance']} $ 42.50`);
	await expect(totals).toContainText(`${ru['usage.totals.deposits']} $ 100.00`);
	await expect(totals).toContainText(`${ru['usage.totals.spend']} $ 57.50`);
	await expect(totals).toContainText(`${ru['usage.totals.generations']} 5`);
	for (const platformOnly of [
		ru['usage.totals.users'],
		ru['usage.totals.walletBalance'],
		ru['usage.totals.title']
	]) {
		await expect(page.getByText(platformOnly)).toHaveCount(0);
	}

	const summary = page.getByRole('table', { name: ru['usage.byUser.summary'] });
	await expect(summary.getByRole('row')).toHaveCount(3);
	await expect(
		summary.getByRole('link', { name: ru['usage.user.profileLink'].replace('{user}', 'Carol') })
	).toHaveAttribute('href', `https://primal.net/profile/${NPUB}`);
	const userRow = summary.getByRole('row', { name: new RegExp(ru['usage.column.user']) });
	const userCell = await box(userRow.getByRole('cell'));
	const identity = await box(userRow.getByRole('cell').locator('.user-identity'));
	expect(Math.abs(userCell.x + userCell.width - (identity.x + identity.width))).toBeLessThan(16);

	const kinds = page.getByRole('region', { name: ru['usage.kinds.title'] });
	await expect(
		kinds.getByRole('row', { name: `${ru['generatedImages.kind.render']} 4` })
	).toBeVisible();
	const summarySection = await box(page.getByRole('region', { name: ru['usage.byUser.summary'] }));
	const kindsSection = await box(kinds);
	expect(Math.abs(summarySection.y - kindsSection.y)).toBeLessThan(1);
	expect(Math.abs(summarySection.width - kindsSection.width)).toBeLessThan(1);
	expect(kindsSection.x).toBeGreaterThan(summarySection.x + summarySection.width);
	// The table spans its column, inside the wrapper's 1px borders.
	expect(summarySection.width - (await box(summary)).width).toBeLessThanOrEqual(2);

	await expect(page.getByRole('region', { name: ru['usage.generations.title'] })).toHaveCount(0);
	expect(requested(requests, `/api/usage/users/${PUBKEY}`)).toEqual(['']);
	expect(requests.map((url) => url.pathname)).not.toContain('/api/usage/totals');
});

test("shows the day's figures and generations and reloads when the query changes", async ({
	page,
	context
}) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	const requests = await mockUsage(page);

	await page.goto(`/usage/by-user?npub=${NPUB}&date=2026-01-03`);

	const dayTotals = page.getByRole('region', {
		name: ru['usage.byUser.dayTotalsTitle']
			.replace('{user}', NPUB)
			.replace('{date}', '3 января 2026 г.')
	});
	await expect(dayTotals).toContainText(`${ru['usage.totals.generations']} 2`);
	const range = `?from=${DAY_FROM}&to=${DAY_TO}`;
	expect(requested(requests, `/api/usage/users/${PUBKEY}`)).toEqual([range]);

	const generations = page.getByRole('region', { name: ru['usage.generations.title'] });
	const table = generations.getByRole('table');
	for (const column of ['id', 'time', 'kind', 'prompt', 'source', 'result', 'reference'] as const) {
		await expect(
			table.getByRole('columnheader', {
				name: ru[`usage.generations.column.${column}`],
				exact: true
			})
		).toBeVisible();
	}
	expect((await box(generations)).width - (await box(table)).width).toBeLessThanOrEqual(2);
	const longRow = table.getByRole('row', { name: /generation-2/ });
	const shortRow = table.getByRole('row', { name: /generation-1/ });
	await expect(longRow).toContainText('13:00:00');
	// The last row drops its bottom border, half a pixel under border-collapse.
	expect(Math.abs((await box(longRow)).height - (await box(shortRow)).height)).toBeLessThanOrEqual(
		0.5
	);
	await expect(
		longRow.getByRole('link', {
			name: ru['usage.generations.resultAlt'].replace('{id}', 'generation-2')
		})
	).toHaveAttribute('href', '/api/media/uploads/result-2.webp');
	await expect(shortRow.getByRole('cell').last()).toHaveText(ru['usage.emptyValue']);
	expect(requested(requests, `/api/usage/users/${PUBKEY}/generations`)).toEqual([
		`${range}&offset=0&size=20`
	]);

	await expect(
		shortRow.getByRole('button', {
			name: ru['usage.generations.promptShow'].replace('{id}', 'generation-1')
		})
	).toHaveCount(0);
	const showPrompt = longRow.getByRole('button', {
		name: ru['usage.generations.promptShow'].replace('{id}', 'generation-2')
	});
	await showPrompt.click();
	const popover = page.locator('#usage-prompt-generation-2');
	await expect(popover).toBeVisible();
	await expect(popover).toContainText(LONG_PROMPT);
	const trigger = await box(showPrompt);
	const bubble = await box(popover);
	expect(bubble.y).toBeGreaterThan(trigger.y + trigger.height);
	expect(bubble.y - (trigger.y + trigger.height)).toBeLessThan(16);
	await popover.getByRole('button', { name: ru['usage.generations.promptCopy'] }).click();
	await expect(
		popover.getByRole('button', { name: ru['usage.generations.promptCopied'] })
	).toBeVisible();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(LONG_PROMPT);
	await page.keyboard.press('Escape');
	await expect(popover).toBeHidden();

	await page.getByRole('link', { name: ru['usage.byUser.allTime'] }).click();

	await expect(page).toHaveURL(`/usage/by-user?npub=${NPUB}`);
	await expect(generations).toHaveCount(0);
	await expect(
		page.getByRole('region', { name: ru['usage.byUser.totalsTitle'].replace('{user}', NPUB) })
	).toContainText(`${ru['usage.totals.generations']} 5`);
	expect(requested(requests, `/api/usage/users/${PUBKEY}`).at(-1)).toBe('');
});

test('opens the user and their spend day from the usage table', async ({ page }) => {
	await mockUsage(page);
	await page.route('**/api/usage?*', async (route) => {
		await route.fulfill({
			json: { users: [detail(5).user], pagination: { offset: 0, size: 20, hasMore: false } }
		});
	});

	await page.goto('/usage');
	await page.getByRole('link', { name: `…${NPUB.slice(-5)}`, exact: true }).click();
	await expect(page).toHaveURL(`/usage/by-user?npub=${NPUB}`);

	await page.goBack();
	await page.getByRole('link', { name: '3 янв. 2026 г.', exact: true }).click();
	await expect(page).toHaveURL(`/usage/by-user?npub=${NPUB}&date=2026-01-03`);
	await expect(page.getByRole('region', { name: ru['usage.generations.title'] })).toBeVisible();
});

test('rejects an invalid key or date', async ({ page }) => {
	await mockUsage(page);

	await page.goto('/usage/by-user?npub=npub1invalid');
	await expect(page.getByRole('alert')).toHaveText(ru['usage.byUser.invalidNpub']);

	await page.goto(`/usage/by-user?npub=${NPUB}&date=2026-02-30`);
	await expect(page.getByRole('alert')).toHaveText(ru['usage.byUser.invalidDate']);
});
