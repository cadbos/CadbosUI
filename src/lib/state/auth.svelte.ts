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

// Client auth store (SRS Appendix B.4) — the single source of truth for sign-in
// state. Two sign-in methods produce the same signed NIP-98 challenge, so the
// server side is identical for both; they differ only in *what* signs the event:
//   - NIP-07: a browser extension (window.nostr);
//   - NIP-46 (Nostr Connect): a remote signer reached over a relay, driven by a
//     `nostrconnect://` QR the user scans. The private key never leaves the signer;
//     the server only ever sees the pubkey and the signed challenge.
//
// We deliberately avoid NDK: it pulls in `tseep`, which compiles emit handlers with
// `eval()`, blocked by our strict CSP (`script-src 'self'`, no `unsafe-eval`). The
// NIP-46 path uses nostr-tools' eval-free `nip46` instead.

import { z } from 'zod';
import { BunkerSigner, createNostrConnectURI } from 'nostr-tools/nip46';
import { SimplePool } from 'nostr-tools/pool';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import type { Event, EventTemplate } from 'nostr-tools/pure';
import type { NostrProfile, ProfileUpdateRequest, SessionUser, Balance } from '$lib/api/contract';
import { NOSTR_CONNECT_RELAYS } from '$lib/nostr/connect';

// NIP-98 HTTP-Auth event kind — a protocol constant, mirrored on the server.
const NIP98_KIND = 27235;

// Validate server responses at the boundary, so downstream consumers (npubEncode,
// the session cookie, the UI) only ever see well-formed data. The pubkey/challenge
// shapes mirror the server (32-byte lowercase hex).
const hex32 = z.string().regex(/^[0-9a-f]{64}$/);
const sessionUserSchema = z.object({
	pubkey: hex32,
	firstName: z.string().optional(),
	lastName: z.string().optional()
});
const balanceSchema = z.object({
	balance: z.number(),
	updatedAt: z.number()
});
const meResponseSchema = z.object({ user: sessionUserSchema, balance: balanceSchema.optional() });
const challengeResponseSchema = z.object({ challenge: hex32 });
const verifyResponseSchema = z.object({ user: sessionUserSchema });
const profileResponseSchema = z.object({ user: sessionUserSchema });
const PROFILE_NAME_MAX_LENGTH = 80;
const nostrProfileSchema = z.object({
	profile: z.object({
		name: z.string().optional(),
		picture: z.string().optional(),
		about: z.string().optional(),
		nip05: z.string().optional(),
		website: z.string().optional(),
		relays: z.array(
			z.object({
				url: z.string(),
				read: z.boolean(),
				write: z.boolean()
			})
		)
	})
});

// The signer surface both methods share: get the user's pubkey and sign an event.
// `window.nostr` (NIP-07) and `BunkerSigner` (NIP-46) both satisfy it, so the login
// flow is written once against this type.
interface NostrSigner {
	getPublicKey(): Promise<string>;
	signEvent(event: EventTemplate): Promise<Event>;
}

declare global {
	interface Window {
		nostr?: NostrSigner;
	}
}

export type AuthStatus = 'anonymous' | 'connecting' | 'authenticated';
export type AuthError = 'extension_missing' | 'rejected' | 'failed';

class AuthFlowError extends Error {
	constructor(readonly code: AuthError) {
		super(code);
	}
}

class AuthState {
	status = $state<AuthStatus>('anonymous');
	user = $state<SessionUser | null>(null);
	balance = $state<Balance | null>(null);
	nostrProfile = $state<NostrProfile | null>(null);
	profileDraft = $state({ firstName: '', lastName: '' });
	error = $state<AuthError | null>(null);
	// The pending `nostrconnect://` URI to render as a QR while we wait for the
	// remote signer; null whenever no NIP-46 connection is in flight.
	connectUri = $state<string | null>(null);
	// An auth_url some signers ask the user to visit to approve the connection.
	authUrl = $state<string | null>(null);

	// Lets cancelNip46() abort an in-flight BunkerSigner.fromURI() wait.
	#connectAbort: AbortController | null = null;

	get pubkey(): string | null {
		return this.user?.pubkey ?? null;
	}

	// Restore an existing server session (httpOnly cookie) on app load.
	async loadSession(): Promise<void> {
		try {
			const response = await fetch('/auth/me');
			if (!response.ok) return;
			const data = await parseJsonOrFail(response, meResponseSchema);
			this.#authenticate(data.user);
			this.balance = data.balance ?? null;
		} catch {
			// Network hiccup or malformed response on load — stay anonymous, the user
			// can sign in manually.
		}
	}

	async loginNip07(): Promise<void> {
		if (this.status === 'connecting') return;
		this.error = null;
		this.status = 'connecting';

		if (typeof window === 'undefined' || !window.nostr) {
			this.#fail('extension_missing');
			return;
		}

		try {
			await this.#runLogin(window.nostr);
		} catch (err) {
			this.#fail(err instanceof AuthFlowError ? err.code : 'rejected');
		}
	}

	// NIP-46 (Nostr Connect): generate an ephemeral client key, publish a
	// `nostrconnect://` request to the connect relay, and render its QR. The promise
	// resolves once the user's remote signer connects; the shared login flow then
	// signs the challenge through it. cancelNip46() aborts the wait.
	async loginNip46(): Promise<void> {
		if (this.status === 'connecting') return;
		this.error = null;
		this.status = 'connecting';

		const clientSecret = generateSecretKey();
		const uri = createNostrConnectURI({
			clientPubkey: getPublicKey(clientSecret),
			relays: [...NOSTR_CONNECT_RELAYS],
			secret: randomHex(32),
			perms: [`sign_event:${NIP98_KIND}`],
			name: 'Cadbos',
			url: location.origin
		});
		this.connectUri = uri;

		const abort = new AbortController();
		this.#connectAbort = abort;
		const pool = new SimplePool();
		let signer: BunkerSigner | undefined;
		try {
			signer = await this.#awaitSigner(clientSecret, uri, pool, abort.signal);
			await this.#runLogin(signer, abort.signal);
		} catch (err) {
			// An aborted wait is a deliberate cancel, not an error to surface.
			if (abort.signal.aborted) this.status = 'anonymous';
			else this.#fail(err instanceof AuthFlowError ? err.code : 'failed');
		} finally {
			this.connectUri = null;
			this.authUrl = null;
			this.#connectAbort = null;
			void signer?.close().catch(() => {});
			pool.close([...NOSTR_CONNECT_RELAYS]);
		}
	}

	// Abort an in-flight NIP-46 connection; loginNip46()'s catch handles the rest.
	cancelNip46(): void {
		this.#connectAbort?.abort();
	}

	// Wait for the remote signer to connect, but reject promptly on cancel.
	// BunkerSigner.fromURI wires the abort signal through a single `signal.onabort`
	// handler that the multi-relay subscription overwrites, so its own abort never
	// settles the promise — race it against our own listener instead. The dangling
	// fromURI promise is harmless once we close the pool in loginNip46()'s finally.
	#awaitSigner(
		secretKey: Uint8Array,
		uri: string,
		pool: SimplePool,
		signal: AbortSignal
	): Promise<BunkerSigner> {
		return new Promise<BunkerSigner>((resolve, reject) => {
			const onAbort = () => reject(signal.reason);
			signal.addEventListener('abort', onAbort, { once: true });
			BunkerSigner.fromURI(secretKey, uri, { pool, onauth: (url) => (this.authUrl = url) }, signal)
				.then(resolve, reject)
				.finally(() => signal.removeEventListener('abort', onAbort));
		});
	}

	// The login steps shared by both methods, once a signer is available. A late
	// NIP-46 cancel (the signer connected, but signing/verification is still in
	// flight) must win, so we re-check the abort signal before /auth/verify creates
	// the server session.
	async #runLogin(signer: NostrSigner, signal?: AbortSignal): Promise<void> {
		const pubkey = await signer.getPublicKey();
		const challenge = await this.#requestChallenge(pubkey);
		const header = await this.#signLogin(signer, challenge);
		if (signal?.aborted) throw signal.reason;
		this.#authenticate(await this.#verify(header));
	}

	async logout(): Promise<void> {
		let response: Response;
		try {
			response = await fetch('/auth/logout', { method: 'POST' });
		} catch {
			// Couldn't reach the server: the httpOnly cookie and server session are
			// still live, so keep the user signed in rather than show a false logout.
			return;
		}
		if (!response.ok) return;
		this.user = null;
		this.balance = null;
		this.nostrProfile = null;
		this.#resetProfileDraft(null);
		this.error = null;
		this.status = 'anonymous';
	}

	async loginDemo(): Promise<void> {
		if (this.status === 'connecting') return;
		this.error = null;
		this.status = 'connecting';
		try {
			const response = await fetchOrFail('/auth/demo', { method: 'POST' });
			const data = await parseJsonOrFail(response, verifyResponseSchema);
			this.#authenticate(data.user);
			const meResponse = await fetch('/auth/me');
			if (meResponse.ok) {
				const me = await parseJsonOrFail(meResponse, meResponseSchema);
				this.balance = me.balance ?? null;
			}
		} catch {
			this.#fail('failed');
		}
	}

	async refreshNostrProfile(): Promise<void> {
		const pubkey = this.user?.pubkey;
		if (!pubkey) return;
		try {
			const response = await fetch('/auth/nostr-profile');
			if (!response.ok) return;
			const profile = (await parseJsonOrFail(response, nostrProfileSchema)).profile;
			if (this.user?.pubkey === pubkey) this.nostrProfile = profile;
		} catch {
			if (this.user?.pubkey === pubkey) this.nostrProfile = { relays: [] };
		}
	}

	async saveProfile(input: ProfileUpdateRequest = this.profileDraft): Promise<void> {
		const profile = normalizeProfileUpdate(input);
		const response = await fetchOrFail('/auth/profile', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(profile)
		});
		this.user = (await parseJsonOrFail(response, profileResponseSchema)).user;
		this.#resetProfileDraft(this.user);
	}

	async #requestChallenge(pubkey: string): Promise<string> {
		const response = await fetchOrFail('/auth/challenge', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ pubkey })
		});
		return (await parseJsonOrFail(response, challengeResponseSchema)).challenge;
	}

	// Sign the NIP-98 login event in the signer. A rejection there (user declined)
	// surfaces as `rejected` rather than a generic failure.
	async #signLogin(signer: NostrSigner, challenge: string): Promise<string> {
		let signed: Event;
		try {
			signed = await signer.signEvent({
				kind: NIP98_KIND,
				created_at: Math.floor(Date.now() / 1000),
				tags: [
					['u', `${location.origin}/auth/verify`],
					['method', 'POST'],
					['challenge', challenge]
				],
				content: ''
			});
		} catch {
			throw new AuthFlowError('rejected');
		}
		return `Nostr ${base64(JSON.stringify(signed))}`;
	}

	async #verify(header: string): Promise<SessionUser> {
		const response = await fetchOrFail('/auth/verify', {
			method: 'POST',
			headers: { authorization: header }
		});
		return (await parseJsonOrFail(response, verifyResponseSchema)).user;
	}

	#fail(error: AuthError): void {
		this.status = 'anonymous';
		this.nostrProfile = null;
		this.#resetProfileDraft(null);
		this.error = error;
	}

	#authenticate(user: SessionUser): void {
		this.user = user;
		this.nostrProfile = null;
		this.#resetProfileDraft(user);
		this.status = 'authenticated';
		void this.refreshNostrProfile();
	}

	#resetProfileDraft(user: SessionUser | null): void {
		this.profileDraft.firstName = user?.firstName ?? '';
		this.profileDraft.lastName = user?.lastName ?? '';
	}
}

async function fetchOrFail(input: string, init: RequestInit): Promise<Response> {
	let response: Response;
	try {
		response = await fetch(input, init);
	} catch {
		throw new AuthFlowError('failed');
	}
	if (!response.ok) throw new AuthFlowError('failed');
	return response;
}

async function parseJsonOrFail<S extends z.ZodType>(
	response: Response,
	schema: S
): Promise<z.infer<S>> {
	const result = schema.safeParse(await response.json().catch(() => null));
	if (!result.success) throw new AuthFlowError('failed');
	return result.data;
}

// UTF-8-safe base64 for the Authorization header (mirrors the server's decode).
function base64(value: string): string {
	return btoa(String.fromCharCode(...new TextEncoder().encode(value)));
}

// A random hex string for the NIP-46 connect secret (the signer echoes it back so
// we can match its response to our request).
function randomHex(bytes: number): string {
	return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) =>
		b.toString(16).padStart(2, '0')
	).join('');
}

export function normalizeProfileUpdate(input: ProfileUpdateRequest): ProfileUpdateRequest {
	return {
		...(input.firstName !== undefined ? { firstName: normalizeProfileName(input.firstName) } : {}),
		...(input.lastName !== undefined ? { lastName: normalizeProfileName(input.lastName) } : {})
	};
}

function normalizeProfileName(value: string | null): string | null {
	if (value === null) return null;
	const normalized = value.trim().slice(0, PROFILE_NAME_MAX_LENGTH);
	return normalized.length === 0 ? null : normalized;
}

export const auth = new AuthState();
