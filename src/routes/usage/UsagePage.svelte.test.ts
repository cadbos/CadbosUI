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
	UsageProfilesResponse,
	UsageTotals,
	UserUsageRecord,
	UserUsageResponse
} from '$lib/api/contract';
import { setLocale, type Locale } from '$lib/i18n/index.svelte';
import { auth } from '$lib/state/auth.svelte';
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
	profiles: UsageProfilesResponse['profiles'] = {}
) {
	let pageIndex = 0;
	return vi.fn<typeof fetch>((input, init) => {
		const url = String(input);
		if (url.startsWith('/api/usage?')) return Promise.resolve(jsonResponse(pages[pageIndex++]!));
		if (url === '/api/usage/profiles' && init?.method === 'POST')
			return Promise.resolve(Response.json({ profiles }));
		if (url === '/api/usage/balance') return Promise.resolve(Response.json({ balance: 0 }));
		if (url === '/api/usage/totals') return Promise.resolve(Response.json(TOTALS));
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

function localSizeLabel(locale: Locale, unit: 'kilobyte' | 'megabyte', value: number): string {
	return new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'short' }).format(value);
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
	auth.status = 'authenticated';
});

afterEach(() => {
	usage.clear();
	setLocale('ru');
	auth.status = 'anonymous';
	vi.unstubAllGlobals();
});

it.each(['ru', 'en'] as const)('renders localized usage table data for %s', async (locale) => {
	const latestSpendAt = Date.UTC(2026, 0, 3, 12, 34);
	const fetchMock = mockUsageFetch([page([user(PUBKEY_ONE, latestSpendAt)], 0, false)]);
	vi.stubGlobal('fetch', fetchMock);
	setLocale(locale);

	const screen = render(UsagePage, pageProps());

	await expect
		.element(screen.getByRole('heading', { name: locale === 'ru' ? 'Использование' : 'Usage' }))
		.toBeVisible();
	await expect.element(screen.getByRole('cell', { name: '12.35' })).toBeVisible();
	await expect.element(screen.getByRole('cell', { name: '7.50' })).toBeVisible();
	await expect
		.element(screen.getByRole('cell', { name: localDateTimeLabel(locale, latestSpendAt) }))
		.toBeVisible();
	await expect
		.element(screen.getByRole('columnheader', { name: locale === 'ru' ? 'Пользователь' : 'User' }))
		.toBeVisible();
	await expect
		.element(
			screen.getByRole('columnheader', {
				name: locale === 'ru' ? 'Размер исходников' : 'Sources size'
			})
		)
		.toBeVisible();
	await expect
		.element(
			screen.getByRole('columnheader', {
				name: locale === 'ru' ? 'Размер референсов' : 'References size'
			})
		)
		.toBeVisible();
	await expect
		.element(screen.getByRole('cell', { name: localSizeLabel(locale, 'megabyte', 3) }))
		.toBeVisible();
	await expect
		.element(screen.getByRole('cell', { name: localSizeLabel(locale, 'kilobyte', 512) }))
		.toBeVisible();
	const latestSpendHeader = screen.getByRole('columnheader', {
		name: `${locale === 'ru' ? 'Последняя трата' : 'Latest spend'}, ${localTimeZoneName(locale, 'short')}`
	});
	await expect.element(latestSpendHeader).toBeVisible();
	await expect
		.element(latestSpendHeader)
		.toHaveAttribute('title', localTimeZoneName(locale, 'long'));
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
	expect(screen.getByRole('cell', { name: '—' }).elements()).toHaveLength(3);
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

	await expect
		.element(screen.getByText('Sign in with an account that has access to see this data.'))
		.toBeVisible();
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

	await expect.element(screen.getByText('Could not load usage.')).toBeVisible();
});

it.each(['ru', 'en'] as const)('renders the platform totals for %s', async (locale) => {
	vi.stubGlobal('fetch', mockUsageFetch([page([user(PUBKEY_ONE)], 0, false)]));
	setLocale(locale);

	const screen = render(UsagePage, pageProps());
	const totals = screen.getByRole('region', {
		name: locale === 'ru' ? 'Итого по платформе' : 'Platform totals'
	});

	await expect.element(totals).toBeVisible();
	const labels =
		locale === 'ru'
			? [
					'Всего пополнено —',
					'Всего потрачено 99.50',
					'Зарегистрировано пользователей 7',
					'Проекты 11',
					'Сессии 23',
					'Генерации 42',
					`Загруженные исходники 40 · ${localSizeLabel(locale, 'megabyte', 3)}`,
					'Загруженные референсы 6 · —'
				]
			: [
					'Total deposits —',
					'Total spent 99.50',
					'Registered users 7',
					'Projects 11',
					'Sessions 23',
					'Generations 42',
					`Uploaded sources 40 · ${localSizeLabel(locale, 'megabyte', 3)}`,
					'Uploaded references 6 · —'
				];
	for (const label of labels) await expect.element(totals).toHaveTextContent(label);
});

it('renders a totals error without hiding the table', async () => {
	const fetchMock = vi.fn<typeof fetch>((input, init) => {
		if (String(input) === '/api/usage/totals')
			return Promise.resolve(new Response(null, { status: 500 }));
		return mockUsageFetch([page([user(PUBKEY_ONE)], 0, false)])(input, init);
	});
	vi.stubGlobal('fetch', fetchMock);

	const screen = render(UsagePage, pageProps());

	await expect.element(screen.getByText('Could not load totals.')).toBeVisible();
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

	const totals = screen.getByRole('region', { name: 'Platform totals' });
	await expect.element(totals.getByText('Wallet balance')).toBeVisible();
	await expect.element(totals.getByText('250.00')).toBeVisible();
	await expect.element(totals.getByRole('term').first()).toHaveTextContent('Wallet balance');
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

	const totals = screen.getByRole('region', { name: 'Platform totals' });
	await expect.element(totals.getByText('Could not load wallet balance.')).toBeVisible();
	await expect.element(totals.getByText('Could not load totals.')).toBeVisible();
});
