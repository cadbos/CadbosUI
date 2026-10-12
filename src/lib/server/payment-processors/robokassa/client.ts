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

import { RobokassaClient, type HashAlgorithm } from '@robokassa/sdk';
import type { CancellationOutcome, PaymentProcessor, PaymentUrl } from '../interface';

const DEFAULT_HASH_METHOD = 'md5';
const ALLOWED_HASH_METHODS: HashAlgorithm[] = [DEFAULT_HASH_METHOD, 'sha256', 'sha512'];

class RobokassaPaymentProcessor implements PaymentProcessor {
	readonly id = 'robokassa';
	readonly client: RobokassaClient;

	constructor(platform: App.Platform | undefined) {
		const env = platform?.env;
		const login = env?.ROBOKASSA_LOGIN;
		const password1 = env?.ROBOKASSA_PASSWORD1;
		const password2 = env?.ROBOKASSA_PASSWORD2;
		const testPassword1 = env?.ROBOKASSA_TEST_PASSWORD1;
		const testPassword2 = env?.ROBOKASSA_TEST_PASSWORD2;

		if (!login?.trim()) throw new Error('ROBOKASSA_LOGIN not configured');
		if (!password1?.trim()) throw new Error('ROBOKASSA_PASSWORD1 not configured');
		if (!password2?.trim()) throw new Error('ROBOKASSA_PASSWORD2 not configured');
		if (!testPassword1?.trim()) throw new Error('ROBOKASSA_TEST_PASSWORD1 not configured');
		if (!testPassword2?.trim()) throw new Error('ROBOKASSA_TEST_PASSWORD2 not configured');

		const testMode = env?.ROBOKASSA_IS_TEST;
		if (testMode !== undefined && testMode !== 'true' && testMode !== 'false') {
			throw new Error('ROBOKASSA_IS_TEST must be true or false');
		}

		const configuredHash = env?.ROBOKASSA_HASH_ALGORITHM || DEFAULT_HASH_METHOD;
		if (!(ALLOWED_HASH_METHODS as string[]).includes(configuredHash)) {
			throw new Error(`ROBOKASSA_HASH_ALGORITHM must be ${ALLOWED_HASH_METHODS.join(', ')}`);
		}

		this.client = new RobokassaClient({
			login,
			password1,
			password2,
			testPassword1,
			testPassword2,
			isTest: testMode !== 'false',
			hashAlgorithm: configuredHash as HashAlgorithm
		});
	}

	async createInvoice(): Promise<PaymentUrl> {
		// TODO: Implement Robokassa invoice creation.
		throw new Error('Robokassa invoice creation is not implemented');
	}

	async cancelInvoice(): Promise<CancellationOutcome> {
		// TODO: Implement Robokassa invoice cancellation.
		throw new Error('Robokassa invoice cancellation is not implemented');
	}

	async handleWebhook(): Promise<Response> {
		// TODO: Implement Robokassa webhook handling.
		throw new Error('Robokassa webhook handling is not implemented');
	}
}

export function createRobokassaClient(platform: App.Platform | undefined): PaymentProcessor {
	return new RobokassaPaymentProcessor(platform);
}
