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

import { describe, expect, it } from 'vitest';
import { decode } from 'nostr-tools/nip19';
import { getPublicKey } from 'nostr-tools/pure';
import { createAccountKey, formatAccountKeyFile } from './local-key';

describe('local account key', () => {
	it('creates a key pair the public key is derived from', () => {
		const pair = createAccountKey();
		const decoded = decode(pair.nsec);
		expect(decoded.type).toBe('nsec');
		if (decoded.type !== 'nsec') return;
		expect(Array.from(decoded.data)).toEqual(Array.from(pair.secretKey));
		const decodedNpub = decode(pair.npub);
		expect(decodedNpub.type).toBe('npub');
		if (decodedNpub.type !== 'npub') return;
		expect(decodedNpub.data).toBe(getPublicKey(pair.secretKey));
	});

	it('writes a file that contains both keys and the warning', () => {
		const text = formatAccountKeyFile({
			title: 'Ключ аккаунта Cadbos',
			publicLabel: 'Публичный ключ',
			publicKey: 'npub1example',
			secretLabel: 'Секретный ключ',
			secretKey: 'nsec1example',
			warning: 'Cadbos не может его восстановить.'
		});
		expect(text).toContain('npub1example');
		expect(text).toContain('nsec1example');
		expect(text).toContain('Cadbos не может его восстановить.');
	});
});
