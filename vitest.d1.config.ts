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

import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
	const migrations = await readD1Migrations(path.resolve('migrations'));
	return {
		plugins: [
			cloudflareTest({
				miniflare: {
					compatibilityDate: '2026-06-26',
					compatibilityFlags: ['nodejs_compat'],
					d1Databases: ['DB'],
					bindings: { TEST_MIGRATIONS: migrations }
				}
			})
		],
		resolve: { alias: { $lib: path.resolve('src/lib') } },
		test: {
			expect: { requireAssertions: true },
			include: ['d1-tests/**/*.test.ts'],
			setupFiles: ['./d1-tests/apply-migrations.ts']
		}
	};
});
