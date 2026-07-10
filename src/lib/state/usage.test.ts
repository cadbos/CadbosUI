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
import type { UserUsageRecord, UserUsageResponse } from '$lib/api/contract';
import { usage } from './usage.svelte';

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

beforeEach(() => {
	usage.clear();
});

afterEach(() => {
	usage.clear();
	vi.unstubAllGlobals();
});

describe('usage pagination', () => {
	it('loads the first usage page and exposes remaining records for loadMore', async () => {
		const fetchMock = vi.fn<typeof fetch>();
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockResolvedValueOnce(jsonResponse(page([user('pubkey-1')], 0, true)));

		await usage.load();

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledWith('/api/usage?offset=0&size=20', {
			signal: expect.any(AbortSignal)
		});
		expect(usage.status).toBe('ready');
		expect(usage.users.map((record) => record.pubkey)).toEqual(['pubkey-1']);
		expect(usage.hasMore).toBe(true);
	});

	it('loads the next usage page on demand', async () => {
		const fetchMock = vi.fn<typeof fetch>();
		vi.stubGlobal('fetch', fetchMock);
		fetchMock
			.mockResolvedValueOnce(jsonResponse(page([user('pubkey-1')], 0, true)))
			.mockResolvedValueOnce(jsonResponse(page([user('pubkey-2')], 1, false)));

		await usage.load();
		await usage.loadMore();

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/usage?offset=1&size=20', {
			signal: expect.any(AbortSignal)
		});
		expect(usage.status).toBe('ready');
		expect(usage.users.map((record) => record.pubkey)).toEqual(['pubkey-1', 'pubkey-2']);
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
});
