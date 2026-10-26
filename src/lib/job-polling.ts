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

import { z } from 'zod';

const retryAfterSchema = z
	.string()
	.trim()
	.min(1)
	.pipe(
		z.union([
			z.coerce.number<string>().transform((seconds) => seconds * 1_000),
			z.coerce.date<string>().transform((date) => date.getTime() - Date.now())
		])
	)
	.pipe(z.number());

export function parseRetryAfter(headers: Headers): number {
	const parsed = retryAfterSchema.safeParse(headers.get('retry-after'));
	if (!parsed.success) return 2_000;
	return Math.min(Math.max(parsed.data, 1_000), 2_147_483_647);
}
