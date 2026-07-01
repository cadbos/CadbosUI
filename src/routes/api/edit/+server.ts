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
import { assertDevOnly } from '$lib/server/dev';
import { editRequestSchema, parseBody } from '$lib/server/api';
import { mockEdit } from '$lib/server/mocks/fixtures';

// Session is enforced centrally in hooks.server.ts (guardedPaths).
export const POST: RequestHandler = async ({ request }) => {
	assertDevOnly();
	const parsed = await parseBody(request, editRequestSchema);
	if (!parsed.ok) return parsed.response;
	return json(mockEdit());
};
