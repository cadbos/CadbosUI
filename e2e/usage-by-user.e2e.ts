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
import { npubEncode } from 'nostr-tools/nip19';
import type {
	UsageGenerationsResponse,
	UsageTotals,
	UserUsageDetailResponse
} from '$lib/api/contract';
import { ru } from '$lib/i18n/locales/ru';

import { mockFeaturebase } from './featurebase';
import { expect, test } from './fixtures';

const PUBKEY = 'c'.repeat(64);
const NPUB = npubEncode(PUBKEY);
// Moscow has no DST, so the local day 2026-01-03 is exactly [Jan 2 21:00, Jan 3 21:00) UTC.
const DAY_FROM = Date.UTC(2026, 0, 2, 21);
const DAY_TO = Date.UTC(2026, 0, 3, 21);

test.use({ timezoneId: 'Europe/Moscow' });

const TOTALS: UsageTotals = {
	totalDeposit: 2000,
	userCount: 12,
	projectCount: 2,
	sessionCount: 2,
	generationCount: 5,
	sourceCount: 2,
	sourceBytes: null,
	referenceCount: 0,
	referenceBytes: null,
	totalSpend: 1234.5
};

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
			latestSpendAt: DAY_FROM + 12 * 60 * 60 * 1000
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
			createdAt: DAY_FROM + 13 * 60 * 60 * 1000,
			prompt: 'scandinavian living room',
			source: { key: 'uploads/source.webp', url: '/api/media/uploads/source.webp' },
			result: { key: 'uploads/result-2.webp', url: '/api/media/uploads/result-2.webp' },
			reference: { key: 'uploads/reference.webp', url: '/api/media/uploads/reference.webp' }
		},
		{
			id: 'generation-1',
			kind: 'render',
			createdAt: DAY_FROM + 12 * 60 * 60 * 1000,
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
			body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" />'
		});
	});
	await page.route('**/api/usage/**', async (route) => {
		const url = new URL(route.request().url());
		requests.push(url);
		const date = url.searchParams.get('date') ?? '2026-10-29';
		if (url.pathname === '/api/usage/totals') {
			return route.fulfill({
				json: url.searchParams.has('from') ? { ...TOTALS, userCount: 1 } : TOTALS
			});
		}
		if (url.pathname === '/api/usage/balance') return route.fulfill({ json: { balance: 1250 } });
		if (url.pathname === '/api/usage/d1-limits') {
			return route.fulfill({
				json: { date, rowsRead: 10, rowsWritten: 2, readLimit: 5_000_000, writeLimit: 100_000 }
			});
		}
		if (url.pathname === '/api/usage/workers-ai') {
			return route.fulfill({ json: { date, requests: 3, neurons: 1, neuronLimit: 10_000 } });
		}
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

test.beforeEach(async ({ page }) => {
	await mockFeaturebase(page);
});

test("shows one user's all-time usage as a key-value table with generation types", async ({
	page
}) => {
	const requests = await mockUsage(page);

	await page.goto(`/usage/by-user?npub=${NPUB}`);

	await expect(page.getByRole('heading', { name: ru['usage.byUser.title'] })).toBeVisible();
	const totals = page.getByRole('region', { name: ru['usage.totals.title'] });
	await expect(totals).toContainText(`${ru['usage.totals.users']} 12`);
	const summary = page.getByRole('table', { name: ru['usage.byUser.summary'] });
	await expect(
		summary.getByRole('row', { name: `${ru['usage.column.balance']}, $ 42.50` })
	).toBeVisible();
	await expect(
		summary.getByRole('row', { name: `${ru['usage.column.generationCount']} 5` })
	).toBeVisible();
	await expect(
		summary.getByRole('link', { name: ru['usage.user.profileLink'].replace('{user}', 'Carol') })
	).toHaveAttribute('href', `https://primal.net/profile/${NPUB}`);
	await expect(summary).toContainText(`…${NPUB.slice(-5)}`);

	const kinds = page.getByRole('region', { name: ru['usage.kinds.title'] });
	await expect(
		kinds.getByRole('columnheader', { name: ru['usage.kinds.column.kind'] })
	).toBeVisible();
	await expect(
		kinds.getByRole('columnheader', { name: ru['usage.kinds.column.count'] })
	).toBeVisible();
	await expect(
		kinds.getByRole('row', { name: `${ru['generatedImages.kind.render']} 4` })
	).toBeVisible();
	await expect(
		kinds.getByRole('row', { name: `${ru['generatedImages.kind.styleTransfer']} 1` })
	).toBeVisible();
	await expect(page.getByRole('region', { name: ru['usage.generations.title'] })).toHaveCount(0);
	await expect(totals).toContainText(`${ru['usage.totals.walletBalance']} $ 1,250.00`);
	expect(requested(requests, `/api/usage/users/${PUBKEY}`)).toEqual(['']);
	expect(requested(requests, '/api/usage/totals')).toEqual(['']);
});

test("shows the day's generations and reloads when the query changes", async ({ page }) => {
	const requests = await mockUsage(page);

	await page.goto(`/usage/by-user?npub=${NPUB}&date=2026-01-03`);

	const generations = page.getByRole('region', { name: ru['usage.generations.title'] });
	for (const column of ['id', 'time', 'kind', 'prompt', 'source', 'result', 'reference'] as const) {
		await expect(
			generations.getByRole('columnheader', {
				name: ru[`usage.generations.column.${column}`],
				exact: true
			})
		).toBeVisible();
	}
	const row = generations.getByRole('row', { name: /generation-2/ });
	await expect(row).toContainText('13:00:00');
	await expect(row).toContainText(ru['generatedImages.kind.styleTransfer']);
	await expect(row).toContainText('scandinavian living room');
	const result = row.getByRole('link', {
		name: ru['usage.generations.resultAlt'].replace('{id}', 'generation-2')
	});
	await expect(result).toHaveAttribute('href', '/api/media/uploads/result-2.webp');
	await expect(result).toHaveAttribute('target', '_blank');
	await expect(
		row.getByRole('link', {
			name: ru['usage.generations.referenceAlt'].replace('{id}', 'generation-2')
		})
	).toHaveAttribute('href', '/api/media/uploads/reference.webp');
	await expect(
		generations
			.getByRole('row', { name: /generation-1/ })
			.getByRole('cell')
			.last()
	).toHaveText(ru['usage.emptyValue']);
	await expect(
		page
			.getByRole('table', { name: ru['usage.byUser.summary'] })
			.getByRole('row', { name: `${ru['usage.column.generationCount']} 2` })
	).toBeVisible();
	const range = `?from=${DAY_FROM}&to=${DAY_TO}`;
	expect(requested(requests, `/api/usage/users/${PUBKEY}`)).toEqual([range]);
	expect(requested(requests, `/api/usage/users/${PUBKEY}/generations`)).toEqual([
		`${range}&offset=0&size=20`
	]);

	const dayTotals = page.getByRole('region', {
		name: ru['usage.totals.dayTitle'].replace('{date}', '3 января 2026 г.')
	});
	await expect(dayTotals).toContainText(`${ru['usage.totals.users']} 1`);
	await expect(dayTotals).toContainText(
		ru['usage.totals.d1RowsRead'].replace('{date}', '2026-01-03')
	);
	await expect(dayTotals).toContainText(
		ru['usage.totals.workersAiRequests'].replace('{date}', '2026-01-03')
	);
	await expect(dayTotals).not.toContainText(ru['usage.totals.walletBalance']);
	expect(requested(requests, '/api/usage/totals')).toEqual([range]);
	expect(requested(requests, '/api/usage/d1-limits')).toEqual(['?date=2026-01-03']);
	expect(requested(requests, '/api/usage/workers-ai')).toEqual(['?date=2026-01-03']);
	expect(requested(requests, '/api/usage/balance')).toEqual([]);

	await page.getByRole('link', { name: ru['usage.byUser.allTime'] }).click();

	await expect(page).toHaveURL(`/usage/by-user?npub=${NPUB}`);
	await expect(generations).toHaveCount(0);
	await expect(
		page
			.getByRole('table', { name: ru['usage.byUser.summary'] })
			.getByRole('row', { name: `${ru['usage.column.generationCount']} 5` })
	).toBeVisible();
	const totals = page.getByRole('region', { name: ru['usage.totals.title'] });
	await expect(totals).toContainText(`${ru['usage.totals.walletBalance']} $ 1,250.00`);
	expect(requested(requests, `/api/usage/users/${PUBKEY}`).at(-1)).toBe('');
	expect(requested(requests, '/api/usage/totals').at(-1)).toBe('');
	expect(requested(requests, '/api/usage/d1-limits').at(-1)).toBe('');
	expect(requested(requests, '/api/usage/balance')).toEqual(['']);
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
