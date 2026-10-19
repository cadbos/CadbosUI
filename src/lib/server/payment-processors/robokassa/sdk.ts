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

const DEFAULT_HASH_METHOD = 'md5';
const ALLOWED_HASH_METHODS: HashAlgorithm[] = [DEFAULT_HASH_METHOD, 'sha256', 'sha512'];

export interface RobokassaSettings {
	is_test: number;
	hash_algorithm: HashAlgorithm;
}

function requiredCredential(name: string, value: string | undefined): string {
	if (!value?.trim()) throw new Error(`${name} not configured`);
	return value;
}

export function resolveSdk(
	platform: App.Platform | undefined,
	saved?: RobokassaSettings,
	fetcher: typeof fetch = fetch
): { client: RobokassaClient; settings: RobokassaSettings } {
	const env = platform?.env;
	const login = requiredCredential('ROBOKASSA_LOGIN', env?.ROBOKASSA_LOGIN);
	const password1 = requiredCredential('ROBOKASSA_PASSWORD1', env?.ROBOKASSA_PASSWORD1);
	const password2 = requiredCredential('ROBOKASSA_PASSWORD2', env?.ROBOKASSA_PASSWORD2);
	const testPassword1 = requiredCredential(
		'ROBOKASSA_TEST_PASSWORD1',
		env?.ROBOKASSA_TEST_PASSWORD1
	);
	const testPassword2 = requiredCredential(
		'ROBOKASSA_TEST_PASSWORD2',
		env?.ROBOKASSA_TEST_PASSWORD2
	);
	const mode = env?.ROBOKASSA_IS_TEST;
	if (!saved && mode !== undefined && mode !== 'true' && mode !== 'false')
		throw new Error('ROBOKASSA_IS_TEST must be true or false');
	const hash = saved?.hash_algorithm ?? (env?.ROBOKASSA_HASH_ALGORITHM || DEFAULT_HASH_METHOD);
	const hashAlgorithm = ALLOWED_HASH_METHODS.find((method) => method === hash);
	if (!hashAlgorithm) throw new Error('ROBOKASSA_HASH_ALGORITHM must be md5, sha256, sha512');
	const settings: RobokassaSettings = {
		is_test: (saved ? saved.is_test === 1 : mode !== 'false') ? 1 : 0,
		hash_algorithm: hashAlgorithm
	};
	return {
		client: new RobokassaClient({
			login,
			password1,
			password2,
			testPassword1,
			testPassword2,
			isTest: settings.is_test === 1,
			hashAlgorithm: settings.hash_algorithm,
			fetch: fetcher
		}),
		settings
	};
}
