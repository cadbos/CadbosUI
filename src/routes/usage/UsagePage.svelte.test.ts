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
import type { UserUsageRecord, UserUsageResponse } from '$lib/api/contract';
import { setLocale, type Locale } from '$lib/i18n/index.svelte';
import { usage } from '$lib/state/usage.svelte';
import UsagePage from './+page.svelte';

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
	const fetchMock = vi.fn<typeof fetch>();
	vi.stubGlobal('fetch', fetchMock);
	setLocale(locale);
	fetchMock.mockResolvedValueOnce(jsonResponse(page([user('pubkey-1', latestSpendAt)], 0, false)));

	const screen = render(UsagePage);

	await expect
		.element(screen.getByRole('heading', { name: locale === 'ru' ? 'Использование' : 'Usage' }))
		.toBeVisible();
	await expect.element(screen.getByRole('cell', { name: '12.35' })).toBeVisible();
	await expect.element(screen.getByRole('cell', { name: '7.50' })).toBeVisible();
	await expect
		.element(screen.getByRole('cell', { name: localDateTimeLabel(locale, latestSpendAt) }))
		.toBeVisible();
});

it('loads the next usage page when the infinite-scroll sentinel intersects', async () => {
	const observerCallbacks: IntersectionObserverCallback[] = [];
	let observerOptions: IntersectionObserverInit | undefined;
	const observe = vi.fn();
	const fetchMock = vi.fn<typeof fetch>();
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
	fetchMock
		.mockResolvedValueOnce(jsonResponse(page([user('pubkey-1')], 0, true)))
		.mockResolvedValueOnce(jsonResponse(page([user('pubkey-2')], 1, false)));

	const screen = render(UsagePage);

	await expect.element(screen.getByRole('rowheader', { name: 'pubkey-1' })).toBeVisible();
	await vi.waitFor(() => expect(observe).toHaveBeenCalled());

	observerCallbacks[0]?.(
		[{ isIntersecting: true } as IntersectionObserverEntry],
		{} as IntersectionObserver
	);

	await expect.element(screen.getByRole('rowheader', { name: 'pubkey-2' })).toBeVisible();
	expect(observerOptions?.root).toBeNull();
	expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/usage?offset=1&size=20', {
		signal: expect.any(AbortSignal)
	});
});

it('renders an error state when usage cannot be loaded', async () => {
	const fetchMock = vi.fn<typeof fetch>();
	vi.stubGlobal('fetch', fetchMock);
	fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }));

	const screen = render(UsagePage);

	await expect.element(screen.getByRole('alert')).toHaveTextContent('Could not load usage.');
});
