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

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { WalletBalanceResponse } from '$lib/api/contract';
import { apiError } from '$lib/server/api';
import { authorizeUsageViewer, getUsageViewerDb } from '$lib/server/usage';
import { getWalletBalance } from '$lib/server/wallet';

export const GET: RequestHandler = async ({ platform, locals }) => {
	const user = locals.user;
	if (!user) return apiError(401, 'unauthorized', 'Authentication required');

	const authorization = authorizeUsageViewer(platform, user);
	if (authorization) return authorization;

	const viewerDb = await getUsageViewerDb(platform, user.pubkey);
	if (viewerDb instanceof Response) return viewerDb;

	let balance: number;
	try {
		balance = await getWalletBalance(platform);
	} catch {
		return apiError(502, 'wallet_balance_unavailable', 'Could not retrieve wallet balance');
	}

	return json({ balance } satisfies WalletBalanceResponse);
};
