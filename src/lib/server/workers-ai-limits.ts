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

import type { WorkersAiDailyUsage } from '$lib/api/contract';
import {
	AnalyticsError,
	analyticsAccess,
	analyticsErrorType,
	isRecord,
	metric,
	queryAccountAnalytics
} from '$lib/server/cloudflare-analytics';

// Workers AI's free allocation: 10,000 Neurons per day, reset at 00:00 UTC
// (https://developers.cloudflare.com/workers-ai/platform/pricing/).
export const WORKERS_AI_DAILY_NEURON_LIMIT = 10_000;

// `aiInferenceAdaptiveGroups` is the dataset behind the dashboard's "Neurons
// used today"; it is in the account's GraphQL schema though not yet listed in
// Cloudflare's docs. One group per model, so the day's total is their sum.
const DAILY_USAGE_QUERY = `
	query WorkersAiDailyUsage($accountTag: string!, $date: Date!) {
		viewer {
			accounts(filter: { accountTag: $accountTag }) {
				aiInferenceAdaptiveGroups(
					limit: 100
					filter: { date_geq: $date, date_leq: $date }
				) {
					count
					sum {
						totalNeurons
					}
				}
			}
		}
	}
`;

function parseUsage(
	account: Record<string, unknown>
): Pick<WorkersAiDailyUsage, 'requests' | 'neurons'> | undefined {
	if (!Array.isArray(account.aiInferenceAdaptiveGroups)) return undefined;

	let requests = 0;
	let neurons = 0;
	for (const group of account.aiInferenceAdaptiveGroups) {
		if (!isRecord(group) || !isRecord(group.sum)) return undefined;
		const groupRequests = metric(group.count);
		const groupNeurons = metric(group.sum.totalNeurons);
		if (groupRequests === undefined || groupNeurons === undefined) return undefined;
		requests += groupRequests;
		neurons += groupNeurons;
	}
	return { requests, neurons };
}

export async function getWorkersAiDailyUsage(
	env: App.Platform['env'] | undefined,
	fetcher: typeof fetch
): Promise<WorkersAiDailyUsage | null> {
	const access = analyticsAccess(env);
	if (!access) {
		console.warn(JSON.stringify({ event: 'workers_ai_quota_configuration_invalid' }));
		return null;
	}

	try {
		const date = new Date().toISOString().slice(0, 10);
		const usage = parseUsage(await queryAccountAnalytics(access, fetcher, DAILY_USAGE_QUERY, date));
		if (!usage) throw new AnalyticsError('response');
		return { date, ...usage, neuronLimit: WORKERS_AI_DAILY_NEURON_LIMIT };
	} catch (error) {
		console.error(
			JSON.stringify({ event: 'workers_ai_quota_check_failed', error: analyticsErrorType(error) })
		);
		return null;
	}
}
