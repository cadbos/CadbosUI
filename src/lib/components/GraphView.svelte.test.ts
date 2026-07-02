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

import { page } from 'vitest/browser';
import { beforeEach, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import GraphView from './GraphView.svelte';
import { request } from '$lib/state/request.svelte';

beforeEach(async () => {
	request.reset();
	// The default test viewport is narrower than the graph view's 640px mobile
	// breakpoint, which hides the canvas by design (NFR-12). Widen it so these
	// tests exercise the desktop graph, not the mobile fallback message.
	await page.viewport(1024, 768);
});

it('renders store fragments with the derived prompt preview', async () => {
	request.addFragment({ text: 'Scandinavian', order: 0 });
	request.addFragment({ text: 'kitchen', order: 1 });

	const screen = render(GraphView);

	await expect
		.element(screen.getByRole('textbox', { name: 'Узел фрагмента 1' }))
		.toHaveValue('Scandinavian');
	await expect
		.element(screen.getByRole('textbox', { name: 'Узел фрагмента 2' }))
		.toHaveValue('kitchen');
	await expect
		.element(screen.getByRole('textbox', { name: 'Итоговый промпт' }))
		.toHaveValue('Scandinaviankitchen');
});
