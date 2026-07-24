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

const archai = vi.hoisted(() => ({ postBalance: vi.fn() }));
const appEnvironment = vi.hoisted(() => ({ dev: true }));

vi.mock('$lib/server/archai', () => archai);
vi.mock('$app/environment', () => ({
	get dev() {
		return appEnvironment.dev;
	}
}));

const { getWalletBalance } = await import('./wallet');

const archaiApiUrl = 'https://archai.example.test/v1';
const withoutKey = { env: {} } as App.Platform;
const withKey = {
	env: { ARCHAI_API_KEY: 'test-key', ARCHAI_API_URL: archaiApiUrl }
} as App.Platform;

afterEach(() => {
	appEnvironment.dev = true;
	vi.restoreAllMocks();
	vi.clearAllMocks();
});

describe('getWalletBalance', () => {
	it('falls back to the dev mock when no API key is configured', async () => {
		const balance = await getWalletBalance(withoutKey);
		expect(balance).toBe(500);
		expect(archai.postBalance).not.toHaveBeenCalled();
	});

	it('throws in production when no API key is configured', async () => {
		appEnvironment.dev = false;
		await expect(getWalletBalance(withoutKey)).rejects.toThrow('Wallet balance unavailable');
	});

	it('returns the balance archAI reports, calling the configured API URL', async () => {
		archai.postBalance.mockResolvedValue({ data: { balance: 42 } });

		const balance = await getWalletBalance(withKey);

		expect(balance).toBe(42);
		expect(archai.postBalance.mock.calls[0][0].client.getConfig().baseUrl).toBe(archaiApiUrl);
	});

	it('throws a generic error without leaking provider details on an error response', async () => {
		archai.postBalance.mockResolvedValue({ error: { message: 'internal detail' } });

		await expect(getWalletBalance(withKey)).rejects.toThrow('Wallet balance unavailable');
	});

	it('throws a generic error when the request itself fails', async () => {
		archai.postBalance.mockRejectedValue(new Error('network down'));

		await expect(getWalletBalance(withKey)).rejects.toThrow('Wallet balance unavailable');
	});

	it('throws a generic error on an empty response', async () => {
		archai.postBalance.mockResolvedValue({});

		await expect(getWalletBalance(withKey)).rejects.toThrow('Wallet balance unavailable');
	});
});
