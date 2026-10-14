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

import jwt from 'jsonwebtoken';
import type { SessionUser } from '$lib/api/contract';

export function createFeaturebaseJwt(user: SessionUser, secret?: string): string | null {
	if (!secret?.trim()) {
		console.error(
			'Featurebase user identification disabled: FEATUREBASE_JWT_SECRET is not configured'
		);
		return null;
	}

	return jwt.sign({ userId: user.pubkey }, secret, { algorithm: 'HS256' });
}
