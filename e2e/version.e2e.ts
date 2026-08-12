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

import { execFileSync } from 'node:child_process';
import { expect, test } from './fixtures';

import packageMetadata from '../package.json' with { type: 'json' };

const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const shortCommitSha = commitSha.slice(0, 7);
const commitUrl = `https://github.com/cadbos/CadbosUI/commit/${commitSha}`;
const releaseUrl = `https://github.com/cadbos/CadbosUI/releases/tag/v${packageMetadata.version}`;
const isPreview = process.env.PLAYWRIGHT_BUILD_MODE === 'preview';
const currentVersion = isPreview ? shortCommitSha : packageMetadata.version;
const currentVersionUrl = isPreview ? commitUrl : releaseUrl;
const releaseStage = isPreview ? 'Предварительная сборка' : 'Стабильный выпуск';

test('shows localized release and build metadata at /version', async ({ page }) => {
	const response = await page.goto('/version');

	expect(response?.status()).toBe(200);
	await expect(page).toHaveURL(/\/version$/);
	await expect(page).toHaveTitle('Версия приложения');

	const main = page.getByRole('main');
	const currentVersionPanel = main.locator('.current-version');
	const versionDetails = main.locator('.version-details');
	await expect(main.getByRole('heading', { name: 'Версия приложения' })).toBeVisible();
	await expect(main.getByText(packageMetadata.name, { exact: true })).toBeVisible();
	await expect(currentVersionPanel.getByText(currentVersion, { exact: true })).toBeVisible();
	await expect(currentVersionPanel.getByText(releaseStage, { exact: true })).toBeVisible();
	await expect(versionDetails.getByText(shortCommitSha, { exact: true })).toBeVisible();
	await expect(main.getByText('Стадия выпуска', { exact: true })).toHaveCount(0);

	const versionLink = currentVersionPanel.getByRole('link', { name: currentVersion, exact: true });
	const shortCommitLink = versionDetails.getByRole('link', { name: shortCommitSha, exact: true });

	await expect(versionLink).toHaveAttribute('href', currentVersionUrl);
	await expect(versionLink).toHaveAttribute('title', currentVersionUrl);
	await expect(versionLink).toHaveAttribute('target', '_blank');
	await expect(versionLink).toHaveAttribute('rel', 'external noopener noreferrer');
	await expect(shortCommitLink).toHaveAttribute('href', commitUrl);
	await expect(shortCommitLink).toHaveAttribute('title', commitUrl);
	await expect(shortCommitLink).toHaveAttribute('target', '_blank');
	await expect(shortCommitLink).toHaveAttribute('rel', 'external noopener noreferrer');

	const buildTime = main.locator('time');
	await expect(buildTime).toHaveAttribute(
		'datetime',
		/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
	);
});

test('/version remains outside the workspace', async ({ page }) => {
	await page.goto('/version');
	await page.waitForTimeout(500);

	await expect(page).toHaveURL(/\/version$/);
	await expect(page.getByRole('tab')).toHaveCount(0);
});
