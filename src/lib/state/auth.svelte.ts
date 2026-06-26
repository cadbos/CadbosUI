// Client auth store (SRS Appendix B.4) — the single source of truth for sign-in
// state. Sign-in uses the NIP-07 browser extension directly (window.nostr): the
// private key never leaves the extension; the server only sees the pubkey and a
// signed NIP-98 challenge.
//
// We deliberately avoid NDK here: it pulls in `tseep`, which compiles emit handlers
// with `eval()`, and that is blocked by our strict CSP (`script-src 'self'`, no
// `unsafe-eval`). NIP-46 (QR) will use nostr-tools' eval-free `nip46` in a later
// sub-module.

import type { Event, EventTemplate } from 'nostr-tools/pure';
import type { SessionUser } from '$lib/api/contract';

// NIP-98 HTTP-Auth event kind — a protocol constant, mirrored on the server.
const NIP98_KIND = 27235;

// The subset of the NIP-07 provider we use. The extension keeps the private key.
interface Nip07Provider {
	getPublicKey(): Promise<string>;
	signEvent(event: EventTemplate): Promise<Event>;
}

declare global {
	interface Window {
		nostr?: Nip07Provider;
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
	error = $state<AuthError | null>(null);

	get pubkey(): string | null {
		return this.user?.pubkey ?? null;
	}

	// Restore an existing server session (httpOnly cookie) on app load.
	async loadSession(): Promise<void> {
		try {
			const response = await fetch('/auth/me');
			if (!response.ok) return;
			this.user = (await response.json()).user as SessionUser;
			this.status = 'authenticated';
		} catch {
			// Network hiccup on load — stay anonymous, the user can sign in manually.
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
			const provider = window.nostr;
			const pubkey = await provider.getPublicKey();
			const challenge = await this.#requestChallenge(pubkey);
			const header = await this.#signLogin(provider, challenge);
			this.user = await this.#verify(header);
			this.status = 'authenticated';
		} catch (err) {
			this.#fail(err instanceof AuthFlowError ? err.code : 'rejected');
		}
	}

	async logout(): Promise<void> {
		try {
			await fetch('/auth/logout', { method: 'POST' });
		} catch {
			// Best effort: clear local state regardless of the network result.
		}
		this.user = null;
		this.error = null;
		this.status = 'anonymous';
	}

	async #requestChallenge(pubkey: string): Promise<string> {
		const response = await fetchOrFail('/auth/challenge', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ pubkey })
		});
		return (await response.json()).challenge as string;
	}

	// Sign the NIP-98 login event in the extension. A rejection there (user declined)
	// surfaces as `rejected` rather than a generic failure.
	async #signLogin(provider: Nip07Provider, challenge: string): Promise<string> {
		let signed: Event;
		try {
			signed = await provider.signEvent({
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
		return (await response.json()).user as SessionUser;
	}

	#fail(error: AuthError): void {
		this.status = 'anonymous';
		this.error = error;
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

// UTF-8-safe base64 for the Authorization header (mirrors the server's decode).
function base64(value: string): string {
	return btoa(String.fromCharCode(...new TextEncoder().encode(value)));
}

export const auth = new AuthState();
