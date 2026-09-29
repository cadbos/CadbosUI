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
import type { UsageTotals } from '$lib/api/contract';
import { authenticationRequiredResponse } from '$lib/server/auth/session';
import { getUsageTotals } from '$lib/server/generations';
import { authorizeUsageViewer, getUsageViewerDb } from '$lib/server/usage';

export const GET: RequestHandler = async ({ platform, locals }) => {
	const user = locals.user;
	if (!user) return authenticationRequiredResponse(locals.sessionLookupUnavailable);

	const authorization = authorizeUsageViewer(platform, user);
	if (authorization) return authorization;

	const db = await getUsageViewerDb(platform, user.pubkey);
	if (db instanceof Response) return db;

	return json((await getUsageTotals(db)) satisfies UsageTotals);
};
