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

// Account-scoped queries against Cloudflare's GraphQL Analytics API, shared by
// the daily D1 and Workers AI quota checks.

const QUERY_TIMEOUT_MS = 10_000;
const DEFAULT_GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql';

export interface AnalyticsAccess {
	accountId: string;
	apiToken: string;
	graphqlUrl: string;
}

export class AnalyticsError extends Error {
	constructor(reason: 'http' | 'response') {
		super(reason);
		this.name = 'AnalyticsError';
	}
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function metric(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
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

export function analyticsAccess(env: App.Platform['env'] | undefined): AnalyticsAccess | undefined {
	const accountId = env?.CLOUDFLARE_ACCOUNT_ID?.trim();
	const apiToken = env?.CLOUDFLARE_ANALYTICS_API_TOKEN?.trim();
	const graphqlUrl = httpsUrl(env?.CLOUDFLARE_GRAPHQL_URL ?? DEFAULT_GRAPHQL_URL);
	if (!accountId || !apiToken || !graphqlUrl) return undefined;
	return { accountId, apiToken, graphqlUrl };
}

export function analyticsErrorType(error: unknown): string {
	if (error instanceof AnalyticsError) return error.message;
	return error instanceof Error ? error.name : typeof error;
}

// Runs `query` with `$accountTag` and `$date` bound and returns the single
// account node of `viewer.accounts`.
export async function queryAccountAnalytics(
	access: AnalyticsAccess,
	fetcher: typeof fetch,
	query: string,
	date: string
): Promise<Record<string, unknown>> {
	const response = await fetcher(access.graphqlUrl, {
		method: 'POST',
		headers: {
			authorization: `Bearer ${access.apiToken}`,
			'content-type': 'application/json'
		},
		body: JSON.stringify({ query, variables: { accountTag: access.accountId, date } }),
		signal: AbortSignal.timeout(QUERY_TIMEOUT_MS)
	});
	if (!response.ok) throw new AnalyticsError('http');

	const payload: unknown = await response.json();
	if (!isRecord(payload)) throw new AnalyticsError('response');
	if (Array.isArray(payload.errors) && payload.errors.length > 0) {
		throw new AnalyticsError('response');
	}
	const data = payload.data;
	if (!isRecord(data) || !isRecord(data.viewer) || !Array.isArray(data.viewer.accounts)) {
		throw new AnalyticsError('response');
	}
	if (data.viewer.accounts.length !== 1) throw new AnalyticsError('response');
	const account = data.viewer.accounts[0];
	if (!isRecord(account)) throw new AnalyticsError('response');
	return account;
}
