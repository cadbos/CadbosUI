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

import { expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import LazyImage from './LazyImage.svelte';

it('keeps a skeleton over a lazily loaded image until it decodes', async () => {
	const screen = render(LazyImage, {
		src: '/room.webp',
		alt: 'Комната',
		fetchPriority: 'low'
	});

	const photo = screen.getByRole('img', { name: 'Комната' });
	await expect.element(photo).toHaveAttribute('src', '/room.webp');
	await expect.element(photo).toHaveAttribute('loading', 'lazy');
	await expect.element(photo).toHaveAttribute('decoding', 'async');
	await expect.element(photo).toHaveAttribute('fetchpriority', 'low');
	expect(screen.container.querySelector('.image-skeleton')).not.toBeNull();
});

it('loads the first visible image eagerly', async () => {
	const screen = render(LazyImage, {
		src: '/preset.webp',
		alt: '',
		decorative: true,
		loading: 'eager',
		fetchPriority: 'high'
	});

	const photo = screen.container.querySelector('img');
	expect(photo?.getAttribute('loading')).toBe('eager');
	expect(photo?.getAttribute('fetchpriority')).toBe('high');
	expect(photo?.getAttribute('alt')).toBe('');
	expect(photo?.getAttribute('aria-hidden')).toBe('true');
	expect(screen.getByRole('img').all()).toHaveLength(0);
});
