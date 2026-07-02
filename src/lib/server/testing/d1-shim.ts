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

// Minimal D1Database shim over node:sqlite, shared by server-side tests that need
// to exercise real SQL (atomic upserts, RETURNING, UNIQUE constraints) against the
// auth/billing schema without a Workers runtime. Test-only — never imported from
// production code.

import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { D1Database } from '@cloudflare/workers-types';

const SCHEMA = readFileSync(
	new URL('../../../../migrations/0001_auth.sql', import.meta.url),
	'utf8'
);

export function makeD1(): D1Database {
	const db = new DatabaseSync(':memory:');
	db.exec(SCHEMA);
	const stmt = (sql: string, args: SQLInputValue[] = []) => ({
		bind: (...next: SQLInputValue[]) => stmt(sql, next),
		run: () => ({ success: true, meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
		first: (col?: string) => {
			const row = db.prepare(sql).get(...args) as Record<string, unknown> | undefined;
			if (row === undefined) return null;
			return col ? row[col] : row;
		}
	});
	return { prepare: (sql: string) => stmt(sql) } as unknown as D1Database;
}
