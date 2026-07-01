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

import { beforeEach, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import GraphView from './GraphView.svelte';
import { request } from '$lib/state/request.svelte';

beforeEach(() => {
	request.reset();
});

it('hydrates fields from request fragments and applies text-only fragments', async () => {
	request.addFragment({ label: 'Style', text: 'Scandinavian ', order: 0 });
	request.addFragment({ label: 'Room', text: 'living room', order: 1 });

	const screen = render(GraphView);

	expect(
		(screen.getByRole('textbox', { name: 'Узел фрагмента 1' }).element() as HTMLInputElement).value
	).toBe('Scandinavian ');
	expect(
		(screen.getByRole('textbox', { name: 'Узел фрагмента 2' }).element() as HTMLInputElement).value
	).toBe('living room');

	await screen.getByRole('textbox', { name: 'Узел фрагмента 2' }).fill('kitchen');
	await screen.getByRole('button', { name: 'Применить графовый промпт' }).click();

	expect(request.toJSON().promptFragments).toEqual([
		expect.objectContaining({ text: 'Scandinavian ', order: 0 }),
		expect.objectContaining({ text: 'kitchen', order: 1 })
	]);
	expect(request.toJSON().promptFragments.some((fragment) => 'label' in fragment)).toBe(false);
	expect(request.prompt).toBe('Scandinavian kitchen');
});
