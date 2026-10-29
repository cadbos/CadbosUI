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

interface NostrRelayEnvironment {
	NOSTR_CONNECT_RELAYS?: string;
	NOSTR_PROFILE_BOOTSTRAP_RELAYS?: string;
}

interface NostrRelayConfiguration {
	connectRelays: string[];
	profileBootstrapRelays: string[];
}

const DEFAULT_CONNECT_RELAYS = 'wss://relay.damus.io,wss://nos.lol';
const DEFAULT_PROFILE_RELAYS = 'wss://nostr.band,wss://nostr-pub.wellorder.net';

function parseRelays(value: string, variableName: string): string[] {
	const relays = value.split(',').map((entry, index) => {
		const errorMessage = `${variableName} entry ${index + 1} must be a WebSocket URL without credentials, query strings, or fragments`;
		let url: URL;
		try {
			url = new URL(entry.trim());
		} catch {
			throw new Error(errorMessage);
		}
		if (
			(url.protocol !== 'ws:' && url.protocol !== 'wss:') ||
			url.username ||
			url.password ||
			entry.includes('?') ||
			entry.includes('#') ||
			url.hostname.includes('*')
		) {
			throw new Error(errorMessage);
		}
		return url.pathname === '/' ? url.origin : url.href;
	});
	return [...new Set(relays)];
}

export function resolveNostrRelays(env: NostrRelayEnvironment): NostrRelayConfiguration {
	const connectRelays = parseRelays(
		env.NOSTR_CONNECT_RELAYS ?? DEFAULT_CONNECT_RELAYS,
		'NOSTR_CONNECT_RELAYS'
	);
	const profileRelays = parseRelays(
		env.NOSTR_PROFILE_BOOTSTRAP_RELAYS ?? DEFAULT_PROFILE_RELAYS,
		'NOSTR_PROFILE_BOOTSTRAP_RELAYS'
	);
	return {
		connectRelays,
		profileBootstrapRelays: [...new Set([...connectRelays, ...profileRelays])]
	};
}
