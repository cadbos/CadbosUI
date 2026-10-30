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

import { nsecEncode, npubEncode } from 'nostr-tools/nip19';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';

export interface AccountKeyPair {
	secretKey: Uint8Array;
	npub: string;
	nsec: string;
}

export interface AccountKeyFile {
	title: string;
	publicLabel: string;
	publicKey: string;
	secretLabel: string;
	secretKey: string;
	warning: string;
}

export function createAccountKey(): AccountKeyPair {
	const secretKey = generateSecretKey();
	return {
		secretKey,
		npub: npubEncode(getPublicKey(secretKey)),
		nsec: nsecEncode(secretKey)
	};
}

export function formatAccountKeyFile(file: AccountKeyFile): string {
	return [
		file.title,
		'',
		file.publicLabel,
		file.publicKey,
		'',
		file.secretLabel,
		file.secretKey,
		'',
		file.warning,
		''
	].join('\n');
}
