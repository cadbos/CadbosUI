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

export const DEFAULT_HASH_METHOD = 'md5';
const ALLOWED_HASH_METHODS: HashAlgorithm[] = [DEFAULT_HASH_METHOD, 'sha256', 'sha512'];

export interface RobokassaSettings {
	is_test: number;
	hash_algorithm: HashAlgorithm;
}

export function sdkClient(
	platform: App.Platform | undefined,
	saved?: RobokassaSettings,
	fetcher: typeof fetch = fetch
): RobokassaClient {
	const env = platform?.env;
	for (const name of [
		'ROBOKASSA_LOGIN',
		'ROBOKASSA_PASSWORD1',
		'ROBOKASSA_PASSWORD2',
		'ROBOKASSA_TEST_PASSWORD1',
		'ROBOKASSA_TEST_PASSWORD2'
	] as const) {
		if (!env?.[name]?.trim()) throw new Error(`${name} not configured`);
	}
	const mode = env?.ROBOKASSA_IS_TEST;
	if (!saved && mode !== undefined && mode !== 'true' && mode !== 'false')
		throw new Error('ROBOKASSA_IS_TEST must be true or false');
	const hash = saved?.hash_algorithm ?? (env?.ROBOKASSA_HASH_ALGORITHM || DEFAULT_HASH_METHOD);
	if (!(ALLOWED_HASH_METHODS as string[]).includes(hash))
		throw new Error('ROBOKASSA_HASH_ALGORITHM must be md5, sha256, sha512');
	return new RobokassaClient({
		login: env!.ROBOKASSA_LOGIN!,
		password1: env!.ROBOKASSA_PASSWORD1!,
		password2: env!.ROBOKASSA_PASSWORD2!,
		testPassword1: env!.ROBOKASSA_TEST_PASSWORD1!,
		testPassword2: env!.ROBOKASSA_TEST_PASSWORD2!,
		isTest: saved ? saved.is_test === 1 : mode !== 'false',
		hashAlgorithm: hash as HashAlgorithm,
		fetch: fetcher
	});
}
