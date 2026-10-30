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

import { readFile } from 'node:fs/promises';
import type { Download, Locator, Page } from '@playwright/test';
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
			latestSpendAt: DAY_FROM + 12 * HOUR,
			firstSignInAt: DAY_FROM + 9 * HOUR,
			lastSignInAt: DAY_FROM + 18 * HOUR
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
	pagination: { size: 20, nextCursor: null }
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

async function readDownload(download: Download): Promise<string> {
	const path = await download.path();
	return readFile(path, 'utf8');
}

test.beforeEach(async ({ page }) => {
	await mockFeaturebase(page);
});

test("shows the user's figures as tiles above full-width generation types", async ({
	page,
	context
}) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	const requests = await mockUsage(page);

	await page.goto(`/usage/by-user?npub=${NPUB}`);

	await expect(
		page.getByRole('heading', { level: 1, name: ru['usage.byUser.title'], exact: true })
	).toBeVisible();
	const facts = page.locator('.usage-header .facts');
	const userFact = facts.locator('div').filter({ hasText: ru['usage.byUser.userLabel'] });
	await expect(userFact).toContainText(`npub1…${NPUB.slice(-5)}`);
	await expect(userFact.getByText(`npub1…${NPUB.slice(-5)}`)).toHaveAttribute('title', NPUB);
	await expect(userFact.locator('.initial')).toHaveText('C');
	const periodFact = facts.locator('div').filter({ hasText: ru['usage.byUser.periodLabel'] });
	await expect(periodFact.getByRole('button', { name: ru['usage.byUser.pickDay'] })).toBeVisible();
	await expect(periodFact.locator('strong')).toHaveText(ru['usage.byUser.allTime']);
	const keyActions = page.locator('.key-actions');
	await expect(
		keyActions.getByRole('link', { name: ru['auth.profile.viewOnPrimal'] })
	).toHaveAttribute('href', `https://primal.net/profile/${NPUB}`);
	const copyKey = keyActions.getByRole('button');
	await copyKey.click();
	await expect(copyKey).toHaveAttribute('title', ru['auth.profile.npubCopied']);
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(NPUB);
	const tiles = page.getByRole('region', { name: ru['usage.byUser.summary'] });
	await expect(tiles).toContainText(`${ru['usage.column.balance']} $ 42.50`);
	await expect(tiles).toContainText(`${ru['usage.totals.deposits']} $ 100.00`);
	await expect(tiles).toContainText(`${ru['usage.totals.spend']} $ 57.50`);
	await expect(tiles).toContainText(`${ru['usage.totals.generations']} 5`);
	await expect(tiles).toContainText(
		`${ru['usage.column.lastDepositAt']} ${ru['usage.emptyValue']}`
	);
	const latestSpend = tiles.locator('div').filter({ hasText: ru['usage.column.latestSpendAt'] });
	await expect(latestSpend.locator('dd')).toHaveText('2026-01-0312:00 00s');
	expect((await latestSpend.locator('dd').boundingBox())?.height).toBeGreaterThan(30);
	await expect(latestSpend.getByRole('link', { name: '2026-01-03', exact: true })).toHaveAttribute(
		'href',
		`/usage/by-user?npub=${NPUB}&date=2026-01-03`
	);
	for (const [label, time] of [
		[ru['usage.column.firstSignInAt'], '09:00 00s'],
		[ru['usage.column.lastSignInAt'], '18:00 00s']
	]) {
		const signIn = tiles.locator('div').filter({ hasText: label });
		await expect(signIn.locator('dd')).toHaveText(`2026-01-03${time}`);
		await expect(signIn.getByRole('link', { name: '2026-01-03', exact: true })).toHaveAttribute(
			'href',
			`/usage/by-user?npub=${NPUB}&date=2026-01-03`
		);
	}
	for (const absent of [
		ru['usage.totals.users'],
		ru['usage.totals.walletBalance'],
		ru['usage.totals.title'],
		ru['usage.column.user']
	]) {
		await expect(page.getByText(absent, { exact: true })).toHaveCount(0);
	}
	await expect(page.getByRole('table')).toHaveCount(1);

	const kinds = page.getByRole('region', { name: ru['usage.kinds.title'] });
	await expect(
		kinds.getByRole('row', { name: `${ru['generatedImages.kind.render']} 4` })
	).toBeVisible();
	expect(Math.abs((await box(kinds)).width - (await box(tiles)).width)).toBeLessThan(1);

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

	await expect(
		page.locator('.usage-header .facts').getByRole('button', { name: '2026-01-03' })
	).toBeVisible();
	const dayTotals = page.getByRole('region', { name: ru['usage.byUser.summary'] });
	await expect(dayTotals).toContainText(`${ru['usage.totals.generations']} 2`);
	await expect(dayTotals).toContainText(`${ru['usage.column.latestSpendAt']} 12:00 00s`);
	await expect(dayTotals).toContainText(`${ru['usage.column.firstSignInAt']} 09:00 00s`);
	await expect(dayTotals).toContainText(`${ru['usage.column.lastSignInAt']} 18:00 00s`);
	await expect(dayTotals.getByRole('link')).toHaveCount(0);
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
	await expect(
		longRow.getByRole('link', {
			name: ru['adminGeneration.open'].replace('{id}', 'generation-2'),
			exact: true
		})
	).toHaveAttribute('href', '/usage/generations/generation-2');
	await expect(longRow).toContainText('13:00 00s');
	await expect(longRow).not.toContainText('2026-01-03');
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
		`${range}&size=20`
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
	await expect(page.getByRole('region', { name: ru['usage.byUser.summary'] })).toContainText(
		`${ru['usage.totals.generations']} 5`
	);
	expect(requested(requests, `/api/usage/users/${PUBKEY}`).at(-1)).toBe('');
});

test("narrows the day's generations to a kind picked in generation types", async ({ page }) => {
	const requests = await mockUsage(page);
	await page.route(`**/api/usage/users/${PUBKEY}/generations?*`, async (route) => {
		const url = new URL(route.request().url());
		requests.push(url);
		const kind = url.searchParams.get('kind');
		await route.fulfill({
			json: {
				...GENERATIONS,
				generations: GENERATIONS.generations.filter(
					(generation) => kind === null || generation.kind === kind
				)
			}
		});
	});
	const kinds = page.getByRole('region', { name: ru['usage.kinds.title'] });
	const generationsTitle = ru['usage.generations.kindTitle'].replace(
		'{kind}',
		ru['generatedImages.kind.render']
	);

	await page.goto(`/usage/by-user?npub=${NPUB}&date=2026-01-03`);
	await expect(page.getByRole('row', { name: /generation-2/ })).toBeVisible();
	await kinds.getByRole('link', { name: ru['generatedImages.kind.render'], exact: true }).click();

	await expect(page).toHaveURL(`/usage/by-user?npub=${NPUB}&date=2026-01-03&kind=render`);
	const generations = page.getByRole('region', { name: generationsTitle });
	await expect(generations.getByRole('row', { name: /generation-1/ })).toBeVisible();
	await expect(generations.getByRole('row', { name: /generation-2/ })).toHaveCount(0);
	await expect(
		generations.getByRole('columnheader', { name: ru['usage.generations.column.kind'] })
	).toHaveCount(0);
	await expect(kinds).toHaveCount(0);
	const kindPicker = page
		.locator('.usage-header .facts')
		.getByRole('button', { name: ru['generatedImages.kind.render'] });
	await expect(kindPicker).toBeVisible();
	expect(requested(requests, `/api/usage/users/${PUBKEY}`)).toHaveLength(1);
	expect(
		requested(requests, `/api/usage/users/${PUBKEY}/generations`).map((search) =>
			new URLSearchParams(search).get('kind')
		)
	).toEqual([null, 'render']);

	await kindPicker.click();
	const kindMenu = page.getByRole('navigation', { name: ru['usage.kinds.title'] });
	await expect(
		kindMenu.getByRole('link', { name: new RegExp(ru['generatedImages.kind.render']) })
	).toHaveAttribute('aria-current', 'true');
	await kindMenu.getByRole('link', { name: ru['usage.kinds.all'] }).click();

	await expect(page).toHaveURL(`/usage/by-user?npub=${NPUB}&date=2026-01-03`);
	const allGenerations = page.getByRole('region', { name: ru['usage.generations.title'] });
	await expect(allGenerations.getByRole('row', { name: /generation-2/ })).toBeVisible();
	await expect(
		allGenerations.getByRole('columnheader', { name: ru['usage.generations.column.kind'] })
	).toBeVisible();
	expect(requested(requests, `/api/usage/users/${PUBKEY}`)).toHaveLength(1);

	await page.goto(`/usage/by-user?npub=${NPUB}&date=2026-01-03&kind=legacy`);
	await expect(page.getByRole('alert')).toHaveText(ru['usage.byUser.invalidKind']);
});

test('picks a day from the calendar with the mouse or the keyboard', async ({ page }) => {
	await page.clock.setFixedTime(new Date('2026-01-20T12:00:00+03:00'));
	await mockUsage(page);

	await page.goto(`/usage/by-user?npub=${NPUB}`);
	await page.getByRole('button', { name: ru['usage.byUser.pickDay'] }).click();
	const calendar = page.getByRole('dialog', { name: ru['usage.calendar.label'] });
	await expect(calendar).toBeVisible();
	await expect(calendar).toContainText('январь 2026');
	await expect(calendar.getByRole('button', { name: '2026-01-21' })).toBeDisabled();
	await expect(
		calendar.getByRole('button', { name: ru['usage.calendar.nextMonth'] })
	).toBeDisabled();
	await calendar.getByRole('button', { name: '2026-01-03' }).click();

	await expect(page).toHaveURL(`/usage/by-user?npub=${NPUB}&date=2026-01-03`);
	await expect(calendar).toBeHidden();
	await page.getByRole('button', { name: '2026-01-03' }).click();
	await expect(calendar.getByRole('button', { name: '2026-01-03' })).toHaveAttribute(
		'aria-current',
		'date'
	);
	await calendar.getByRole('button', { name: ru['usage.calendar.previousMonth'] }).click();
	await expect(calendar).toContainText('декабрь 2025');
	await calendar.getByRole('button', { name: '2025-12-03' }).focus();
	await page.keyboard.press('ArrowLeft');
	await expect(calendar.getByRole('button', { name: '2025-12-02' })).toBeFocused();
	await page.keyboard.press('Enter');

	await expect(page).toHaveURL(`/usage/by-user?npub=${NPUB}&date=2025-12-02`);
});

test('loads the next page of generations when scrolled to the end of the table', async ({
	page
}) => {
	const requests = await mockUsage(page);
	const [template] = GENERATIONS.generations;
	const rows = Array.from({ length: 22 }, (_, index) => ({
		...template,
		id: `generation-page-${index + 1}`,
		prompt: 'cozy bedroom',
		createdAt: DAY_FROM + 20 * HOUR - index * 60_000
	}));
	await page.route(`**/api/usage/users/${PUBKEY}/generations?*`, async (route) => {
		const url = new URL(route.request().url());
		requests.push(url);
		const cursor = url.searchParams.get('cursor');
		const start = cursor === null ? 0 : rows.findIndex((row) => cursor.endsWith(`:${row.id}`)) + 1;
		const pageRows = rows.slice(start, start + 20);
		const last = pageRows.at(-1);
		await route.fulfill({
			json: {
				generations: pageRows,
				pagination: {
					size: 20,
					nextCursor: start + 20 < rows.length && last ? `${last.createdAt}:${last.id}` : null
				}
			}
		});
	});

	await page.goto(`/usage/by-user?npub=${NPUB}&date=2026-01-03`);
	const table = page
		.getByRole('region', { name: ru['usage.generations.title'] })
		.getByRole('table');
	await expect(table.getByRole('row', { name: /generation-page-20\b/ })).toBeVisible();
	await expect(table.getByRole('row', { name: /generation-page-21\b/ })).toHaveCount(0);

	await page.locator('.load-more-sentinel').scrollIntoViewIfNeeded();

	await expect(table.getByRole('row', { name: /generation-page-22\b/ })).toBeVisible();
	await expect(table.getByRole('row', { name: /generation-page-/ })).toHaveCount(22);
	const range = `from=${DAY_FROM}&to=${DAY_TO}`;
	expect(requested(requests, `/api/usage/users/${PUBKEY}/generations`)).toEqual([
		`?${range}&size=20`,
		`?${range}&cursor=${encodeURIComponent(`${rows[19].createdAt}:generation-page-20`)}&size=20`
	]);
});

test('exports the user to Markdown, with every generation of the day only in day mode', async ({
	page
}) => {
	await mockUsage(page);
	await page.route(`**/api/usage/users/${PUBKEY}/generations?*`, async (route) => {
		const cursor = new URL(route.request().url()).searchParams.get('cursor');
		const [first, second] = GENERATIONS.generations;
		await route.fulfill({
			json:
				cursor === null
					? {
							generations: [first],
							pagination: { size: 20, nextCursor: `${first.createdAt}:${first.id}` }
						}
					: { generations: [second], pagination: { size: 20, nextCursor: null } }
		});
	});
	const exportButton = page.getByRole('button', { name: ru['usage.export.button'] });

	await page.goto(`/usage/by-user?npub=${NPUB}`);
	const [allTime] = await Promise.all([page.waitForEvent('download'), exportButton.click()]);
	expect(allTime.suggestedFilename()).toBe(`cadbos-usage-${NPUB}.md`);
	const allTimeMarkdown = await readDownload(allTime);
	expect(allTimeMarkdown).toContain(`# ${ru['usage.byUser.title']}`);
	expect(allTimeMarkdown).toContain(`${ru['usage.byUser.userLabel']} ${NPUB}`);
	expect(allTimeMarkdown).toContain(`| ${ru['usage.column.balance']} | $ 42.50 |`);
	expect(allTimeMarkdown).toContain(`| ${ru['generatedImages.kind.render']} | 4 |`);
	expect(allTimeMarkdown).not.toContain(ru['usage.generations.title']);

	await page.goto(`/usage/by-user?npub=${NPUB}&date=2026-01-03`);
	await expect(page.getByRole('row', { name: /generation-2/ })).toBeVisible();
	const [dayExport] = await Promise.all([page.waitForEvent('download'), exportButton.click()]);
	expect(dayExport.suggestedFilename()).toBe(`cadbos-usage-${NPUB}-2026-01-03.md`);
	const dayMarkdown = await readDownload(dayExport);
	expect(dayMarkdown).toContain(`## ${ru['usage.generations.title']}`);
	expect(dayMarkdown).toContain(`| generation-2 | 13:00 00s |`);
	expect(dayMarkdown).toContain(`| generation-1 | 12:00 00s |`);
	expect(dayMarkdown).toContain(LONG_PROMPT);
	expect(dayMarkdown).toContain(
		`![${ru['usage.generations.resultAlt'].replace('{id}', 'generation-2')}](<${new URL('/api/media/uploads/result-2.webp', page.url()).href}>)`
	);
});

test('retries a page of generations that failed to load', async ({ page }) => {
	await mockUsage(page);
	let failNext = true;
	await page.route(`**/api/usage/users/${PUBKEY}/generations?*`, async (route) => {
		if (failNext) {
			failNext = false;
			await route.fulfill({ status: 500 });
			return;
		}
		await route.fulfill({ json: GENERATIONS });
	});
	const generations = page.getByRole('region', { name: ru['usage.generations.title'] });

	await page.goto(`/usage/by-user?npub=${NPUB}&date=2026-01-03`);
	await expect(generations.getByRole('alert')).toHaveText(ru['usage.generations.failed']);
	await generations.getByRole('button', { name: ru['usage.generations.retry'] }).click();

	await expect(generations.getByRole('row', { name: /generation-2/ })).toBeVisible();
	await expect(generations.getByRole('alert')).toHaveCount(0);
});

for (const { view, link, url } of [
	{ view: 'all time', link: ru['usage.byUser.allTime'], url: `/usage/by-user?npub=${NPUB}` },
	{
		view: 'one generation kind',
		link: ru['generatedImages.kind.render'],
		url: `/usage/by-user?npub=${NPUB}&date=2026-01-03&kind=render`
	}
]) {
	test(`drops the error of an export the page moved to ${view} from`, async ({ page }) => {
		await mockUsage(page);
		let releaseSecondPage: () => void = () => undefined;
		const secondPageHeld = new Promise<void>((release) => {
			releaseSecondPage = release;
		});
		await page.route(`**/api/usage/users/${PUBKEY}/generations?*`, async (route) => {
			const cursor = new URL(route.request().url()).searchParams.get('cursor');
			const [first, second] = GENERATIONS.generations;
			if (cursor === null) {
				await route.fulfill({
					json: {
						generations: [first],
						pagination: { size: 20, nextCursor: `${first.createdAt}:${first.id}` }
					}
				});
				return;
			}
			await secondPageHeld;
			await route.fulfill({
				json: { generations: [second], pagination: { size: 20, nextCursor: null } }
			});
		});

		await page.goto(`/usage/by-user?npub=${NPUB}&date=2026-01-03`);
		await expect(page.getByRole('row', { name: /generation-2/ })).toBeVisible();
		await page.getByRole('button', { name: ru['usage.export.button'] }).click();
		await expect(page.getByRole('button', { name: ru['usage.export.exporting'] })).toBeVisible();
		await page.getByRole('link', { name: link, exact: true }).click();
		await expect(page).toHaveURL(url);
		releaseSecondPage();

		await expect(page.getByRole('button', { name: ru['usage.export.button'] })).toBeEnabled();
		await expect(page.getByText(ru['usage.export.failed'])).toHaveCount(0);
	});
}

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
	// The spend date comes before the sign-in dates of the same day.
	const dayLinks = page.getByRole('link', { name: '2026-01-03', exact: true });
	await expect(dayLinks).toHaveCount(3);
	await dayLinks.first().click();
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
