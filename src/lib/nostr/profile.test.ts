import { describe, expect, it, vi } from 'vitest';
import type { Event } from 'nostr-tools/pure';
import { fetchNostrProfile, parseMetadata, parseRelayList } from './profile';

type FetchOptions = NonNullable<Parameters<typeof fetchNostrProfile>[1]>;
type ProfilePool = NonNullable<FetchOptions['pool']>;
type QuerySync = ProfilePool['querySync'];

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
	it('fetches relays from bootstrap and then profile metadata from read relays', async () => {
		const querySync = vi.fn<QuerySync>();
		querySync
			.mockResolvedValueOnce([
				event(10002, 1, '', [
					['r', 'wss://read.example', 'read'],
					['r', 'wss://write.example', 'write']
				])
			])
			.mockResolvedValueOnce([event(0, 4, JSON.stringify({ name: 'newer' }))]);
		const close = vi.fn();

		const profile = await fetchNostrProfile('a'.repeat(64), {
			pool: { querySync, close },
			relays: ['wss://bootstrap.example'],
			allowedReadRelays: ['wss://read.example/'],
			maxWait: 25
		});

		expect(profile).toEqual({
			name: 'newer',
			relays: [
				{ url: 'wss://read.example/', read: true, write: false },
				{ url: 'wss://write.example/', read: false, write: true }
			]
		});
		expect(querySync).toHaveBeenNthCalledWith(
			2,
			expect.arrayContaining(['wss://read.example/']),
			{ kinds: [0], authors: ['a'.repeat(64)] },
			{ maxWait: 25 }
		);
		expect(close).toHaveBeenCalledWith(expect.arrayContaining(['wss://read.example/']));
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

	it('keeps bootstrap profile data when read relay enrichment fails', async () => {
		const querySync = vi.fn<QuerySync>();
		querySync
			.mockResolvedValueOnce([
				event(0, 3, JSON.stringify({ name: 'bootstrap' })),
				event(10002, 1, '', [['r', 'wss://read.example', 'read']])
			])
			.mockRejectedValueOnce(new Error('read relay down'));

		await expect(
			fetchNostrProfile('a'.repeat(64), {
				pool: { querySync },
				relays: ['wss://bootstrap.example'],
				allowedReadRelays: ['wss://read.example/'],
				maxWait: 25
			})
		).resolves.toEqual({
			name: 'bootstrap',
			relays: [{ url: 'wss://read.example/', read: true, write: false }]
		});
	});

	it('returns an empty profile for invalid pubkeys or relay failures', async () => {
		await expect(fetchNostrProfile('bad')).resolves.toEqual({ relays: [] });

		const querySync = vi.fn<QuerySync>().mockRejectedValue(new Error('relay down'));
		await expect(
			fetchNostrProfile('a'.repeat(64), {
				pool: { querySync },
				relays: ['wss://bootstrap.example'],
				maxWait: 25
			})
		).resolves.toEqual({ relays: [] });
	});
});
