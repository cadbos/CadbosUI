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

import { sql } from 'drizzle-orm';
import type { Database } from '$lib/server/db';

// Seeds an entirely separate user's own project+session and returns the
// session id — the "foreign session" every generation-writing route's
// assertSessionOwnedByUser guard (projects.ts) must reject with 404
// session_not_found. Shared by the render/edit/style-transfer/upscale/
// object-replacement/texture-replacement route test suites so this seed
// shape (and the IDOR test built on it) isn't reinvented per file.
export async function seedForeignSession(db: Database): Promise<string> {
	const suffix = crypto.randomUUID();
	const foreignUserId = `foreign-user-${suffix}`;
	const foreignPubkey = suffix.replace(/-/g, '').padEnd(64, '0').slice(0, 64);
	const now = Date.now();

	await db.run(
		sql`INSERT INTO users (id, pubkey, created_at) VALUES (${foreignUserId}, ${foreignPubkey}, ${now})`
	);

	const projectId = `foreign-project-${suffix}`;
	await db.run(
		sql`INSERT INTO projects (id, user_id, title, created_at, updated_at) VALUES (${projectId}, ${foreignUserId}, 'Foreign project', ${now}, ${now})`
	);

	const sessionId = crypto.randomUUID();
	await db.run(
		sql`INSERT INTO project_sessions (id, project_id, title, created_at, updated_at) VALUES (${sessionId}, ${projectId}, 'Foreign session', ${now}, ${now})`
	);

	return sessionId;
}
