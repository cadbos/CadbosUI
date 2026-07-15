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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UsageProfilesResponse, UserUsageRecord, UserUsageResponse } from '$lib/api/contract';
import { usage } from './usage.svelte';

const PUBKEY_ONE = '1'.repeat(64);
const PUBKEY_TWO = '2'.repeat(64);

function user(pubkey: string): UserUsageRecord {
	return {
		pubkey,
		balance: 10,
		totalDeposit: 20,
		lastDepositAt: Date.UTC(2026, 0, 1),
		generationCount: 2,
		totalSpend: 3.5,
		latestSpendAt: Date.UTC(2026, 0, 2)
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

function profilesResponse(profiles: UsageProfilesResponse['profiles'] = {}): Response {
	return new Response(JSON.stringify({ profiles } satisfies UsageProfilesResponse), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
}

function mockUsageFetch(
	pages: UserUsageResponse[],
	profiles: UsageProfilesResponse['profiles'] = {}
) {
	let pageIndex = 0;
	return vi.fn<typeof fetch>((input) => {
		const url = String(input);
		if (url.startsWith('/api/usage?')) return Promise.resolve(jsonResponse(pages[pageIndex++]!));
		if (url === '/api/usage/profiles') return Promise.resolve(profilesResponse(profiles));
		return Promise.resolve(new Response(null, { status: 404 }));
	});
}

beforeEach(() => {
	usage.clear();
});

afterEach(() => {
	usage.clear();
	vi.unstubAllGlobals();
});

describe('usage pagination', () => {
	it('loads the first usage page and exposes remaining records for loadMore', async () => {
		const fetchMock = mockUsageFetch([page([user(PUBKEY_ONE)], 0, true)], {
			[PUBKEY_ONE]: { name: 'One', picture: 'https://avatar.example/one.png' }
		});
		vi.stubGlobal('fetch', fetchMock);

		await usage.load();

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock).toHaveBeenCalledWith('/api/usage?offset=0&size=20', {
			signal: expect.any(AbortSignal)
		});
		expect(fetchMock).toHaveBeenCalledWith('/api/usage/profiles', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ pubkeys: [PUBKEY_ONE] }),
			signal: expect.any(AbortSignal)
		});
		expect(usage.status).toBe('ready');
		expect(usage.users.map((record) => record.pubkey)).toEqual([PUBKEY_ONE]);
		await vi.waitFor(() => {
			expect(usage.profiles[PUBKEY_ONE]).toEqual({
				name: 'One',
				picture: 'https://avatar.example/one.png'
			});
		});
		expect(usage.hasMore).toBe(true);
	});

	it('loads the next usage page on demand', async () => {
		const fetchMock = mockUsageFetch([
			page([user(PUBKEY_ONE)], 0, true),
			page([user(PUBKEY_TWO)], 1, false)
		]);
		vi.stubGlobal('fetch', fetchMock);

		await usage.load();
		await usage.loadMore();

		expect(fetchMock).toHaveBeenCalledTimes(4);
		expect(fetchMock).toHaveBeenCalledWith('/api/usage?offset=1&size=20', {
			signal: expect.any(AbortSignal)
		});
		expect(usage.status).toBe('ready');
		expect(usage.users.map((record) => record.pubkey)).toEqual([PUBKEY_ONE, PUBKEY_TWO]);
		expect(usage.hasMore).toBe(false);
		expect(usage.loadingMore).toBe(false);
	});

	it('surfaces invalid usage responses as load errors', async () => {
		const fetchMock = vi.fn<typeof fetch>();
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockResolvedValueOnce(
			new Response(JSON.stringify({ users: [{ pubkey: '' }] }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		);

		await usage.load();

		expect(usage.status).toBe('error');
		expect(usage.users).toEqual([]);
		expect(usage.error).toBe('UsageLoadError');
	});

	it('rejects usage records with non-hex pubkeys', async () => {
		const fetchMock = vi.fn<typeof fetch>();
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockResolvedValueOnce(jsonResponse(page([user('not-a-pubkey')], 0, false)));

		await usage.load();

		expect(usage.status).toBe('error');
		expect(usage.users).toEqual([]);
		expect(usage.error).toBe('UsageLoadError');
	});
});
