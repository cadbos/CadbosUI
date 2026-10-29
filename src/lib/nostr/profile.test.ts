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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SimplePool } from 'nostr-tools/pool';
import type { Event } from 'nostr-tools/pure';
import { NOSTR_PROFILE_BOOTSTRAP_RELAYS } from '$lib/nostr/connect';
import { fetchNostrProfile, parseMetadata, parseRelayList } from '$lib/nostr/profile';

type FetchOptions = NonNullable<Parameters<typeof fetchNostrProfile>[1]>;
type ProfilePool = NonNullable<FetchOptions['pool']>;
type QuerySync = ProfilePool['querySync'];

beforeEach(() => {
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
});

function event(kind: number, createdAt: number, content = '', tags: string[][] = []): Event {
	return {
		kind,
		pubkey: 'a'.repeat(64),
		created_at: createdAt,
		tags,
		content,
		id: `${kind}-${createdAt}`,
		sig: 'sig'
	};
}

describe('parseMetadata', () => {
	it('parses supported kind:0 metadata fields', () => {
		expect(
			parseMetadata(
				event(
					0,
					2,
					JSON.stringify({
						name: 'cadbos',
						picture: 'https://example.com/pic.jpg',
						about: 'Interior profile',
						nip05: 'user@example.com',
						website: 'https://example.com'
					})
				)
			)
		).toEqual({
			name: 'cadbos',
			picture: 'https://example.com/pic.jpg',
			about: 'Interior profile',
			nip05: 'user@example.com',
			website: 'https://example.com/'
		});
	});

	it('ignores malformed and non-string metadata', () => {
		expect(parseMetadata(event(0, 1, 'not json'))).toEqual({});
		expect(parseMetadata(event(0, 1, JSON.stringify({ name: 12, about: ' ok ' })))).toEqual({
			about: 'ok'
		});
	});

	it('drops unsafe profile URLs', () => {
		expect(
			parseMetadata(
				event(
					0,
					1,
					JSON.stringify({
						picture: 'javascript:alert(1)',
						website: 'data:text/html,unsafe'
					})
				)
			)
		).toEqual({});
		expect(
			parseMetadata(
				event(
					0,
					1,
					JSON.stringify({
						picture: 'https://example.com/avatar.png',
						website: 'http://example.com'
					})
				)
			)
		).toEqual({
			picture: 'https://example.com/avatar.png',
			website: 'http://example.com/'
		});
	});
});

describe('parseRelayList', () => {
	it('parses NIP-65 relay markers', () => {
		expect(
			parseRelayList(
				event(10002, 1, '', [
					['r', 'wss://read.example/', 'read'],
					['r', 'wss://write.example', 'write'],
					['r', 'wss://both.example'],
					['r', 'https://ignored.example'],
					['x', 'wss://ignored.example']
				])
			)
		).toEqual([
			{ url: 'wss://read.example/', read: true, write: false },
			{ url: 'wss://write.example/', read: false, write: true },
			{ url: 'wss://both.example/', read: true, write: true }
		]);
	});
});

describe('fetchNostrProfile', () => {
	it('fetches profile metadata from allowlisted write relays and excludes read-only relays', async () => {
		const querySync = vi.fn<QuerySync>();
		querySync
			.mockResolvedValueOnce([
				event(10002, 1, '', [
					['r', 'wss://read.example', 'read'],
					['r', 'wss://write.example', 'write'],
					['r', 'wss://both.example'],
					['r', 'wss://untrusted.example', 'write'],
					['r', 'ws://127.0.0.1:8080', 'write']
				])
			])
			.mockResolvedValueOnce([event(0, 4, JSON.stringify({ name: 'newer' }))]);
		const close = vi.fn();

		const profile = await fetchNostrProfile('a'.repeat(64), {
			pool: { querySync, close },
			relays: ['wss://bootstrap.example'],
			allowedProfileRelays: ['wss://read.example', 'wss://WRITE.example', 'wss://both.example/'],
			maxWait: 25
		});

		expect(profile).toEqual({
			name: 'newer',
			relays: [
				{ url: 'wss://read.example/', read: true, write: false },
				{ url: 'wss://write.example/', read: false, write: true },
				{ url: 'wss://both.example/', read: true, write: true },
				{ url: 'wss://untrusted.example/', read: false, write: true },
				{ url: 'ws://127.0.0.1:8080/', read: false, write: true }
			]
		});
		expect(querySync).toHaveBeenNthCalledWith(
			2,
			expect.arrayContaining(['wss://write.example/', 'wss://both.example/']),
			{ kinds: [0], authors: ['a'.repeat(64)] },
			{ maxWait: 25 }
		);
		const profileRelays = querySync.mock.calls[1][0];
		expect(profileRelays).not.toContain('wss://read.example/');
		expect(profileRelays).not.toContain('wss://untrusted.example/');
		expect(profileRelays).not.toContain('ws://127.0.0.1:8080/');
		expect(close).toHaveBeenCalledWith(expect.arrayContaining(profileRelays));
	});

	it('matches configured relay URLs with NIP-65 URLs and deduplicates equivalent bootstrap URLs', async () => {
		const configuredRelay = NOSTR_PROFILE_BOOTSTRAP_RELAYS[0];
		const normalizedRelay = new URL(configuredRelay).toString();
		const picture = 'https://avatar.example/profile.png';
		const querySync = vi
			.fn<QuerySync>()
			.mockResolvedValueOnce([event(10002, 1, '', [['r', normalizedRelay, 'write']])])
			.mockResolvedValueOnce([event(0, 2, JSON.stringify({ picture }))]);
		const close = vi.fn();

		const profile = await fetchNostrProfile('a'.repeat(64), {
			pool: { querySync, close },
			relays: [configuredRelay, normalizedRelay]
		});

		expect(profile.picture).toBe(picture);
		expect(querySync).toHaveBeenCalledTimes(2);
		for (const [relays] of querySync.mock.calls) {
			expect(relays.filter((relay) => relay === normalizedRelay)).toHaveLength(1);
			expect(relays).toEqual([...new Set(relays)]);
		}
		expect(close).toHaveBeenCalledWith(querySync.mock.calls[1][0]);
	});

	it('does not follow unallowlisted or read-only advertised relays', async () => {
		const querySync = vi.fn<QuerySync>().mockResolvedValueOnce([
			event(10002, 1, '', [
				['r', 'wss://read.example', 'read'],
				['r', 'ws://127.0.0.1:8080', 'write']
			])
		]);

		await fetchNostrProfile('a'.repeat(64), {
			pool: { querySync },
			allowedProfileRelays: ['wss://read.example']
		});

		expect(querySync).toHaveBeenCalledTimes(1);
	});

	it('uses bootstrap profile data when no relay list is found', async () => {
		const querySync = vi
			.fn<QuerySync>()
			.mockResolvedValueOnce([event(0, 3, JSON.stringify({ name: 'bootstrap' }))]);

		await expect(
			fetchNostrProfile('a'.repeat(64), {
				pool: { querySync },
				relays: ['wss://bootstrap.example'],
				maxWait: 25
			})
		).resolves.toEqual({ name: 'bootstrap', relays: [] });
		expect(querySync).toHaveBeenCalledTimes(1);
	});

	it('retains newer bootstrap metadata when the follow-up query returns an older profile', async () => {
		const picture = 'https://avatar.example/current.png';
		const querySync = vi
			.fn<QuerySync>()
			.mockResolvedValueOnce([
				event(0, 3, JSON.stringify({ picture })),
				event(10002, 1, '', [['r', 'wss://write.example', 'write']])
			])
			.mockResolvedValueOnce([
				event(0, 2, JSON.stringify({ picture: 'https://avatar.example/old.png' }))
			]);

		const profile = await fetchNostrProfile('a'.repeat(64), {
			pool: { querySync },
			allowedProfileRelays: ['wss://write.example']
		});

		expect(querySync).toHaveBeenCalledTimes(2);
		expect(profile.picture).toBe(picture);
	});

	it('keeps bootstrap profile data and logs a sanitized error when write relay enrichment fails', async () => {
		const querySync = vi.fn<QuerySync>();
		querySync
			.mockResolvedValueOnce([
				event(0, 3, JSON.stringify({ name: 'bootstrap' })),
				event(10002, 1, '', [['r', 'wss://write.example', 'write']])
			])
			.mockRejectedValueOnce(new Error('private relay response'));

		await expect(
			fetchNostrProfile('a'.repeat(64), {
				pool: { querySync },
				relays: ['wss://bootstrap.example'],
				allowedProfileRelays: ['wss://write.example'],
				maxWait: 25
			})
		).resolves.toEqual({
			name: 'bootstrap',
			relays: [{ url: 'wss://write.example/', read: false, write: true }]
		});
		expect(console.error).toHaveBeenCalledWith(
			JSON.stringify({ event: 'nostr_profile_query_failed', stage: 'profile', error: 'Error' })
		);
	});

	it('returns an empty profile without opening connections for invalid pubkeys', async () => {
		const ensureRelay = vi.spyOn(SimplePool.prototype, 'ensureRelay');
		await expect(fetchNostrProfile('bad')).resolves.toEqual({ relays: [] });
		expect(ensureRelay).not.toHaveBeenCalled();
	});

	it('returns an empty profile and logs a sanitized error when the bootstrap query fails', async () => {
		const querySync = vi.fn<QuerySync>().mockRejectedValue(new Error('private relay response'));
		const close = vi.fn();
		await expect(
			fetchNostrProfile('a'.repeat(64), {
				pool: { querySync, close },
				relays: ['wss://bootstrap.example'],
				maxWait: 25
			})
		).resolves.toEqual({ relays: [] });
		expect(console.error).toHaveBeenCalledWith(
			JSON.stringify({ event: 'nostr_profile_query_failed', stage: 'bootstrap', error: 'Error' })
		);
		expect(close).toHaveBeenCalledWith(querySync.mock.calls[0][0]);
	});

	it('logs real pool connection failures that resolve as empty query results', async () => {
		vi.spyOn(SimplePool.prototype, 'ensureRelay').mockRejectedValue(
			new Error('private relay response')
		);

		await expect(fetchNostrProfile('a'.repeat(64))).resolves.toEqual({ relays: [] });

		expect(console.warn).toHaveBeenCalledTimes(NOSTR_PROFILE_BOOTSTRAP_RELAYS.length);
		for (const relay of NOSTR_PROFILE_BOOTSTRAP_RELAYS) {
			expect(console.warn).toHaveBeenCalledWith(
				JSON.stringify({
					event: 'nostr_profile_relay_connection_failed',
					relayOrigin: new URL(relay).origin
				})
			);
		}
	});
});
