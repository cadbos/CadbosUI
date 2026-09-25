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

import type { D1Database } from '@cloudflare/workers-types';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';

export type Database = DrizzleD1Database;

export function createDb(binding: D1Database): Database {
	return drizzle(binding);
}

export function getDb(platform: App.Platform | undefined): Database {
	const binding = platform?.env?.DB;
	if (!binding) throw new Error('D1 binding "DB" is not available');
	return createDb(binding);
}
