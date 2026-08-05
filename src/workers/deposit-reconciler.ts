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
import {
	reconcileClaimedDeposit,
	type DepositReconciliationOptions
} from '$lib/server/deposit-reconciliation';
import type { LnbitsConfig } from '$lib/server/lnbits';
import { claimDepositsForReconciliation, INVOICE_CREATION_LEASE_MS } from '$lib/server/payments';

const RECONCILIATION_BATCH_SIZE = 25;
const RECONCILIATION_CONCURRENCY = 5;

export interface DepositReconcilerEnv {
	DB: D1Database;
	LNBITS_BASE_URL: string;
	LNBITS_INVOICE_KEY: string;
	PAYMENTS_WEBHOOK_URL?: string;
}

export interface DepositReconciliationSummary {
	claimed: number;
	paid: number;
	pending: number;
	terminal: number;
	errors: number;
}

export interface ReconcileDueDepositsOptions {
	reconcile?: typeof reconcileClaimedDeposit;
	provider?: Omit<DepositReconciliationOptions, 'now'>;
}

function configFrom(env: DepositReconcilerEnv): LnbitsConfig {
	if (!env.LNBITS_BASE_URL || !env.LNBITS_INVOICE_KEY) {
		throw new Error('LNbits is not configured');
	}
	return {
		baseUrl: env.LNBITS_BASE_URL,
		invoiceKey: env.LNBITS_INVOICE_KEY,
		...(env.PAYMENTS_WEBHOOK_URL ? { webhookUrl: env.PAYMENTS_WEBHOOK_URL } : {})
	};
}

export async function reconcileDueDeposits(
	env: DepositReconcilerEnv,
	now: number = Date.now(),
	options: ReconcileDueDepositsOptions = {}
): Promise<DepositReconciliationSummary> {
	const config = configFrom(env);
	const deposits = await claimDepositsForReconciliation(
		env.DB,
		now,
		now + INVOICE_CREATION_LEASE_MS,
		RECONCILIATION_BATCH_SIZE
	);
	const summary: DepositReconciliationSummary = {
		claimed: deposits.length,
		paid: 0,
		pending: 0,
		terminal: 0,
		errors: 0
	};
	const reconcile = options.reconcile ?? reconcileClaimedDeposit;

	for (let offset = 0; offset < deposits.length; offset += RECONCILIATION_CONCURRENCY) {
		const batch = deposits.slice(offset, offset + RECONCILIATION_CONCURRENCY);
		const results = await Promise.allSettled(
			batch.map((deposit) => reconcile(env.DB, deposit, config, { ...options.provider, now }))
		);
		for (const result of results) {
			if (result.status === 'rejected') summary.errors += 1;
			else if (result.value.status === 'paid') summary.paid += 1;
			else if (result.value.status === 'creating' || result.value.status === 'pending') {
				summary.pending += 1;
			} else summary.terminal += 1;
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
				.catch((error: unknown) => {
					console.error('Deposit reconciliation run failed:', {
						errorName: error instanceof Error ? error.name : 'Error'
					});
					throw error;
				})
		);
	}
} satisfies ExportedHandler<DepositReconcilerEnv>;
