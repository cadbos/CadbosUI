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

const PROBE_TIMEOUT_MS = 10_000;
const DEFAULT_GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql';
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

interface Config {
	accountId: string;
	apiToken: string;
	graphqlUrl: string;
	readLimit: number;
	writeLimit: number;
}

class AnalyticsError extends Error {
	constructor(reason: 'http' | 'response') {
		super(reason);
		this.name = 'AnalyticsError';
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveInteger(value: string | undefined): number | undefined {
	if (!value?.trim()) return undefined;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function configuredLimit(value: string | undefined, defaultValue: number): number | undefined {
	return value === undefined ? defaultValue : positiveInteger(value);
}

function httpsUrl(value: string | undefined): string | undefined {
	if (!value?.trim()) return undefined;
	try {
		const url = new URL(value);
		return url.protocol === 'https:' ? url.href : undefined;
	} catch {
		return undefined;
	}
}

function config(env: App.Platform['env'] | undefined): Config | undefined {
	const accountId = env?.CLOUDFLARE_ACCOUNT_ID?.trim();
	const apiToken = env?.CLOUDFLARE_ANALYTICS_API_TOKEN?.trim();
	const graphqlUrl = httpsUrl(env?.CLOUDFLARE_GRAPHQL_URL ?? DEFAULT_GRAPHQL_URL);
	const readLimit = configuredLimit(env?.D1_DAILY_ROWS_READ_LIMIT, DEFAULT_READ_LIMIT);
	const writeLimit = configuredLimit(env?.D1_DAILY_ROWS_WRITTEN_LIMIT, DEFAULT_WRITE_LIMIT);
	if (
		!accountId ||
		!apiToken ||
		!graphqlUrl ||
		readLimit === undefined ||
		writeLimit === undefined
	) {
		console.warn(JSON.stringify({ event: 'd1_quota_configuration_invalid' }));
		return undefined;
	}
	return { accountId, apiToken, graphqlUrl, readLimit, writeLimit };
}

function metric(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function parseUsage(payload: unknown): Pick<D1DailyLimits, 'rowsRead' | 'rowsWritten'> | undefined {
	if (!isRecord(payload)) return undefined;
	if (Array.isArray(payload.errors) && payload.errors.length > 0) return undefined;
	const data = payload.data;
	if (!isRecord(data) || !isRecord(data.viewer) || !Array.isArray(data.viewer.accounts)) {
		return undefined;
	}
	if (data.viewer.accounts.length !== 1) return undefined;
	const account = data.viewer.accounts[0];
	if (!isRecord(account) || !Array.isArray(account.d1AnalyticsAdaptiveGroups)) return undefined;

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
	fetcher: typeof fetch
): Promise<D1DailyLimits | null> {
	const configured = config(env);
	if (!configured) return null;

	try {
		const date = new Date().toISOString().slice(0, 10);
		const response = await fetcher(configured.graphqlUrl, {
			method: 'POST',
			headers: {
				authorization: `Bearer ${configured.apiToken}`,
				'content-type': 'application/json'
			},
			body: JSON.stringify({
				query: DAILY_USAGE_QUERY,
				variables: { accountTag: configured.accountId, date }
			}),
			signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
		});
		if (!response.ok) throw new AnalyticsError('http');
		const usage = parseUsage(await response.json());
		if (!usage) throw new AnalyticsError('response');
		return { date, ...usage, readLimit: configured.readLimit, writeLimit: configured.writeLimit };
	} catch (error) {
		const errorType =
			error instanceof AnalyticsError
				? error.message
				: error instanceof Error
					? error.name
					: typeof error;
		console.error(JSON.stringify({ event: 'd1_quota_check_failed', error: errorType }));
		return null;
	}
}
