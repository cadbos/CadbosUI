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

import type { InvoiceCheckout, PaymentProcessorRecord } from '$lib/api/contract';
import type { Database } from '$lib/server/db';
import type { PaymentProcessor } from './interface';
import { createRobokassaClient, getRobokassaCheckout } from './robokassa/client';
import { resolveSdk } from './robokassa/sdk';
import { getRemainingTestDeposit, getTestDepositLimit } from './robokassa/test-deposit-limit';

export interface PaymentProcessorRegistration extends Omit<
	PaymentProcessorRecord,
	'maxAmountMinor'
> {
	validateConfiguration: (platform: App.Platform | undefined) => void;
	getMaxAmountMinor: (
		db: Database,
		platform: App.Platform | undefined,
		userId: string
	) => Promise<number | null>;
	createClient: (platform: App.Platform | undefined) => PaymentProcessor<unknown>;
	getCheckout: (db: Database, invoiceId: string) => Promise<InvoiceCheckout | null>;
}

export const paymentProcessors: readonly PaymentProcessorRegistration[] = [
	{
		id: 'robokassa',
		invoiceCurrencies: ['USD'],
		paymentCurrencies: ['RUB'],
		validateConfiguration: (platform) => {
			resolveSdk(platform);
		},
		getMaxAmountMinor: async (db, platform, userId) =>
			resolveSdk(platform).settings.is_test === 1
				? getRemainingTestDeposit(db, userId, getTestDepositLimit(platform))
				: null,
		createClient: createRobokassaClient,
		getCheckout: getRobokassaCheckout
	}
];

export async function listPaymentProcessors(
	db: Database,
	platform: App.Platform | undefined,
	userId: string,
	registry: readonly PaymentProcessorRegistration[] = paymentProcessors
): Promise<PaymentProcessorRecord[]> {
	const configured = registry.filter((processor) => {
		try {
			processor.validateConfiguration(platform);
			return true;
		} catch (error) {
			console.warn('Payment processor configuration unavailable', {
				processor: processor.id,
				errorType: error instanceof Error ? error.name : typeof error
			});
			return false;
		}
	});
	return Promise.all(
		configured.map(async (processor) => ({
			id: processor.id,
			invoiceCurrencies: processor.invoiceCurrencies,
			paymentCurrencies: processor.paymentCurrencies,
			maxAmountMinor: await processor.getMaxAmountMinor(db, platform, userId)
		}))
	);
}
