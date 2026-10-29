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

function mockApi(
	pages: (UsageGenerationsResponse | null)[]
): ReturnType<typeof vi.fn<typeof fetch>> {
	// Each request takes the next response in order; null answers with a 500.
	let next = 0;
	const fetcher = vi.fn<typeof fetch>(async (input) => {
		const url = new URL(String(input), 'https://cadbos.example');
		if (!url.pathname.endsWith('/generations')) return new Response(null, { status: 500 });
		const page = pages[next++];
		return page ? Response.json(page) : new Response(null, { status: 500 });
	});
	vi.stubGlobal('fetch', fetcher);
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
	return fetcher;
}

function generationOffsets(fetcher: ReturnType<typeof vi.fn<typeof fetch>>): string[] {
	return fetcher.mock.calls
		.map(([input]) => new URL(String(input), 'https://cadbos.example'))
		.filter((url) => url.pathname.endsWith('/generations'))
		.map((url) => url.searchParams.get('offset') ?? '');
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
		expect(generationOffsets(fetcher)).toEqual(['0', '2']);
	});

	it('fails when a page cannot be loaded and requests that page again next time', async () => {
		const fetcher = mockApi([
			{ generations: [generation(1)], pagination: { offset: 0, size: 20, hasMore: true } },
			null,
			{ generations: [generation(2)], pagination: { offset: 1, size: 20, hasMore: false } }
		]);

		userUsage.load(PUBKEY, DAY);

		await expect(userUsage.loadAllGenerations()).rejects.toThrow('user generations unavailable');
		expect(userUsage.hasMoreGenerations).toBe(true);
		const generations = await userUsage.loadAllGenerations();
		expect(generations.map((entry) => entry.id)).toEqual(['generation-1', 'generation-2']);
		expect(generationOffsets(fetcher)).toEqual(['0', '1', '1']);
	});

	it('drops a generation a shifted page repeats', async () => {
		mockApi([
			{
				generations: [generation(1), generation(2)],
				pagination: { offset: 0, size: 20, hasMore: true }
			},
			{
				generations: [generation(2), generation(3)],
				pagination: { offset: 2, size: 20, hasMore: false }
			}
		]);

		userUsage.load(PUBKEY, DAY);
		const generations = await userUsage.loadAllGenerations();

		expect(generations.map((entry) => entry.id)).toEqual([
			'generation-1',
			'generation-2',
			'generation-3'
		]);
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

	it("reloads only the day's generations when another kind is picked", async () => {
		const fetcher = mockApi([
			{ generations: [generation(1)], pagination: { offset: 0, size: 20, hasMore: false } },
			{ generations: [generation(2)], pagination: { offset: 0, size: 20, hasMore: false } }
		]);

		userUsage.load(PUBKEY, DAY);
		await userUsage.loadAllGenerations();
		userUsage.selectKind('render');
		userUsage.selectKind('render');
		const generations = await userUsage.loadAllGenerations();

		expect(generations.map((entry) => entry.id)).toEqual(['generation-2']);
		const requests = fetcher.mock.calls.map(
			([input]) => new URL(String(input), 'https://cadbos.example')
		);
		expect(requests.filter((url) => !url.pathname.endsWith('/generations'))).toHaveLength(1);
		expect(
			requests
				.filter((url) => url.pathname.endsWith('/generations'))
				.map((url) => url.searchParams.get('kind'))
		).toEqual([null, 'render']);
	});
});
