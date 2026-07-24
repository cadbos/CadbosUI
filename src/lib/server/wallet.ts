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

import { dev } from '$app/environment';
import { createClient } from '$lib/server/archai/client';
import { postBalance } from '$lib/server/archai';
import { mockWalletBalance } from '$lib/server/mocks/fixtures';

const BALANCE_TIMEOUT_MS = 10_000;

function requestClientFor(apiKey: string, apiUrl: string): ReturnType<typeof createClient> {
	// Per-request client — setting headers on the singleton is not safe in Workers.
	return createClient({
		baseUrl: apiUrl,
		headers: { 'x-api-key': apiKey }
	});
}

// Live balance for the one shared ARCHAI_API_KEY account, straight from
// archAI's Check Balance endpoint — never a given user's own balance.
export async function getWalletBalance(platform: App.Platform | undefined): Promise<number> {
	const apiKey = platform?.env?.ARCHAI_API_KEY;
	const apiUrl = platform?.env?.ARCHAI_API_URL;

	if (!apiKey || !apiUrl) {
		if (dev) return mockWalletBalance();
		console.error(
			`archAI balance check failed: ${!apiKey ? 'ARCHAI_API_KEY' : 'ARCHAI_API_URL'} not configured`
		);
		throw new Error('Wallet balance unavailable');
	}

	let result: Awaited<ReturnType<typeof postBalance>>;
	try {
		result = await postBalance({
			client: requestClientFor(apiKey, apiUrl),
			signal: AbortSignal.timeout(BALANCE_TIMEOUT_MS)
		});
	} catch (err) {
		console.error('archAI balance check failed:', err);
		throw new Error('Wallet balance unavailable', { cause: err });
	}

	if (result.error) {
		console.error('archAI balance check failed:', result.error);
		throw new Error('Wallet balance unavailable');
	}

	if (!result.data) {
		console.error('archAI balance check failed: empty response from balance service');
		throw new Error('Wallet balance unavailable');
	}

	return result.data.balance;
}
