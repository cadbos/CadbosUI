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
import type { GeneratedImageRecord, GeneratedImagesResponse } from '$lib/api/contract';
import { setLocale, type Locale } from '$lib/i18n/index.svelte';
import { generatedImages } from '$lib/state/generated-images.svelte';
import GeneratedImagesSidebar from './GeneratedImagesSidebar.svelte';

function image(id: string, createdAt: number): GeneratedImageRecord {
	return {
		id,
		url: `https://cdn.example.test/${id}.webp`,
		createdAt
	};
}

function page(
	images: GeneratedImageRecord[],
	offset: number,
	hasMore: boolean
): GeneratedImagesResponse {
	return {
		images,
		pagination: {
			offset,
			size: 100,
			hasMore
		}
	};
}

function jsonResponse(body: GeneratedImagesResponse): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
}

function localDateLabel(locale: Locale, createdAt: number): string {
	const parts = new Intl.DateTimeFormat(locale, {
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	}).formatToParts(new Date(createdAt));
	const day = parts.find((part) => part.type === 'day')?.value;
	const month = parts.find((part) => part.type === 'month')?.value;
	const year = parts.find((part) => part.type === 'year')?.value;
	if (!day || !month || !year) throw new Error('generated image date parts missing');
	return `${day} ${month} ${year}`;
}

function localTimeLabel(locale: Locale, createdAt: number): string {
	return new Intl.DateTimeFormat(locale, {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hourCycle: 'h23'
	}).format(new Date(createdAt));
}

beforeEach(() => {
	generatedImages.clear();
	setLocale('ru');
});

afterEach(() => {
	generatedImages.clear();
	setLocale('ru');
	vi.unstubAllGlobals();
});

it.each(['ru', 'en'] as const)(
	'formats generated image date and time in two lines for %s',
	async (locale) => {
		const createdAt = Date.UTC(2026, 0, 3, 12, 34, 56);
		setLocale(locale);
		generatedImages.status = 'ready';
		generatedImages.images = [image('sample', createdAt)];

		render(GeneratedImagesSidebar);

		await vi.waitFor(() => {
			expect(
				Array.from(document.querySelectorAll('time span')).map((span) => span.textContent)
			).toEqual([localDateLabel(locale, createdAt), localTimeLabel(locale, createdAt)]);
		});
	}
);

it('loads the next generated-images page when the infinite-scroll sentinel intersects', async () => {
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
		.mockResolvedValueOnce(jsonResponse(page([image('first', 2000)], 0, true)))
		.mockResolvedValueOnce(jsonResponse(page([image('second', 1000)], 1, false)));

	await generatedImages.load();
	const screen = render(GeneratedImagesSidebar);

	await expect
		.element(screen.getByRole('img', { name: 'Сгенерированное изображение 1' }))
		.toBeVisible();
	await vi.waitFor(() => expect(observe).toHaveBeenCalled());

	observerCallbacks[0]?.(
		[{ isIntersecting: true } as IntersectionObserverEntry],
		{} as IntersectionObserver
	);

	await expect
		.element(screen.getByRole('img', { name: 'Сгенерированное изображение 2' }))
		.toBeVisible();
	expect(observerOptions?.root).toBeInstanceOf(HTMLElement);
	expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/generated-images?offset=1&size=100', {
		signal: expect.any(AbortSignal)
	});
});
