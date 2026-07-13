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
import type { PackagesResponse } from '$lib/api/contract';
import { apiError } from '$lib/server/api';
import { getDb } from '$lib/server/auth/repository';
import { listPackages } from '$lib/server/payments';

// Session is enforced centrally in hooks.server.ts (guardedPaths) — this is
// only conditionally public-looking data (catalog, no user data), gated the
// same as the rest of the app rather than exposed to logged-out visitors.
export const GET: RequestHandler = async ({ locals, platform }) => {
	if (!locals.user) return apiError(401, 'unauthorized', 'Authentication required');

	const packages = await listPackages(getDb(platform));
	return json({
		packages: packages.map((pkg) => ({
			id: pkg.id,
			usdAmount: pkg.usdAmount,
			creditsAwarded: pkg.creditsAwarded
		}))
	} satisfies PackagesResponse);
};
