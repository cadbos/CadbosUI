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

export interface PaymentProcessorRegistration extends PaymentProcessorRecord {
	validateConfiguration: (platform: App.Platform | undefined) => void;
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
		createClient: createRobokassaClient,
		getCheckout: getRobokassaCheckout
	}
];

export function listPaymentProcessors(
	platform: App.Platform | undefined,
	registry: readonly PaymentProcessorRegistration[] = paymentProcessors
): PaymentProcessorRecord[] {
	return registry
		.filter((processor) => {
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
		})
		.map(({ id, invoiceCurrencies, paymentCurrencies }) => ({
			id,
			invoiceCurrencies,
			paymentCurrencies
		}));
}
