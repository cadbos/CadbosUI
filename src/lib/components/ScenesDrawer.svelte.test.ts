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
import type { GeneratedImagesResponse, SceneRecord } from '$lib/api/contract';
import { setLocale, type Locale } from '$lib/i18n/index.svelte';
import { generatedImages } from '$lib/state/generated-images.svelte';
import { mediaAccess } from '$lib/state/media-access.svelte';
import ScenesDrawer from './ScenesDrawer.svelte';

function image(id: string, createdAt: number): SceneRecord {
	return {
		id,
		image: {
			key: `${id}.webp`,
			url: `https://cdn.example.test/${id}.webp`
		},
		source: {
			key: `${id}-source.jpg`,
			url: `https://cdn.example.test/${id}-source.jpg`
		},
		kind: 'render',
		createdAt,
		session: null,
		iteration: null
	};
}

function page(images: SceneRecord[], offset: number, hasMore: boolean): GeneratedImagesResponse {
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
	mediaAccess.clear();
	setLocale('ru');
});

afterEach(() => {
	generatedImages.clear();
	mediaAccess.clear();
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

		render(ScenesDrawer, { open: true, onClose: vi.fn() });

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
	const screen = render(ScenesDrawer, { open: true, onClose: vi.fn() });

	await expect.element(screen.getByRole('img', { name: 'Результат сцены 1' })).toBeVisible();
	await vi.waitFor(() => expect(observe).toHaveBeenCalled());

	observerCallbacks[0]?.(
		[{ isIntersecting: true } as IntersectionObserverEntry],
		{} as IntersectionObserver
	);

	await expect.element(screen.getByRole('img', { name: 'Результат сцены 2' })).toBeVisible();
	expect(observerOptions?.root).toBeInstanceOf(HTMLElement);
	expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/generated-images?offset=1&size=100', {
		signal: expect.any(AbortSignal)
	});
});

const SESSION = {
	projectId: '00000000-0000-4000-8000-000000000001',
	projectTitle: 'Квартира',
	sessionId: '00000000-0000-4000-8000-000000000011',
	sessionTitle: ''
};

it('shows each iteration’s session, marks the first one’s Base as the Source and opens its prompt', async () => {
	const fetchMock = vi.fn<typeof fetch>();
	vi.stubGlobal('fetch', fetchMock);
	fetchMock.mockResolvedValueOnce(
		new Response(
			JSON.stringify({
				id: 'sample',
				prompt: 'светлая кухня в скандинавском стиле',
				kind: 'render',
				createdAt: 1000,
				amount: 1,
				balanceAfter: 9,
				image: { key: 'sample.webp', url: 'https://cdn.example.test/sample.webp' },
				source: { key: 'source.jpg', url: 'https://cdn.example.test/source.jpg' },
				formSnapshot: null,
				session: SESSION,
				media: []
			}),
			{ status: 200, headers: { 'content-type': 'application/json' } }
		)
	);
	generatedImages.status = 'ready';
	generatedImages.images = [
		{ ...image('sample', 2000), session: SESSION, iteration: 2 },
		{ ...image('first', 1000), session: SESSION, iteration: 1 }
	];

	const screen = render(ScenesDrawer, { open: true, onClose: vi.fn() });

	await expect.element(screen.getByText('Квартира · Без названия').first()).toBeVisible();
	// Only the session's first iteration marks its Base as the Source.
	await expect
		.element(screen.getByRole('listitem').nth(1).getByText('Исходник', { exact: true }))
		.toBeVisible();
	await expect
		.element(screen.getByRole('listitem').first().getByText('Исходник', { exact: true }))
		.not.toBeInTheDocument();
	await screen.getByRole('button', { name: 'Показать промпт сцены 1' }).click();

	const dialog = screen.getByRole('dialog', { name: 'Промпт сцены 1' });
	await expect.element(dialog.getByText('светлая кухня в скандинавском стиле')).toBeVisible();
	expect(fetchMock).toHaveBeenCalledWith('/api/generated-images/sample');

	await dialog.getByRole('button', { name: 'Закрыть промпт' }).click();
	await expect.element(dialog).not.toBeInTheDocument();
});

it('switches to milestones, showing the iteration count and no prompt or delete buttons', async () => {
	const fetchMock = vi.fn<typeof fetch>();
	vi.stubGlobal('fetch', fetchMock);
	fetchMock.mockResolvedValue(
		jsonResponse(page([{ ...image('milestone', 1000), session: SESSION, iteration: 7 }], 0, false))
	);
	generatedImages.status = 'ready';
	generatedImages.images = [image('step', 1000)];

	const screen = render(ScenesDrawer, { open: true, onClose: vi.fn() });
	await expect
		.element(screen.getByRole('button', { name: 'Показать промпт сцены 1' }))
		.toBeVisible();

	// The drawer slides in from off-screen; clicking mid-transition misses.
	await vi.waitFor(() =>
		expect(document.querySelector('#scenes-drawer')?.getBoundingClientRect().left).toBe(0)
	);
	await screen.getByRole('button', { name: 'Вехи' }).click();

	await expect.element(screen.getByRole('list', { name: 'Вехи, сначала новые' })).toBeVisible();
	await expect
		.element(screen.getByRole('button', { name: 'Вехи' }))
		.toHaveAttribute('aria-pressed', 'true');
	await expect.element(screen.getByText('Первичная')).toBeVisible();
	await expect.element(screen.getByRole('img', { name: 'Генераций: 7' })).toHaveTextContent('7');
	expect(fetchMock).toHaveBeenCalledWith(
		'/api/generated-images?offset=0&size=100&view=milestones',
		{ signal: expect.any(AbortSignal) }
	);
	await expect
		.element(screen.getByRole('button', { name: 'Показать промпт сцены 1' }))
		.not.toBeInTheDocument();
	await expect
		.element(screen.getByRole('button', { name: 'Удалить сцену 1' }))
		.not.toBeInTheDocument();
});
