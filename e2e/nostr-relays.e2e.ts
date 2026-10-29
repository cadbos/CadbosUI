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

import { loadEnv } from 'vite';

import { resolveNostrRelays } from '../config/nostr-relays';
import { expect, test } from './fixtures';

const { connectRelays } = resolveNostrRelays(
	loadEnv(process.env.PLAYWRIGHT_BUILD_MODE ?? 'production', process.cwd(), 'NOSTR_')
);

test('uses the configured Nostr Connect relays and permits their origins in CSP', async ({
	page
}) => {
	const connectedRelays = new Set<string>();
	await page.routeWebSocket(/.*/, (socket) => {
		connectedRelays.add(socket.url());
	});
	await page.route('**/auth/me', async (route) => {
		await route.fulfill({ status: 401, json: {} });
	});

	const response = await page.goto('/');
	expect(response).not.toBeNull();
	const csp = response!.headers()['content-security-policy'];
	expect(csp).toBeDefined();
	const connectSources = csp
		.split(';')
		.find((directive) => directive.trim().startsWith('connect-src '))
		?.trim()
		.split(/\s+/)
		.slice(1);
	expect(connectSources).toBeDefined();
	for (const relay of connectRelays) {
		expect(connectSources).toContain(new URL(relay).origin);
	}

	await page.locator('.auth-trigger').click();
	await page.getByRole('button', { name: 'Nostr Connect (QR)', exact: true }).click();
	await expect(
		page.getByRole('img', { name: 'QR-код для входа через Nostr Connect' })
	).toBeVisible();
	await expect
		.poll(() => [...connectedRelays].sort())
		.toEqual(connectRelays.map((relay) => new URL(relay).href).sort());
	await page.getByRole('button', { name: 'Отмена', exact: true }).click();
	await expect(page.getByRole('img', { name: 'QR-код для входа через Nostr Connect' })).toHaveCount(
		0
	);
});
