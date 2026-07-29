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
const BOLT11 =
	'lnbc20u1p3y0x3hpp5743k2g0fsqqxj7n8qzuhns5gmkk4djeejk3wkp64ppevgekvc0jsdqcve5kzar2v9nr5gpqd4hkuetesp5ez2g297jduwc20t6lmqlsg3man0vf2jfd8ar9fh8fhn2g8yttfkqxqy9gcqcqzys9qrsgqrzjqtx3k77yrrav9hye7zar2rtqlfkytl094dsp0ms5majzth6gt7ca6uhdkxl983uywgqqqqlgqqqvx5qqjqrzjqd98kxkpyw0l9tyy8r8q57k7zpy9zjmh6sez752wj6gcumqnj3yxzhdsmg6qq56utgqqqqqqqqqqqeqqjq7jd56882gtxhrjm03c93aacyfy306m4fq0tskf83c0nmet8zc2lxyyg3saz8x6vwcp26xnrlagf9semau3qm2glysp7sv95693fphvsp54l567';
const AMOUNTLESS_BOLT11 =
	'lnbc1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpl2pkx2ctnv5sxxmmwwd5kgetjypeh2ursdae8g6twvus8g6rfwvs8qun0dfjkxaq9qrsgq357wnc5r2ueh7ck6q93dj32dlqnls087fxdwk8qakdyafkq3yap9us6v52vjjsrvywa6rt52cm9r9zqt8r2t7mlcwspyetp5h2tztugp9lfyql';
const PAYMENT_HASH = 'f5636521e98000697a6700b979c288ddad56cb3995a2eb07550872c466ccc3e5';
const AMOUNTLESS_PAYMENT_HASH = '0001020304050607080900010203040506070809000102030405060708090102';
const INVOICE_SATS = 2000;
const INVOICE_MSATS = 2_000_000;

function connectionString(secretHex: string, walletPubkey: string, relay = RELAY): string {
	return `nostr+walletconnect://${walletPubkey}?relay=${encodeURIComponent(relay)}&secret=${secretHex}`;
}

function nwcTestContext() {
	const clientSecretKey = generateSecretKey();
	const walletSecretKey = generateSecretKey();
	const walletPubkey = getPublicKey(walletSecretKey);
	return {
		walletSecretKey,
		connection: parseNwcConnectionString(
			connectionString(bytesToHex(clientSecretKey), walletPubkey)
		)
	};
}

function validInvoiceResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		invoice: BOLT11,
		payment_hash: PAYMENT_HASH,
		amount: INVOICE_MSATS,
		created_at: 1000,
		expires_at: 1600,
		...overrides
	};
}

interface MockPoolConfig {
	walletSecretKey: Uint8Array;
	clientPubkey: string;
	resultType: string;
	result: unknown;
	respond?: boolean;
}

function mockPool({
	walletSecretKey,
	clientPubkey,
	resultType,
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
					JSON.stringify({ result_type: resultType, error: null, result }),
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
			resultType: 'make_invoice',
			result: {
				invoice: BOLT11,
				payment_hash: PAYMENT_HASH,
				amount: INVOICE_MSATS,
				created_at: 1000,
				expires_at: 1600
			}
		});

		const invoice = await createInvoice(connection, INVOICE_SATS, 'Cadbos $1 package', 600, {
			pool
		});

		expect(invoice).toEqual({
			invoice: BOLT11,
			paymentHash: PAYMENT_HASH,
			satsAmount: INVOICE_SATS,
			createdAt: 1000,
			expiresAt: 1600
		});
	});

	it('rejects a response for a different NWC method', async () => {
		const { connection, walletSecretKey } = nwcTestContext();
		const pool = mockPool({
			walletSecretKey,
			clientPubkey: connection.clientPubkey,
			resultType: 'lookup_invoice',
			result: validInvoiceResult()
		});

		await expect(
			createInvoice(connection, INVOICE_SATS, 'Cadbos $1 package', 600, { pool })
		).rejects.toThrow('mismatched result_type');
	});

	it('rejects an NWC amount that differs from the requested amount', async () => {
		const { connection, walletSecretKey } = nwcTestContext();
		const pool = mockPool({
			walletSecretKey,
			clientPubkey: connection.clientPubkey,
			resultType: 'make_invoice',
			result: validInvoiceResult({ amount: INVOICE_MSATS + 1 })
		});

		await expect(
			createInvoice(connection, INVOICE_SATS, 'Cadbos $1 package', 600, { pool })
		).rejects.toThrow('mismatched amount');
	});

	it('rejects a BOLT11 amount that differs from the requested amount', async () => {
		const { connection, walletSecretKey } = nwcTestContext();
		const requestedSats = INVOICE_SATS + 1;
		const pool = mockPool({
			walletSecretKey,
			clientPubkey: connection.clientPubkey,
			resultType: 'make_invoice',
			result: validInvoiceResult({ amount: requestedSats * 1000 })
		});

		await expect(
			createInvoice(connection, requestedSats, 'Cadbos $1 package', 600, { pool })
		).rejects.toThrow('BOLT11 invoice with a mismatched amount');
	});

	it('rejects an amountless BOLT11 invoice', async () => {
		const { connection, walletSecretKey } = nwcTestContext();
		const pool = mockPool({
			walletSecretKey,
			clientPubkey: connection.clientPubkey,
			resultType: 'make_invoice',
			result: validInvoiceResult({
				invoice: AMOUNTLESS_BOLT11,
				payment_hash: AMOUNTLESS_PAYMENT_HASH
			})
		});

		await expect(
			createInvoice(connection, INVOICE_SATS, 'Cadbos $1 package', 600, { pool })
		).rejects.toThrow('BOLT11 invoice with a mismatched amount');
	});

	it('rejects an invalid BOLT11 invoice', async () => {
		const { connection, walletSecretKey } = nwcTestContext();
		const pool = mockPool({
			walletSecretKey,
			clientPubkey: connection.clientPubkey,
			resultType: 'make_invoice',
			result: validInvoiceResult({ invoice: 'lnbc1invalid' })
		});

		await expect(
			createInvoice(connection, INVOICE_SATS, 'Cadbos $1 package', 600, { pool })
		).rejects.toThrow('invalid BOLT11 invoice');
	});

	it('rejects a payment hash that differs from the BOLT11 invoice', async () => {
		const { connection, walletSecretKey } = nwcTestContext();
		const pool = mockPool({
			walletSecretKey,
			clientPubkey: connection.clientPubkey,
			resultType: 'make_invoice',
			result: validInvoiceResult({ payment_hash: 'a'.repeat(64) })
		});

		await expect(
			createInvoice(connection, INVOICE_SATS, 'Cadbos $1 package', 600, { pool })
		).rejects.toThrow('BOLT11 invoice with a mismatched payment hash');
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
			resultType: 'make_invoice',
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
			resultType: 'lookup_invoice',
			result: { state: 'settled', payment_hash: PAYMENT_HASH.toUpperCase(), settled_at: 1234 }
		});

		const status = await lookupInvoice(connection, PAYMENT_HASH, { pool });

		expect(status).toEqual({ state: 'settled', paymentHash: PAYMENT_HASH, settledAt: 1234 });
	});

	it('rejects a lookup response with an unknown invoice state', async () => {
		const clientSecretKey = generateSecretKey();
		const walletSecretKey = generateSecretKey();
		const walletPubkey = getPublicKey(walletSecretKey);
		const connection = parseNwcConnectionString(
			connectionString(bytesToHex(clientSecretKey), walletPubkey)
		);
		const pool = mockPool({
			walletSecretKey,
			clientPubkey: connection.clientPubkey,
			resultType: 'lookup_invoice',
			result: { state: 'unknown', payment_hash: PAYMENT_HASH }
		});

		await expect(lookupInvoice(connection, PAYMENT_HASH, { pool })).rejects.toThrow();
	});

	it('rejects a payment hash that differs from the lookup request', async () => {
		const { connection, walletSecretKey } = nwcTestContext();
		const pool = mockPool({
			walletSecretKey,
			clientPubkey: connection.clientPubkey,
			resultType: 'lookup_invoice',
			result: { state: 'settled', payment_hash: 'a'.repeat(64), settled_at: 1234 }
		});

		await expect(lookupInvoice(connection, PAYMENT_HASH, { pool })).rejects.toThrow(
			'mismatched payment hash'
		);
	});
});
