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
import { logBoundaryError } from '$lib/utils';

export const ACCOUNT_KEY_STORAGE = 'cadbos.localAccountKey';
export const ACCOUNT_KEY_FILENAME = 'cadbos-account-key.txt';

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

type KeyStorage = Pick<Storage, 'getItem' | 'setItem'>;

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

export function rememberAccountKey(secretKey: Uint8Array, storage?: KeyStorage): boolean {
	const target = resolveStorage(storage);
	if (!target) return false;
	try {
		target.setItem(ACCOUNT_KEY_STORAGE, bytesToHex(secretKey));
		return true;
	} catch (error) {
		logBoundaryError('localKey.remember', error);
		return false;
	}
}

export function readRememberedAccountKey(storage?: KeyStorage): Uint8Array | null {
	const target = resolveStorage(storage);
	if (!target) return null;
	try {
		const raw = target.getItem(ACCOUNT_KEY_STORAGE);
		if (raw === null || !/^[0-9a-f]{64}$/.test(raw)) return null;
		return hexToBytes(raw);
	} catch (error) {
		logBoundaryError('localKey.read', error);
		return null;
	}
}

function resolveStorage(storage?: KeyStorage): KeyStorage | null {
	if (storage) return storage;
	try {
		return localStorage;
	} catch (error) {
		logBoundaryError('localKey.storage', error);
		return null;
	}
}

function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
	const bytes = new Uint8Array(hex.length / 2);
	for (let index = 0; index < bytes.length; index += 1) {
		bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
	}
	return bytes;
}
