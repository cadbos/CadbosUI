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

import type {
	D1Database,
	ExecutionContext,
	ExportedHandler,
	ScheduledController
} from '@cloudflare/workers-types';
import { reconcileDeposit } from '$lib/server/deposit-reconciliation';
import { parseNwcConnectionString } from '$lib/server/lightning';
import { claimDepositsForReconciliation } from '$lib/server/payments';

const RECONCILIATION_BATCH_SIZE = 20;
const RECONCILIATION_CONCURRENCY = 5;
const RECONCILIATION_LEASE_MS = 120_000;

interface DepositReconcilerEnv {
	DB: D1Database;
	NWC_CONNECTION_STRING?: string;
}

export interface DepositReconciliationSummary {
	claimed: number;
	paid: number;
	pending: number;
	terminal: number;
	errors: number;
}

export async function reconcileDueDeposits(
	env: DepositReconcilerEnv,
	now: number = Date.now()
): Promise<DepositReconciliationSummary> {
	if (!env.NWC_CONNECTION_STRING) {
		throw new Error('NWC connection is not configured for deposit reconciliation');
	}

	const connection = parseNwcConnectionString(env.NWC_CONNECTION_STRING);
	const deposits = await claimDepositsForReconciliation(
		env.DB,
		now,
		now + RECONCILIATION_LEASE_MS,
		RECONCILIATION_BATCH_SIZE
	);
	const summary: DepositReconciliationSummary = {
		claimed: deposits.length,
		paid: 0,
		pending: 0,
		terminal: 0,
		errors: 0
	};

	for (let offset = 0; offset < deposits.length; offset += RECONCILIATION_CONCURRENCY) {
		const batch = deposits.slice(offset, offset + RECONCILIATION_CONCURRENCY);
		const results = await Promise.allSettled(
			batch.map((deposit) => reconcileDeposit(env.DB, deposit, connection, { now }))
		);

		for (const result of results) {
			if (result.status === 'rejected') {
				summary.errors += 1;
				console.error('Deposit reconciliation item failed:', {
					operation: 'lookup_invoice',
					errorName: result.reason instanceof Error ? result.reason.name : 'UnknownError'
				});
			} else if (result.value.status === 'paid') {
				summary.paid += 1;
			} else if (result.value.status === 'pending') {
				summary.pending += 1;
			} else {
				summary.terminal += 1;
			}
		}
	}

	return summary;
}

export default {
	async scheduled(
		controller: ScheduledController,
		env: DepositReconcilerEnv,
		ctx: ExecutionContext
	): Promise<void> {
		ctx.waitUntil(
			reconcileDueDeposits(env, controller.scheduledTime)
				.then((summary) => console.info('Deposit reconciliation completed:', summary))
				.catch((err: unknown) => {
					console.error('Deposit reconciliation run failed:', {
						errorName: err instanceof Error ? err.name : 'UnknownError'
					});
					throw err;
				})
		);
	}
} satisfies ExportedHandler<DepositReconcilerEnv>;
