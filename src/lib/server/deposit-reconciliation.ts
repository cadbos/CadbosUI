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

import type { D1Database } from '@cloudflare/workers-types';
import { lookupInvoice, type InvoiceStatus, type NwcConnection } from '$lib/server/lightning';
import {
	DEPOSIT_RECONCILIATION_INTERVAL_MS,
	markDepositPaid,
	recordDepositInvoiceState,
	type Deposit
} from '$lib/server/payments';

export interface ReconcileDepositOptions {
	now?: number;
	lookup?: (connection: NwcConnection, paymentHash: string) => Promise<InvoiceStatus>;
}

export async function reconcileDeposit(
	db: D1Database,
	deposit: Deposit,
	connection: NwcConnection,
	options: ReconcileDepositOptions = {}
): Promise<Deposit> {
	const now = options.now ?? Date.now();
	const invoice = await (options.lookup ?? lookupInvoice)(connection, deposit.paymentHash);
	if (invoice.paymentHash !== deposit.paymentHash) {
		throw new Error('NWC lookup returned a mismatched payment hash');
	}

	let reconciled: Deposit | null;
	if (invoice.state === 'settled') {
		const paidAt = invoice.settledAt === null ? now : invoice.settledAt * 1000;
		reconciled = await markDepositPaid(db, deposit.paymentHash, paidAt, now);
	} else if (invoice.state === 'expired' || invoice.state === 'failed') {
		reconciled = await recordDepositInvoiceState(db, deposit.paymentHash, invoice.state, now, null);
	} else {
		reconciled = await recordDepositInvoiceState(
			db,
			deposit.paymentHash,
			'pending',
			now,
			now + DEPOSIT_RECONCILIATION_INTERVAL_MS
		);
	}

	if (!reconciled) throw new Error('Deposit disappeared during reconciliation');
	return reconciled;
}
