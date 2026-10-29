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

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UsageGenerationRecord, UsageGenerationsResponse } from '$lib/api/contract';
import { userUsage } from './user-usage.svelte';

const PUBKEY = 'c'.repeat(64);
const DAY = { from: 1000, to: 2000 };

function generation(index: number): UsageGenerationRecord {
	return {
		id: `generation-${index}`,
		kind: 'render',
		createdAt: 1500,
		prompt: 'cozy',
		source: { key: 'uploads/source.webp', url: '/api/media/uploads/source.webp' },
		result: { key: `uploads/${index}.webp`, url: `/api/media/uploads/${index}.webp` },
		reference: null
	};
}

function mockApi(pages: UsageGenerationsResponse[]): ReturnType<typeof vi.fn<typeof fetch>> {
	const fetcher = vi.fn<typeof fetch>(async (input) => {
		const url = new URL(String(input), 'https://cadbos.example');
		if (url.pathname.endsWith('/generations')) {
			const offset = Number(url.searchParams.get('offset'));
			const page = pages.find((candidate) => candidate.pagination.offset === offset);
			return page ? Response.json(page) : new Response(null, { status: 404 });
		}
		return new Response(null, { status: 500 });
	});
	vi.stubGlobal('fetch', fetcher);
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
	return fetcher;
}

afterEach(() => {
	userUsage.clear();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('userUsage.loadAllGenerations', () => {
	it('fetches every remaining page once, waiting for the one in flight', async () => {
		const fetcher = mockApi([
			{
				generations: [generation(1), generation(2)],
				pagination: { offset: 0, size: 20, hasMore: true }
			},
			{ generations: [generation(3)], pagination: { offset: 2, size: 20, hasMore: false } }
		]);

		userUsage.load(PUBKEY, DAY);
		const generations = await userUsage.loadAllGenerations();

		expect(generations.map((entry) => entry.id)).toEqual([
			'generation-1',
			'generation-2',
			'generation-3'
		]);
		expect(userUsage.hasMoreGenerations).toBe(false);
		const pageRequests = fetcher.mock.calls
			.map(([input]) => String(input))
			.filter((url) => url.includes('/generations'));
		expect(pageRequests).toHaveLength(2);
	});

	it('fails when a page cannot be loaded', async () => {
		mockApi([{ generations: [generation(1)], pagination: { offset: 0, size: 20, hasMore: true } }]);

		userUsage.load(PUBKEY, DAY);

		await expect(userUsage.loadAllGenerations()).rejects.toThrow('user generations unavailable');
	});

	it('fails when the page moves to another user meanwhile', async () => {
		mockApi([
			{ generations: [generation(1)], pagination: { offset: 0, size: 20, hasMore: false } }
		]);

		userUsage.load(PUBKEY, DAY);
		const exported = userUsage.loadAllGenerations();
		userUsage.clear();

		await expect(exported).rejects.toThrow('user usage changed during export');
	});
});
