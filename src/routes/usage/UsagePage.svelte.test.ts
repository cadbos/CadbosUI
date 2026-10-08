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

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { npubEncode } from 'nostr-tools/nip19';
import type {
	D1DailyLimits,
	UsageProfilesResponse,
	UsageTotals,
	UserUsageRecord,
	UserUsageResponse
} from '$lib/api/contract';
import { setLocale, t, ti, type Locale } from '$lib/i18n/index.svelte';
import { auth } from '$lib/state/auth.svelte';
import { currency } from '$lib/state/currency.svelte';
import { usage } from '$lib/state/usage.svelte';
import UsagePage from './+page.svelte';
import type { PageProps } from './$types';

const PUBKEY_VIEWER = 'https://explorer.example/p/{}';
const PUBKEY_ONE = '1'.repeat(64);
const PUBKEY_TWO = '2'.repeat(64);

function user(
	pubkey: string,
	latestSpendAt: number | null = Date.UTC(2026, 0, 2)
): UserUsageRecord {
	return {
		pubkey,
		balance: 12.345,
		totalDeposit: 20,
		lastDepositAt: null,
		projectCount: 2,
		sessionCount: 5,
		generationCount: 4,
		sourceCount: 4,
		sourceBytes: 3 * 1024 * 1024,
		referenceCount: 1,
		referenceBytes: 512 * 1024,
		totalSpend: 7.5,
		latestSpendAt
	};
}

const TOTALS: UsageTotals = {
	userCount: 7,
	projectCount: 11,
	sessionCount: 23,
	generationCount: 42,
	sourceCount: 40,
	sourceBytes: 3 * 1024 * 1024,
	referenceCount: 6,
	referenceBytes: null,
	totalSpend: 99.5
};

const D1_LIMITS: D1DailyLimits = {
	date: '2026-10-07',
	rowsRead: 5_000_000,
	rowsWritten: 100,
	readLimit: 5_000_000,
	writeLimit: 100_000
};

function page(users: UserUsageRecord[], offset: number, hasMore: boolean): UserUsageResponse {
	return {
		users,
		pagination: {
			offset,
			size: 20,
			hasMore
		}
	};
}

function jsonResponse(body: UserUsageResponse): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
}

function mockUsageFetch(
	pages: UserUsageResponse[],
	profiles: UsageProfilesResponse['profiles'] = {},
	d1Limits: D1DailyLimits = D1_LIMITS,
	totals: UsageTotals = TOTALS
) {
	let pageIndex = 0;
	return vi.fn<typeof fetch>((input, init) => {
		const url = String(input);
		if (url.startsWith('/api/usage?')) return Promise.resolve(jsonResponse(pages[pageIndex++]!));
		if (url === '/api/usage/profiles' && init?.method === 'POST')
			return Promise.resolve(Response.json({ profiles }));
		if (url === '/api/usage/balance') return Promise.resolve(Response.json({ balance: 0 }));
		if (url === '/api/usage/totals') return Promise.resolve(Response.json(totals));
		if (url === '/api/usage/d1-limits') return Promise.resolve(Response.json(d1Limits));
		return Promise.resolve(new Response(null, { status: 404 }));
	});
}

function pageProps(pubkeyViewer = PUBKEY_VIEWER): PageProps {
	return { data: { pubkeyViewer }, form: undefined, params: {} };
}

function localDateTimeLabel(locale: Locale, timestamp: number): string {
	return new Intl.DateTimeFormat(locale, {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	}).format(new Date(timestamp));
}

function localSizeLabel(locale: Locale, value: number): string {
	return new Intl.NumberFormat(locale, {
		style: 'unit',
		unit: 'megabyte',
		unitDisplay: 'short',
		maximumFractionDigits: 1
	})
		.format(value)
		.replace(',', '.');
}

function localTimeZoneName(
	locale: Locale,
	timeZoneName: Intl.DateTimeFormatOptions['timeZoneName']
): string {
	const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	const formatter = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName });
	return (
		formatter.formatToParts(new Date()).find((part) => part.type === 'timeZoneName')?.value ??
		timeZone
	);
}

beforeEach(() => {
	usage.clear();
	setLocale('en');
	currency.code = 'usd';
	currency.rubPerUsd = null;
	auth.status = 'authenticated';
});

afterEach(() => {
	usage.clear();
	setLocale('ru');
	currency.code = 'usd';
	currency.rubPerUsd = null;
	auth.status = 'anonymous';
	vi.unstubAllGlobals();
});

it.each(['ru', 'en'] as const)('renders localized usage table data for %s', async (locale) => {
	const latestSpendAt = Date.UTC(2026, 0, 3, 12, 34);
	const fetchMock = mockUsageFetch([page([user(PUBKEY_ONE, latestSpendAt)], 0, false)]);
	vi.stubGlobal('fetch', fetchMock);
	setLocale(locale);

	const screen = render(UsagePage, pageProps());

	await expect.element(screen.getByRole('heading', { name: t('usage.title') })).toBeVisible();
	await expect.element(screen.getByRole('cell', { name: '$ 12.35' })).toBeVisible();
	await expect.element(screen.getByRole('cell', { name: '$ 7.50' })).toBeVisible();
	await expect
		.element(screen.getByRole('cell', { name: localDateTimeLabel(locale, latestSpendAt) }))
		.toBeVisible();
	await expect
		.element(screen.getByRole('columnheader', { name: t('usage.column.user') }))
		.toBeVisible();
	await expect
		.element(
			screen.getByRole('columnheader', {
				name: t('usage.column.sourceBytes')
			})
		)
		.toBeVisible();
	await expect
		.element(
			screen.getByRole('columnheader', {
				name: t('usage.column.referenceBytes')
			})
		)
		.toBeVisible();
	await expect.element(screen.getByRole('cell', { name: localSizeLabel(locale, 3) })).toBeVisible();
	await expect
		.element(screen.getByRole('cell', { name: localSizeLabel(locale, 0.5) }))
		.toBeVisible();
	const latestSpendHeader = screen.getByRole('columnheader', {
		name: `${t('usage.column.latestSpendAt')}, ${localTimeZoneName(locale, 'short')}`
	});
	await expect.element(latestSpendHeader).toBeVisible();
	await expect
		.element(latestSpendHeader)
		.toHaveAttribute('title', localTimeZoneName(locale, 'long'));
});

it.each(['ru', 'en'] as const)('uses fixed numeric punctuation for %s', async (locale) => {
	const sourceBytes = 1536.5 * 1024 * 1024;
	vi.stubGlobal(
		'fetch',
		mockUsageFetch(
			[
				page(
					[
						{
							...user(PUBKEY_ONE),
							balance: 1234.5,
							projectCount: 12_345,
							sourceBytes
						}
					],
					0,
					false
				)
			],
			{},
			D1_LIMITS,
			{ ...TOTALS, userCount: 2_345, sourceCount: 1_234, sourceBytes, totalSpend: 1234.5 }
		)
	);
	setLocale(locale);

	const screen = render(UsagePage, pageProps());
	const totals = screen.getByRole('region', { name: t('usage.totals.title') });
	await expect.element(screen.getByRole('cell', { name: '$ 1,234.50' })).toBeVisible();
	await expect.element(screen.getByRole('cell', { name: '12 345' })).toBeVisible();
	await expect.element(totals.getByText('$ 1,234.50')).toBeVisible();
	await expect.element(totals.getByText('2 345')).toBeVisible();
	await expect.element(totals.getByText(/1 234 \| 1 536\.5/)).toBeVisible();
	await expect.element(screen.getByRole('cell', { name: /1 536\.5/ })).toBeVisible();
});

it('uses the selected RUB rate with the symbol before the grouped amount', async () => {
	currency.code = 'rub';
	currency.rubPerUsd = 90;
	vi.stubGlobal(
		'fetch',
		mockUsageFetch([page([{ ...user(PUBKEY_ONE), balance: 1234.5 }], 0, false)])
	);

	const screen = render(UsagePage, pageProps());
	await expect.element(screen.getByRole('cell', { name: '₽ 111,105.00' })).toBeVisible();
});

it('shows an em dash instead of a size when no upload size is known', async () => {
	const fetchMock = mockUsageFetch([
		page([{ ...user(PUBKEY_ONE), sourceBytes: null, referenceBytes: null }], 0, false)
	]);
	vi.stubGlobal('fetch', fetchMock);

	const screen = render(UsagePage, pageProps());

	await expect
		.element(screen.getByRole('rowheader', { name: npubEncode(PUBKEY_ONE) }))
		.toBeVisible();
	expect(screen.getByRole('cell', { name: t('usage.emptyValue') }).elements()).toHaveLength(3);
	expect(screen.getByRole('cell', { name: /MB|kB/ }).elements()).toHaveLength(0);
});

it('loads the next usage page when the infinite-scroll sentinel intersects', async () => {
	const observerCallbacks: IntersectionObserverCallback[] = [];
	let observerOptions: IntersectionObserverInit | undefined;
	const observe = vi.fn();
	const fetchMock = mockUsageFetch([
		page([user(PUBKEY_ONE)], 0, true),
		page([user(PUBKEY_TWO)], 1, false)
	]);
	const IntersectionObserverMock = vi.fn(function (
		callback: IntersectionObserverCallback,
		options?: IntersectionObserverInit
	) {
		observerCallbacks.push(callback);
		observerOptions = options;
		return {
			observe,
			unobserve: vi.fn(),
			disconnect: vi.fn(),
			takeRecords: () => [],
			root: null,
			rootMargin: '',
			scrollMargin: '',
			thresholds: []
		} as unknown as IntersectionObserver;
	});

	vi.stubGlobal('IntersectionObserver', IntersectionObserverMock);
	vi.stubGlobal('fetch', fetchMock);

	const screen = render(UsagePage, pageProps());

	await expect
		.element(screen.getByRole('rowheader', { name: npubEncode(PUBKEY_ONE) }))
		.toBeVisible();
	await vi.waitFor(() => expect(observe).toHaveBeenCalled());

	observerCallbacks[0]?.(
		[{ isIntersecting: true } as IntersectionObserverEntry],
		{} as IntersectionObserver
	);

	await expect
		.element(screen.getByRole('rowheader', { name: npubEncode(PUBKEY_TWO) }))
		.toBeVisible();
	expect(observerOptions?.root).toBeNull();
	expect(fetchMock).toHaveBeenCalledWith('/api/usage?offset=1&size=20', {
		signal: expect.any(AbortSignal)
	});
});

it('never fetches or renders usage data while the auth store is not authenticated', async () => {
	auth.status = 'anonymous';
	const fetchMock = mockUsageFetch([page([user(PUBKEY_ONE)], 0, false)]);
	vi.stubGlobal('fetch', fetchMock);

	const screen = render(UsagePage, pageProps());

	await expect.element(screen.getByText(t('usage.signInRequired'))).toBeVisible();
	expect(fetchMock).not.toHaveBeenCalled();
});

it('renders an error state when usage cannot be loaded', async () => {
	const fetchMock = vi.fn<typeof fetch>((input) => {
		const url = String(input);
		if (url === '/api/usage/balance') return Promise.resolve(Response.json({ balance: 0 }));
		if (url === '/api/usage/totals') return Promise.resolve(Response.json(TOTALS));
		return Promise.resolve(new Response(null, { status: 403 }));
	});
	vi.stubGlobal('fetch', fetchMock);

	const screen = render(UsagePage, pageProps());

	await expect.element(screen.getByText(t('usage.failed'))).toBeVisible();
});

it('renders each pubkey as an npub explorer link that opens in a new tab', async () => {
	const pubkey = 'a'.repeat(64);
	const npub = npubEncode(pubkey);
	const fetchMock = mockUsageFetch([page([user(pubkey)], 0, false)], {
		[pubkey]: { name: 'Alice' }
	});
	vi.stubGlobal('fetch', fetchMock);

	const screen = render(UsagePage, pageProps());
	const link = screen.getByRole('link', { name: npub });

	await expect.element(link).toBeVisible();
	await expect.element(link).toHaveAttribute('href', `https://explorer.example/p/${npub}`);
	await expect.element(link).toHaveAttribute('target', '_blank');
	await expect.element(link).toHaveAttribute('rel', 'noopener noreferrer');
});

it.each(['ru', 'en'] as const)('renders the platform totals for %s', async (locale) => {
	vi.stubGlobal('fetch', mockUsageFetch([page([user(PUBKEY_ONE)], 0, false)]));
	setLocale(locale);

	const screen = render(UsagePage, pageProps());
	const totals = screen.getByRole('region', { name: t('usage.totals.title') });

	await expect.element(totals).toBeVisible();
	const labels = [
		`${t('usage.totals.deposits')} ${t('usage.emptyValue')}`,
		`${t('usage.totals.spend')} $ 99.50`,
		`${t('usage.totals.users')} 7`,
		`${t('usage.totals.projects')} 11`,
		`${t('usage.totals.sessions')} 23`,
		`${t('usage.totals.generations')} 42`,
		`${t('usage.totals.sources')} ${ti('usage.totals.countWithSize', { count: 40, size: localSizeLabel(locale, 3) })}`,
		`${t('usage.totals.references')} ${ti('usage.totals.countWithSize', { count: 6, size: t('usage.emptyValue') })}`
	];
	for (const label of labels) await expect.element(totals).toHaveTextContent(label);
	const readTerm = totals.getByText(ti('usage.totals.d1RowsRead', { date: D1_LIMITS.date }));
	const writeTerm = totals.getByText(ti('usage.totals.d1RowsWritten', { date: D1_LIMITS.date }));
	await expect.element(readTerm).toBeVisible();
	await expect.element(writeTerm).toBeVisible();
	const readQuota = readTerm.element().parentElement!;
	const writeQuota = writeTerm.element().parentElement!;
	expect(readQuota.querySelector('.d1-used')?.textContent).toBe('5 000 000');
	expect(readQuota.querySelector('.d1-limit')?.textContent).toBe('5 000 000');
	expect(writeQuota.querySelector('.d1-used')?.textContent).toBe('100');
	expect(writeQuota.querySelector('.d1-limit')?.textContent).toBe('100 000');
	expect(readQuota.querySelector('.d1-divider')?.textContent).toBe(
		t('usage.totals.d1DivisionSign')
	);
	expect(writeQuota.querySelector('.d1-divider')?.textContent).toBe(
		t('usage.totals.d1DivisionSign')
	);
	expect(readQuota.textContent).toContain(t('usage.totals.d1LimitReached'));
});

it.each(['ru', 'en'] as const)('shows full D1 counts without rounding for %s', async (locale) => {
	vi.stubGlobal(
		'fetch',
		mockUsageFetch(
			[page([], 0, false)],
			{},
			{
				...D1_LIMITS,
				rowsRead: 1_250,
				readLimit: 500_000,
				rowsWritten: 523_400,
				writeLimit: 500_001
			}
		)
	);
	setLocale(locale);

	const screen = render(UsagePage, pageProps());
	const totals = screen.getByRole('region', { name: t('usage.totals.title') });
	const readTerm = totals.getByText(ti('usage.totals.d1RowsRead', { date: D1_LIMITS.date }));
	const writeTerm = totals.getByText(ti('usage.totals.d1RowsWritten', { date: D1_LIMITS.date }));
	await expect.element(readTerm).toBeVisible();
	await expect.element(writeTerm).toBeVisible();
	const readQuota = readTerm.element().parentElement!;
	const writeQuota = writeTerm.element().parentElement!;
	expect(readQuota.querySelector('.d1-used')?.textContent).toBe('1 250');
	expect(readQuota.querySelector('.d1-limit')?.textContent).toBe('500 000');
	expect(writeQuota.querySelector('.d1-used')?.textContent).toBe('523 400');
	expect(writeQuota.querySelector('.d1-limit')?.textContent).toBe('500 001');
	await expect.element(totals).toHaveTextContent(t('usage.totals.d1LimitReached'));
});

it('keeps raw quota comparisons when rounded figures look equal', async () => {
	vi.stubGlobal(
		'fetch',
		mockUsageFetch(
			[page([], 0, false)],
			{},
			{
				...D1_LIMITS,
				rowsRead: 499_999,
				readLimit: 500_000,
				rowsWritten: 999,
				writeLimit: 1_000
			}
		)
	);

	const screen = render(UsagePage, pageProps());
	const totals = screen.getByRole('region', { name: t('usage.totals.title') });
	const readTerm = totals.getByText(ti('usage.totals.d1RowsRead', { date: D1_LIMITS.date }));
	const writeTerm = totals.getByText(ti('usage.totals.d1RowsWritten', { date: D1_LIMITS.date }));
	await expect.element(readTerm).toBeVisible();
	await expect.element(writeTerm).toBeVisible();
	const readQuota = readTerm.element().parentElement!;
	const writeQuota = writeTerm.element().parentElement!;
	expect(readQuota.querySelector('.d1-used')?.textContent).toBe('499 999');
	expect(readQuota.querySelector('.d1-limit')?.textContent).toBe('500 000');
	expect(writeQuota.querySelector('.d1-used')?.textContent).toBe('999');
	expect(writeQuota.querySelector('.d1-limit')?.textContent).toBe('1 000');
	expect(totals.getByText(t('usage.totals.d1LimitReached')).elements()).toHaveLength(0);
});

it('renders a totals error without hiding the table', async () => {
	const fetchMock = vi.fn<typeof fetch>((input, init) => {
		if (String(input) === '/api/usage/totals')
			return Promise.resolve(new Response(null, { status: 500 }));
		return mockUsageFetch([page([user(PUBKEY_ONE)], 0, false)])(input, init);
	});
	vi.stubGlobal('fetch', fetchMock);

	const screen = render(UsagePage, pageProps());

	await expect.element(screen.getByText(t('usage.totals.failed'))).toBeVisible();
	await expect
		.element(screen.getByRole('rowheader', { name: npubEncode(PUBKEY_ONE) }))
		.toBeVisible();
});

it('shows the wallet balance as the first tile of the platform totals', async () => {
	const fetchMock = vi.fn<typeof fetch>((input, init) => {
		if (String(input) === '/api/usage/balance')
			return Promise.resolve(Response.json({ balance: 250 }));
		return mockUsageFetch([page([user(PUBKEY_ONE)], 0, false)])(input, init);
	});
	vi.stubGlobal('fetch', fetchMock);

	const screen = render(UsagePage, pageProps());

	const totals = screen.getByRole('region', { name: t('usage.totals.title') });
	await expect.element(totals.getByText(t('usage.totals.walletBalance'))).toBeVisible();
	await expect.element(totals.getByText('$ 250.00')).toBeVisible();
	await expect
		.element(totals.getByRole('term').first())
		.toHaveTextContent(t('usage.totals.walletBalance'));
});

it('shows a wallet balance error inside the totals even when totals fail', async () => {
	const fetchMock = vi.fn<typeof fetch>((input, init) => {
		const url = String(input);
		if (url === '/api/usage/balance') return Promise.resolve(new Response(null, { status: 502 }));
		if (url === '/api/usage/totals') return Promise.resolve(new Response(null, { status: 500 }));
		return mockUsageFetch([page([user(PUBKEY_ONE)], 0, false)])(input, init);
	});
	vi.stubGlobal('fetch', fetchMock);

	const screen = render(UsagePage, pageProps());

	const totals = screen.getByRole('region', { name: t('usage.totals.title') });
	await expect.element(totals.getByText(t('usage.walletBalanceFailed'))).toBeVisible();
	await expect.element(totals.getByText(t('usage.totals.failed'))).toBeVisible();
});
