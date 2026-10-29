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

import { resolveNostrRelays } from './nostr-relays';

describe('resolveNostrRelays', () => {
	it('preserves the current relay lists when settings are omitted', () => {
		expect(resolveNostrRelays({})).toEqual({
			connectRelays: ['wss://relay.damus.io', 'wss://nos.lol'],
			profileBootstrapRelays: [
				'wss://relay.damus.io',
				'wss://nos.lol',
				'wss://nostr.band',
				'wss://nostr-pub.wellorder.net'
			]
		});
	});

	it('uses custom login relays in the default profile list', () => {
		expect(resolveNostrRelays({ NOSTR_CONNECT_RELAYS: 'wss://login.example' })).toEqual({
			connectRelays: ['wss://login.example'],
			profileBootstrapRelays: [
				'wss://login.example',
				'wss://nostr.band',
				'wss://nostr-pub.wellorder.net'
			]
		});
	});

	it('replaces the additional profile relays while retaining default login relays', () => {
		expect(resolveNostrRelays({ NOSTR_PROFILE_BOOTSTRAP_RELAYS: 'wss://profile.example' })).toEqual(
			{
				connectRelays: ['wss://relay.damus.io', 'wss://nos.lol'],
				profileBootstrapRelays: ['wss://relay.damus.io', 'wss://nos.lol', 'wss://profile.example']
			}
		);
	});

	it('normalizes and deduplicates both overrides, preserving first occurrence order', () => {
		expect(
			resolveNostrRelays({
				NOSTR_CONNECT_RELAYS:
					' wss://LOGIN.example/ , ws://localhost:8080/relay , wss://login.example ',
				NOSTR_PROFILE_BOOTSTRAP_RELAYS:
					'wss://profile.example, wss://login.example/, wss://profile.example/'
			})
		).toEqual({
			connectRelays: ['wss://login.example', 'ws://localhost:8080/relay'],
			profileBootstrapRelays: [
				'wss://login.example',
				'ws://localhost:8080/relay',
				'wss://profile.example'
			]
		});
	});

	for (const variableName of ['NOSTR_CONNECT_RELAYS', 'NOSTR_PROFILE_BOOTSTRAP_RELAYS'] as const) {
		it.each([
			'',
			' ',
			',wss://valid.example',
			'wss://valid.example,',
			'wss://valid.example,,wss://other.example',
			'not-a-url',
			'https://relay.example',
			'wss://user:password@relay.example',
			'wss://relay.example?token=private',
			'wss://relay.example#private',
			'wss://relay.example?',
			'wss://relay.example#',
			'wss://*.example'
		])('rejects invalid %s in ' + variableName + ' without exposing the value', (value) => {
			const entryIndex = value.split(',').findIndex((entry) => !entry.trim()) + 1 || 1;
			expect(() => resolveNostrRelays({ [variableName]: value })).toThrow(
				new Error(
					`${variableName} entry ${entryIndex} must be a WebSocket URL without credentials, query strings, or fragments`
				)
			);
		});

		it('identifies an invalid entry after a valid relay in ' + variableName, () => {
			expect(() =>
				resolveNostrRelays({ [variableName]: 'wss://valid.example,https://invalid.example' })
			).toThrow(`${variableName} entry 2`);
		});
	}
});
