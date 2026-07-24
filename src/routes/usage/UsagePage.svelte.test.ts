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
import type { UsageProfilesResponse, UserUsageRecord, UserUsageResponse } from '$lib/api/contract';
import { setLocale, type Locale } from '$lib/i18n/index.svelte';
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
		generationCount: 4,
		totalSpend: 7.5,
		latestSpendAt
	};
}

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
	walletBalance: number | null = 0
) {
	let pageIndex = 0;
	return vi.fn<typeof fetch>((input, init) => {
		const url = String(input);
		if (url.startsWith('/api/usage?')) return Promise.resolve(jsonResponse(pages[pageIndex++]!));
		if (url === '/api/usage/profiles' && init?.method === 'POST')
			return Promise.resolve(Response.json({ profiles }));
		if (url === '/api/usage/balance') {
			return walletBalance === null
				? Promise.resolve(new Response(null, { status: 500 }))
				: Promise.resolve(Response.json({ balance: walletBalance }));
		}
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
});

afterEach(() => {
	usage.clear();
	setLocale('ru');
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
	const latestSpendHeader = screen.getByRole('columnheader', {
		name: `${locale === 'ru' ? 'Последняя трата' : 'Latest spend'}, ${localTimeZoneName(locale, 'short')}`
	});
	await expect.element(latestSpendHeader).toBeVisible();
	await expect
		.element(latestSpendHeader)
		.toHaveAttribute('title', localTimeZoneName(locale, 'long'));
});

it.each(['ru', 'en'] as const)('renders the live wallet balance for %s', async (locale) => {
	const fetchMock = mockUsageFetch([page([user(PUBKEY_ONE)], 0, false)], {}, 123.4);
	vi.stubGlobal('fetch', fetchMock);
	setLocale(locale);

	const screen = render(UsagePage, pageProps());

	await expect
		.element(
			screen.getByText(locale === 'ru' ? 'Баланс кошелька: 123.40 $' : 'Wallet balance: 123.40 $')
		)
		.toBeVisible();
});

it('renders an error message when the wallet balance cannot be loaded', async () => {
	const fetchMock = mockUsageFetch([page([user(PUBKEY_ONE)], 0, false)], {}, null);
	vi.stubGlobal('fetch', fetchMock);

	const screen = render(UsagePage, pageProps());

	await expect.element(screen.getByText('Could not load wallet balance.')).toBeVisible();
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

it('renders an error state when usage cannot be loaded', async () => {
	const fetchMock = vi.fn<typeof fetch>((input) => {
		const url = String(input);
		if (url === '/api/usage/balance') return Promise.resolve(Response.json({ balance: 0 }));
		return Promise.resolve(new Response(null, { status: 403 }));
	});
	vi.stubGlobal('fetch', fetchMock);

	const screen = render(UsagePage, pageProps());

	await expect.element(screen.getByText('Could not load usage.')).toBeVisible();
});

it('renders each pubkey as an npub explorer link that opens in a new tab', async () => {
	const pubkey = 'a'.repeat(64);
	const npub = npubEncode(pubkey);
	const fetchMock = mockUsageFetch([page([user(pubkey)], 0, false)], {
		[pubkey]: { name: 'Alice', picture: 'https://avatar.example/alice.png' }
	});
	vi.stubGlobal('fetch', fetchMock);

	const screen = render(UsagePage, pageProps());
	const link = screen.getByRole('link', { name: npub });

	await expect.element(link).toBeVisible();
	await expect.element(link).toHaveAttribute('href', `https://explorer.example/p/${npub}`);
	await expect.element(link).toHaveAttribute('target', '_blank');
	await expect.element(link).toHaveAttribute('rel', 'noopener noreferrer');
	await vi.waitFor(() => {
		expect(
			screen
				.getByRole('rowheader', { name: npub })
				.element()
				.querySelector('img')
				?.getAttribute('src')
		).toBe('https://avatar.example/alice.png');
	});
});
