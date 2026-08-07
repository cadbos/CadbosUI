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

import { defineConfig } from '@playwright/test';

export default defineConfig({
	webServer: {
		command: 'pnpm run preview --host 127.0.0.1 --port 4174',
		port: 4174,
		timeout: 180_000
	},
	use: { baseURL: 'http://127.0.0.1:4174' },
	testDir: 'e2e',
	projects: [
		{
			name: 'ui',
			testMatch: '**/*.e2e.{ts,js}',
			testIgnore: '**/*.paid.e2e.{ts,js}'
		}
	]
});
