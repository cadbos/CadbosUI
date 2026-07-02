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
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { MeResponse } from '$lib/api/contract';
import { apiError } from '$lib/server/api';
import { DEMO_PUBKEY, DEMO_QUOTA } from '$lib/server/demo';

export const GET: RequestHandler = ({ locals }) => {
	if (!locals.user) return apiError(401, 'unauthorized', 'Authentication required');

	const quota = dev && locals.user.pubkey === DEMO_PUBKEY ? DEMO_QUOTA : undefined;

	return json({ user: locals.user, quota } satisfies MeResponse);
};
