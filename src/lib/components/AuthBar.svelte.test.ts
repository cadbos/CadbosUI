import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import {
	finalizeEvent,
	generateSecretKey,
	getPublicKey,
	type EventTemplate
} from 'nostr-tools/pure';
import AuthBar from './AuthBar.svelte';
import { auth } from '$lib/state/auth.svelte';

// Drive the NIP-46 path without a real relay: createNostrConnectURI returns a fixed
// URI, and BunkerSigner.fromURI hands back a promise we resolve (signer connected) or
// reject via its abort signal (user cancelled) at the point the test chooses.
const nip46 = vi.hoisted(() => {
	let resolveSigner: ((signer: unknown) => void) | null = null;
	return {
		uri: 'nostrconnect://cadbos-test?relay=wss%3A%2F%2Frelay.nsec.app',
		createNostrConnectURI: vi.fn(() => nip46.uri),
		fromURI: vi.fn(
			(_sk: unknown, _uri: string, _params: unknown, signal?: AbortSignal) =>
				new Promise((resolve, reject) => {
					resolveSigner = resolve;
					signal?.addEventListener('abort', () => reject(new Error('aborted')));
				})
		),
		connect: (signer: unknown) => resolveSigner?.(signer)
	};
});

vi.mock('nostr-tools/nip46', () => ({
	createNostrConnectURI: nip46.createNostrConnectURI,
	BunkerSigner: { fromURI: nip46.fromURI }
}));

const sk = generateSecretKey();
const pk = getPublicKey(sk);

// Minimal signer backed by a real test key, so the produced login event is genuinely
// signed. The mocked server accepts it without re-verifying. The same shape stands in
// for both window.nostr (NIP-07) and the BunkerSigner (NIP-46).
const nostr = {
	getPublicKey: () => Promise.resolve(pk),
	signEvent: (event: EventTemplate) => Promise.resolve(finalizeEvent(event, sk)),
	close: () => Promise.resolve()
};

function mockFetch(verify: (init?: RequestInit) => Response) {
	vi.stubGlobal(
		'fetch',
		vi.fn((input: string, init?: RequestInit) => {
			if (input.endsWith('/auth/me')) return Promise.resolve(new Response(null, { status: 401 }));
			if (input.endsWith('/auth/challenge')) {
				return Promise.resolve(Response.json({ challenge: 'a'.repeat(64) }));
			}
			if (input.endsWith('/auth/verify')) return Promise.resolve(verify(init));
			if (input.endsWith('/auth/logout'))
				return Promise.resolve(new Response(null, { status: 204 }));
			return Promise.resolve(new Response(null, { status: 404 }));
		})
	);
}

beforeEach(() => {
	auth.status = 'anonymous';
	auth.user = null;
	auth.error = null;
	auth.connectUri = null;
	auth.authUrl = null;
	window.nostr = nostr;
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

it('signs in via NIP-07 (sends a Nostr authorization) and signs out', async () => {
	let sentAuthHeader: string | null = null;
	mockFetch((init) => {
		sentAuthHeader = new Headers(init?.headers).get('authorization');
		return Response.json({ user: { pubkey: pk } });
	});

	const screen = render(AuthBar);
	await screen.getByRole('button', { name: 'Войти' }).click();
	await screen.getByRole('button', { name: 'Расширение Nostr' }).click();

	await expect.element(screen.getByRole('button', { name: 'Выйти' })).toBeVisible();
	expect(sentAuthHeader).toMatch(/^Nostr .+/);
	expect(auth.pubkey).toBe(pk);

	await screen.getByRole('button', { name: 'Выйти' }).click();
	await expect.element(screen.getByRole('button', { name: 'Войти' })).toBeVisible();
});

it('shows an error when no Nostr extension is present', async () => {
	mockFetch(() => Response.json({ user: { pubkey: pk } }));
	delete window.nostr;

	const screen = render(AuthBar);
	await screen.getByRole('button', { name: 'Войти' }).click();
	await screen.getByRole('button', { name: 'Расширение Nostr' }).click();

	await expect
		.element(screen.getByText('Расширение Nostr не найдено. Установите Alby или nos2x.'))
		.toBeVisible();
});

it('signs in via NIP-46: shows the QR, then completes when the signer connects', async () => {
	let sentAuthHeader: string | null = null;
	mockFetch((init) => {
		sentAuthHeader = new Headers(init?.headers).get('authorization');
		return Response.json({ user: { pubkey: pk } });
	});

	const screen = render(AuthBar);
	await screen.getByRole('button', { name: 'Войти' }).click();
	await screen.getByRole('button', { name: 'Nostr Connect (QR)' }).click();

	// The connect panel (QR + actions) is shown while we await the remote signer.
	await expect
		.element(screen.getByRole('img', { name: 'QR-код для входа через Nostr Connect' }))
		.toBeVisible();
	await expect.element(screen.getByRole('button', { name: 'Скопировать ссылку' })).toBeVisible();

	// The signer connects → the shared login flow runs and the session opens.
	nip46.connect(nostr);
	await expect.element(screen.getByRole('button', { name: 'Выйти' })).toBeVisible();
	expect(sentAuthHeader).toMatch(/^Nostr .+/);
	expect(auth.pubkey).toBe(pk);
});

it('returns to anonymous when the NIP-46 connection is cancelled', async () => {
	mockFetch(() => Response.json({ user: { pubkey: pk } }));

	const screen = render(AuthBar);
	await screen.getByRole('button', { name: 'Войти' }).click();
	await screen.getByRole('button', { name: 'Nostr Connect (QR)' }).click();
	await expect.element(screen.getByRole('button', { name: 'Отмена' })).toBeVisible();

	await screen.getByRole('button', { name: 'Отмена' }).click();

	await expect.element(screen.getByRole('button', { name: 'Войти' })).toBeVisible();
	expect(auth.status).toBe('anonymous');
	expect(auth.error).toBeNull();
});
