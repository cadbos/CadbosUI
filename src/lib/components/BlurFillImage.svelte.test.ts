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
import BlurFillImage from './BlurFillImage.svelte';

it('shows the photo whole over a blurred copy hidden from assistive tech', async () => {
	const screen = render(BlurFillImage, { src: '/photo.jpg', alt: 'Фото комнаты' });

	const photo = screen.getByRole('img', { name: 'Фото комнаты' });
	await expect.element(photo).toHaveAttribute('src', '/photo.jpg');
	expect(getComputedStyle(photo.element()).objectFit).toBe('contain');

	// The backdrop is the only other image and is purely decorative.
	expect(screen.getByRole('img').all()).toHaveLength(1);
	const backdrop = screen.container.querySelector('img[aria-hidden="true"]');
	expect(backdrop?.getAttribute('src')).toBe('/photo.jpg');
	expect(backdrop?.getAttribute('alt')).toBe('');
});
