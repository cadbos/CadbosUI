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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRobokassaClient } from './client';

const sdkConstructor = vi.hoisted(() =>
	vi.fn().mockImplementation(function RobokassaClientMock() {})
);

vi.mock('@robokassa/sdk', () => ({ RobokassaClient: sdkConstructor }));

const credentials = {
	ROBOKASSA_LOGIN: 'merchant',
	ROBOKASSA_PASSWORD1: 'production-one',
	ROBOKASSA_PASSWORD2: 'production-two',
	ROBOKASSA_TEST_PASSWORD1: 'test-one',
	ROBOKASSA_TEST_PASSWORD2: 'test-two'
};

function platform(overrides: Record<string, string | undefined> = {}): App.Platform {
	return { env: { ...credentials, ...overrides } } as App.Platform;
}

describe('Robokassa client configuration', () => {
	beforeEach(() => {
		sdkConstructor.mockClear();
	});

	it('constructs a processor with test mode and md5 by default', () => {
		const processor = createRobokassaClient(platform());
		expect(processor.id).toBe('robokassa');
		expect(sdkConstructor).toHaveBeenCalledExactlyOnceWith({
			login: 'merchant',
			password1: 'production-one',
			password2: 'production-two',
			testPassword1: 'test-one',
			testPassword2: 'test-two',
			isTest: true,
			hashAlgorithm: 'md5'
		});
	});

	it('sets production mode only when explicitly selected', () => {
		createRobokassaClient(platform({ ROBOKASSA_IS_TEST: 'false' }));
		expect(sdkConstructor).toHaveBeenCalledWith(expect.objectContaining({ isTest: false }));
	});

	it('uses the configured hash algorithm', () => {
		createRobokassaClient(platform({ ROBOKASSA_HASH_ALGORITHM: 'sha256' }));
		expect(sdkConstructor).toHaveBeenCalledWith(
			expect.objectContaining({ hashAlgorithm: 'sha256' })
		);
	});

	it.each(Object.keys(credentials))('rejects missing %s', (name) => {
		expect(() => createRobokassaClient(platform({ [name]: '' }))).toThrow(`${name} not configured`);
	});

	it('rejects invalid mode and hash values', () => {
		expect(() => createRobokassaClient(platform({ ROBOKASSA_IS_TEST: '1' }))).toThrow(
			'ROBOKASSA_IS_TEST must be true or false'
		);
		expect(() => createRobokassaClient(platform({ ROBOKASSA_HASH_ALGORITHM: 'sha1' }))).toThrow(
			'ROBOKASSA_HASH_ALGORITHM must be md5, sha256, sha512'
		);
	});

	it('rejects missing platform configuration', () => {
		expect(() => createRobokassaClient(undefined)).toThrow('ROBOKASSA_LOGIN not configured');
		expect(sdkConstructor).not.toHaveBeenCalled();
	});

	it('rejects unfinished payment methods', async () => {
		const processor = createRobokassaClient(platform());
		const invoice = { id: '42', amountMinor: 1000, currency: 'RUB' };

		await expect(processor.createInvoice(invoice)).rejects.toThrow(
			'Robokassa invoice creation is not implemented'
		);
		await expect(processor.cancelInvoice(invoice)).rejects.toThrow(
			'Robokassa invoice cancellation is not implemented'
		);
		await expect(
			processor.handleWebhook(new Request('https://example.test/webhook'))
		).rejects.toThrow('Robokassa webhook handling is not implemented');
	});
});
