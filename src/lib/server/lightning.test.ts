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

import type { Filter } from 'nostr-tools/filter';
import { NWCWalletInfo, NWCWalletResponse } from 'nostr-tools/kinds';
import { v2 as nip44 } from 'nostr-tools/nip44';
import { finalizeEvent, generateSecretKey, getPublicKey, type Event } from 'nostr-tools/pure';
import { bytesToHex } from 'nostr-tools/utils';
import { describe, expect, it } from 'vitest';
import { createInvoice, lookupInvoice, parseNwcConnectionString, type NwcPool } from './lightning';

const RELAY = 'wss://relay.example.test';

function connectionString(secretHex: string, walletPubkey: string, relay = RELAY): string {
	return `nostr+walletconnect://${walletPubkey}?relay=${encodeURIComponent(relay)}&secret=${secretHex}`;
}

interface MockPoolConfig {
	walletSecretKey: Uint8Array;
	clientPubkey: string;
	result: unknown;
	respond?: boolean;
}

function mockPool({
	walletSecretKey,
	clientPubkey,
	result,
	respond = true
}: MockPoolConfig): NwcPool {
	const conversationKey = nip44.utils.getConversationKey(walletSecretKey, clientPubkey);
	return {
		publish: () => [Promise.resolve('ok')],
		close: () => undefined,
		get: async (_relays: string[], filter: Filter): Promise<Event | null> => {
			if (filter.kinds?.includes(NWCWalletInfo)) {
				return finalizeEvent(
					{
						kind: NWCWalletInfo,
						created_at: Math.floor(Date.now() / 1000),
						tags: [['encryption', 'nip44_v2']],
						content: 'pay_invoice make_invoice lookup_invoice notifications'
					},
					walletSecretKey
				);
			}
			if (filter.kinds?.includes(NWCWalletResponse)) {
				if (!respond) return null;
				const requestId = filter['#e']?.[0] ?? '';
				const content = nip44.encrypt(
					JSON.stringify({ result_type: 'x', error: null, result }),
					conversationKey
				);
				return finalizeEvent(
					{
						kind: NWCWalletResponse,
						created_at: Math.floor(Date.now() / 1000),
						tags: [
							['p', clientPubkey],
							['e', requestId]
						],
						content
					},
					walletSecretKey
				);
			}
			return null;
		}
	};
}

describe('parseNwcConnectionString', () => {
	it('parses pubkey, relay, and secret out of the URI', () => {
		const clientSecretKey = generateSecretKey();
		const walletSecretKey = generateSecretKey();
		const walletPubkey = getPublicKey(walletSecretKey);
		const connection = parseNwcConnectionString(
			connectionString(bytesToHex(clientSecretKey), walletPubkey)
		);

		expect(connection.walletPubkey).toBe(walletPubkey);
		expect(connection.relays).toEqual([RELAY]);
		expect(connection.clientPubkey).toBe(getPublicKey(clientSecretKey));
	});

	it('throws when the secret query param is missing', () => {
		const walletPubkey = getPublicKey(generateSecretKey());
		expect(() =>
			parseNwcConnectionString(`nostr+walletconnect://${walletPubkey}?relay=${RELAY}`)
		).toThrow('invalid NWC connection string');
	});
});

describe('createInvoice', () => {
	it('converts sats to msats in the request and back to sats in the result', async () => {
		const clientSecretKey = generateSecretKey();
		const walletSecretKey = generateSecretKey();
		const walletPubkey = getPublicKey(walletSecretKey);
		const connection = parseNwcConnectionString(
			connectionString(bytesToHex(clientSecretKey), walletPubkey)
		);
		const pool = mockPool({
			walletSecretKey,
			clientPubkey: connection.clientPubkey,
			result: {
				invoice: 'lnbc1...',
				payment_hash: 'hash-1',
				amount: 5000,
				created_at: 1000,
				expires_at: 1600
			}
		});

		const invoice = await createInvoice(connection, 5, 'Cadbos $1 package', 600, { pool });

		expect(invoice).toEqual({
			invoice: 'lnbc1...',
			paymentHash: 'hash-1',
			satsAmount: 5,
			createdAt: 1000,
			expiresAt: 1600
		});
	});

	it('throws when the response never arrives', async () => {
		const clientSecretKey = generateSecretKey();
		const walletSecretKey = generateSecretKey();
		const walletPubkey = getPublicKey(walletSecretKey);
		const connection = parseNwcConnectionString(
			connectionString(bytesToHex(clientSecretKey), walletPubkey)
		);
		const pool = mockPool({
			walletSecretKey,
			clientPubkey: connection.clientPubkey,
			result: {},
			respond: false
		});

		await expect(
			createInvoice(connection, 5, 'Cadbos $1 package', 600, { pool, maxWaitMs: 10 })
		).rejects.toThrow('timed out');
	});

	it('throws when the wallet does not advertise nip44_v2 support', async () => {
		const clientSecretKey = generateSecretKey();
		const walletSecretKey = generateSecretKey();
		const walletPubkey = getPublicKey(walletSecretKey);
		const connection = parseNwcConnectionString(
			connectionString(bytesToHex(clientSecretKey), walletPubkey)
		);
		const pool: NwcPool = {
			publish: () => [Promise.resolve('ok')],
			close: () => undefined,
			get: async (_relays: string[], filter: Filter) => {
				if (filter.kinds?.includes(NWCWalletInfo)) {
					return finalizeEvent(
						{
							kind: NWCWalletInfo,
							created_at: Math.floor(Date.now() / 1000),
							tags: [],
							content: 'pay_invoice'
						},
						walletSecretKey
					);
				}
				return null;
			}
		};

		await expect(createInvoice(connection, 5, 'Cadbos $1 package', 600, { pool })).rejects.toThrow(
			'does not advertise nip44_v2'
		);
	});

	it('surfaces an NWC error response', async () => {
		const clientSecretKey = generateSecretKey();
		const walletSecretKey = generateSecretKey();
		const walletPubkey = getPublicKey(walletSecretKey);
		const connection = parseNwcConnectionString(
			connectionString(bytesToHex(clientSecretKey), walletPubkey)
		);
		const conversationKey = nip44.utils.getConversationKey(
			walletSecretKey,
			connection.clientPubkey
		);
		const pool: NwcPool = {
			publish: () => [Promise.resolve('ok')],
			close: () => undefined,
			get: async (_relays: string[], filter: Filter) => {
				if (filter.kinds?.includes(NWCWalletInfo)) {
					return finalizeEvent(
						{
							kind: NWCWalletInfo,
							created_at: Math.floor(Date.now() / 1000),
							tags: [['encryption', 'nip44_v2']],
							content: 'make_invoice'
						},
						walletSecretKey
					);
				}
				const requestId = filter['#e']?.[0] ?? '';
				const content = nip44.encrypt(
					JSON.stringify({
						result_type: 'make_invoice',
						error: { code: 'QUOTA_EXCEEDED', message: 'monthly limit reached' },
						result: null
					}),
					conversationKey
				);
				return finalizeEvent(
					{
						kind: NWCWalletResponse,
						created_at: Math.floor(Date.now() / 1000),
						tags: [
							['p', connection.clientPubkey],
							['e', requestId]
						],
						content
					},
					walletSecretKey
				);
			}
		};

		await expect(createInvoice(connection, 5, 'Cadbos $1 package', 600, { pool })).rejects.toThrow(
			'QUOTA_EXCEEDED'
		);
	});
});

describe('lookupInvoice', () => {
	it('returns the invoice state and settlement time', async () => {
		const clientSecretKey = generateSecretKey();
		const walletSecretKey = generateSecretKey();
		const walletPubkey = getPublicKey(walletSecretKey);
		const connection = parseNwcConnectionString(
			connectionString(bytesToHex(clientSecretKey), walletPubkey)
		);
		const pool = mockPool({
			walletSecretKey,
			clientPubkey: connection.clientPubkey,
			result: { state: 'settled', payment_hash: 'hash-1', settled_at: 1234 }
		});

		const status = await lookupInvoice(connection, 'hash-1', { pool });

		expect(status).toEqual({ state: 'settled', paymentHash: 'hash-1', settledAt: 1234 });
	});
});
