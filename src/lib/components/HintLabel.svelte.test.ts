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
import { userEvent } from 'vitest/browser';
import HintLabel from './HintLabel.svelte';

it('shows its hint on hover and describes the label with it', async () => {
	const screen = render(HintLabel, { text: 'Основа', hint: 'Входное изображение итерации.' });
	const label = screen.getByRole('button', { name: 'Основа' });

	await expect.element(screen.getByRole('tooltip', { includeHidden: true })).not.toBeVisible();
	await expect.element(label).toHaveAccessibleDescription('Входное изображение итерации.');

	await label.hover();
	await expect
		.element(screen.getByRole('tooltip'))
		.toHaveTextContent('Входное изображение итерации.');

	await userEvent.unhover(label);
	await expect.element(screen.getByRole('tooltip', { includeHidden: true })).not.toBeVisible();
});

it('shows its hint on keyboard focus and hides it on Escape', async () => {
	const screen = render(HintLabel, { text: 'Результат', hint: 'Можно взять Основой.' });

	const label = screen.getByRole('button', { name: 'Результат' });
	(label.element() as HTMLElement).focus();
	await expect.element(label).toHaveFocus();
	await expect.element(screen.getByRole('tooltip')).toBeVisible();

	await userEvent.keyboard('{Escape}');
	await expect.element(screen.getByRole('tooltip', { includeHidden: true })).not.toBeVisible();
});
