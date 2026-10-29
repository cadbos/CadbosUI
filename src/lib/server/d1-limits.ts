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

import type { D1DailyLimits } from '$lib/api/contract';
import {
	AnalyticsError,
	analyticsAccess,
	analyticsErrorType,
	isRecord,
	metric,
	queryAccountAnalytics,
	type AnalyticsAccess
} from '$lib/server/cloudflare-analytics';

const DEFAULT_READ_LIMIT = 5_000_000;
const DEFAULT_WRITE_LIMIT = 100_000;
const DAILY_USAGE_QUERY = `
	query D1DailyUsage($accountTag: string!, $date: Date!) {
		viewer {
			accounts(filter: { accountTag: $accountTag }) {
				d1AnalyticsAdaptiveGroups(
					limit: 1
					filter: { date_geq: $date, date_leq: $date }
				) {
					sum {
						rowsRead
						rowsWritten
					}
				}
			}
		}
	}
`;

interface Config extends AnalyticsAccess {
	readLimit: number;
	writeLimit: number;
}

function positiveInteger(value: string | undefined): number | undefined {
	if (!value?.trim()) return undefined;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function configuredLimit(value: string | undefined, defaultValue: number): number | undefined {
	return value === undefined ? defaultValue : positiveInteger(value);
}

function config(env: App.Platform['env'] | undefined): Config | undefined {
	const access = analyticsAccess(env);
	const readLimit = configuredLimit(env?.D1_DAILY_ROWS_READ_LIMIT, DEFAULT_READ_LIMIT);
	const writeLimit = configuredLimit(env?.D1_DAILY_ROWS_WRITTEN_LIMIT, DEFAULT_WRITE_LIMIT);
	if (!access || readLimit === undefined || writeLimit === undefined) {
		console.warn(JSON.stringify({ event: 'd1_quota_configuration_invalid' }));
		return undefined;
	}
	return { ...access, readLimit, writeLimit };
}

function parseUsage(
	account: Record<string, unknown>
): Pick<D1DailyLimits, 'rowsRead' | 'rowsWritten'> | undefined {
	if (!Array.isArray(account.d1AnalyticsAdaptiveGroups)) return undefined;

	let rowsRead = 0;
	let rowsWritten = 0;
	for (const group of account.d1AnalyticsAdaptiveGroups) {
		if (!isRecord(group) || !isRecord(group.sum)) return undefined;
		const groupRowsRead = metric(group.sum.rowsRead);
		const groupRowsWritten = metric(group.sum.rowsWritten);
		if (groupRowsRead === undefined || groupRowsWritten === undefined) return undefined;
		rowsRead += groupRowsRead;
		rowsWritten += groupRowsWritten;
	}
	return { rowsRead, rowsWritten };
}

export async function getD1DailyLimits(
	env: App.Platform['env'] | undefined,
	fetcher: typeof fetch,
	// A UTC calendar date (YYYY-MM-DD); today when omitted.
	date = new Date().toISOString().slice(0, 10)
): Promise<D1DailyLimits | null> {
	const configured = config(env);
	if (!configured) return null;

	try {
		const usage = parseUsage(
			await queryAccountAnalytics(configured, fetcher, DAILY_USAGE_QUERY, date)
		);
		if (!usage) throw new AnalyticsError('response');
		return { date, ...usage, readLimit: configured.readLimit, writeLimit: configured.writeLimit };
	} catch (error) {
		console.error(
			JSON.stringify({ event: 'd1_quota_check_failed', error: analyticsErrorType(error) })
		);
		return null;
	}
}
