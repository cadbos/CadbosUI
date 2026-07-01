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
import { encode } from 'uqr';
import QrCode from './QrCode.svelte';

it('renders the uqr matrix as an accessible svg path', async () => {
	const data = 'nostrconnect://cadbos-example';
	const { size } = encode(data, { ecc: 'M' });

	const screen = render(QrCode, { data, label: 'QR code' });
	const svg = screen.getByRole('img', { name: 'QR code' });
	await expect.element(svg).toBeVisible();

	const el = svg.element();
	expect(el.getAttribute('viewBox')).toBe(`0 0 ${size} ${size}`);
	expect(el.querySelector('path')?.getAttribute('d')).toContain('M');
});

it('encodes different data into different paths', () => {
	const short = render(QrCode, { data: 'short', label: 'a' });
	const long = render(QrCode, { data: 'a-much-longer-nostrconnect-payload', label: 'b' });

	const dA = short
		.getByRole('img', { name: 'a' })
		.element()
		.querySelector('path')
		?.getAttribute('d');
	const dB = long
		.getByRole('img', { name: 'b' })
		.element()
		.querySelector('path')
		?.getAttribute('d');

	expect(dA).toBeTruthy();
	expect(dA).not.toBe(dB);
});
