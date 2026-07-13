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

// NWC (NIP-47) client for the single wallet Cadbos holds (an Alby Hub instance —
// see docs/payments-lightning-sats.md §3). No inbound webhook exists for NWC (it's
// relay request/response, not HTTP), so this only exposes request/response calls;
// payment confirmation is done by polling lookupInvoice from the deposit-status
// route, not by a push notification.
//
// Only NIP-44 (the current, non-deprecated NIP-47 encryption) is supported. If the
// held wallet ever stops advertising it, this throws rather than silently falling
// back to the deprecated NIP-04 scheme.

import { v2 as nip44 } from 'nostr-tools/nip44';
import type { Filter } from 'nostr-tools/filter';
import { NWCWalletInfo, NWCWalletRequest, NWCWalletResponse } from 'nostr-tools/kinds';
import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, getPublicKey, type Event } from 'nostr-tools/pure';
import { hexToBytes } from 'nostr-tools/utils';

const NIP44_ENCRYPTION = 'nip44_v2';
const DEFAULT_MAX_WAIT_MS = 15_000;
const MSATS_PER_SAT = 1000;

export interface NwcConnection {
	walletPubkey: string;
	relays: string[];
	clientSecretKey: Uint8Array;
	clientPubkey: string;
}

// `nostr-tools` has an internal nip47.ts with the same parsing logic, but it
// isn't in the package's public "exports" map, so it isn't importable here —
// reimplemented against the same NIP-47 "Connection String" section instead.
export function parseNwcConnectionString(connectionString: string): NwcConnection {
	const { host, pathname, searchParams } = new URL(connectionString);
	const walletPubkey = pathname.replace(/^\//, '') || host;
	const relays = searchParams.getAll('relay');
	const secret = searchParams.get('secret');
	if (!walletPubkey || relays.length === 0 || !secret) {
		throw new Error('invalid NWC connection string');
	}
	const clientSecretKey = hexToBytes(secret);
	return {
		walletPubkey,
		relays,
		clientSecretKey,
		clientPubkey: getPublicKey(clientSecretKey)
	};
}

export interface NwcPool {
	get(relays: string[], filter: Filter, params?: { maxWait?: number }): Promise<Event | null>;
	publish(relays: string[], event: Event): Promise<string>[];
	close?(relays: string[]): void;
}

export interface NwcRequestOptions {
	pool?: NwcPool;
	maxWaitMs?: number;
}

export interface Invoice {
	invoice: string;
	paymentHash: string;
	satsAmount: number;
	createdAt: number;
	expiresAt: number;
}

export type InvoiceState = 'pending' | 'settled' | 'accepted' | 'expired' | 'failed';

export interface InvoiceStatus {
	state: InvoiceState;
	paymentHash: string;
	settledAt: number | null;
}

interface NwcResponsePayload<TResult> {
	result_type: string;
	error: { code: string; message: string } | null;
	result: TResult | null;
}

async function sendNwcRequest<TResult>(
	connection: NwcConnection,
	method: string,
	params: Record<string, unknown>,
	options: NwcRequestOptions
): Promise<TResult> {
	const pool = options.pool ?? new SimplePool();
	const maxWait = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
	const conversationKey = nip44.utils.getConversationKey(
		connection.clientSecretKey,
		connection.walletPubkey
	);

	try {
		const info = await pool.get(
			connection.relays,
			{ kinds: [NWCWalletInfo], authors: [connection.walletPubkey] },
			{ maxWait }
		);
		const encryptionTag = info?.tags.find((tag) => tag[0] === 'encryption')?.[1] ?? '';
		if (!encryptionTag.split(/[ ,]+/).includes(NIP44_ENCRYPTION)) {
			throw new Error('NWC wallet does not advertise nip44_v2 encryption support');
		}

		const requestEvent = finalizeEvent(
			{
				kind: NWCWalletRequest,
				created_at: Math.floor(Date.now() / 1000),
				tags: [
					['p', connection.walletPubkey],
					['encryption', NIP44_ENCRYPTION]
				],
				content: nip44.encrypt(JSON.stringify({ method, params }), conversationKey)
			},
			connection.clientSecretKey
		);

		await Promise.all(pool.publish(connection.relays, requestEvent));

		const responseEvent = await pool.get(
			connection.relays,
			{
				kinds: [NWCWalletResponse],
				authors: [connection.walletPubkey],
				'#e': [requestEvent.id],
				'#p': [connection.clientPubkey]
			},
			{ maxWait }
		);
		if (!responseEvent) {
			throw new Error(`NWC ${method} request timed out waiting for a response`);
		}

		const payload = JSON.parse(
			nip44.decrypt(responseEvent.content, conversationKey)
		) as NwcResponsePayload<TResult>;
		if (payload.error) {
			throw new Error(`NWC ${method} failed: ${payload.error.code} — ${payload.error.message}`);
		}
		if (!payload.result) throw new Error(`NWC ${method} returned no result`);
		return payload.result;
	} finally {
		pool.close?.(connection.relays);
	}
}

interface MakeInvoiceResult {
	invoice: string;
	payment_hash: string;
	amount: number;
	created_at: number;
	expires_at: number;
}

export async function createInvoice(
	connection: NwcConnection,
	satsAmount: number,
	description: string,
	expirySeconds: number,
	options: NwcRequestOptions = {}
): Promise<Invoice> {
	const result = await sendNwcRequest<MakeInvoiceResult>(
		connection,
		'make_invoice',
		{ amount: satsAmount * MSATS_PER_SAT, description, expiry: expirySeconds },
		options
	);
	return {
		invoice: result.invoice,
		paymentHash: result.payment_hash,
		satsAmount: Math.round(result.amount / MSATS_PER_SAT),
		createdAt: result.created_at,
		expiresAt: result.expires_at
	};
}

interface LookupInvoiceResult {
	state: InvoiceState;
	payment_hash: string;
	settled_at?: number;
}

export async function lookupInvoice(
	connection: NwcConnection,
	paymentHash: string,
	options: NwcRequestOptions = {}
): Promise<InvoiceStatus> {
	const result = await sendNwcRequest<LookupInvoiceResult>(
		connection,
		'lookup_invoice',
		{ payment_hash: paymentHash },
		options
	);
	return {
		state: result.state,
		paymentHash: result.payment_hash,
		settledAt: result.settled_at ?? null
	};
}
