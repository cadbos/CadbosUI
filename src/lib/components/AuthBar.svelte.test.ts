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
// URI, and BunkerSigner.fromURI hands back a promise we resolve (signer connected) at
// the point the test chooses. It deliberately ignores the abort signal — matching the
// real nostr-tools, whose abort never settles the promise — so cancellation is left to
// the store's own race to handle.
const nip46 = vi.hoisted(() => {
	let resolveSigner: ((signer: unknown) => void) | null = null;
	return {
		uri: 'nostrconnect://cadbos-test?relay=wss%3A%2F%2Frelay.nsec.app',
		createNostrConnectURI: vi.fn(() => nip46.uri),
		fromURI: vi.fn(() => new Promise((resolve) => (resolveSigner = resolve))),
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

function mockFetch(
	verify: (init?: RequestInit) => Response,
	profile?: (init?: RequestInit) => Response
) {
	vi.stubGlobal(
		'fetch',
		vi.fn((input: string, init?: RequestInit) => {
			if (input.endsWith('/auth/me')) return Promise.resolve(new Response(null, { status: 401 }));
			if (input.endsWith('/auth/challenge')) {
				return Promise.resolve(Response.json({ challenge: 'a'.repeat(64) }));
			}
			if (input.endsWith('/auth/verify')) return Promise.resolve(verify(init));
			if (input.endsWith('/auth/nostr-profile')) {
				return Promise.resolve(
					Response.json({
						profile: {
							name: 'cadbos-nostr',
							relays: [{ url: 'wss://relay.example/', read: true, write: true }]
						}
					})
				);
			}
			if (input.endsWith('/auth/profile')) {
				if (init?.method !== 'PATCH') return Promise.resolve(new Response(null, { status: 405 }));
				return Promise.resolve(
					profile?.(init) ??
						Response.json({ user: { pubkey: pk, firstName: 'Ada', lastName: 'Lovelace' } })
				);
			}
			if (input.endsWith('/auth/logout'))
				return Promise.resolve(new Response(null, { status: 204 }));
			return Promise.resolve(new Response(null, { status: 404 }));
		})
	);
}

beforeEach(() => {
	auth.status = 'anonymous';
	auth.user = null;
	auth.nostrProfile = null;
	auth.profileDraft.firstName = '';
	auth.profileDraft.lastName = '';
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
	await screen.getByRole('button', { name: 'Войти', exact: true }).click();
	await screen.getByRole('button', { name: 'Расширение Nostr' }).click();

	await expect.element(screen.getByRole('button', { name: 'Выйти' })).toBeVisible();
	expect(sentAuthHeader).toMatch(/^Nostr .+/);
	expect(auth.pubkey).toBe(pk);

	await screen.getByRole('button', { name: 'Выйти' }).click();
	await expect.element(screen.getByRole('button', { name: 'Войти', exact: true })).toBeVisible();
});

it('offers to complete Cadbos profile fields after sign-in', async () => {
	let profileRequest: unknown = null;
	mockFetch(
		() => Response.json({ user: { pubkey: pk } }),
		(init) => {
			profileRequest = init;
			return Response.json({ user: { pubkey: pk, firstName: 'Ada' } });
		}
	);

	const screen = render(AuthBar);
	await screen.getByRole('button', { name: 'Войти', exact: true }).click();
	await screen.getByRole('button', { name: 'Расширение Nostr' }).click();

	await expect
		.element(screen.getByText('Заполните имя и фамилию для профиля Cadbos.'))
		.toBeVisible();
	await screen.getByLabelText('Имя').fill('  Ada  ');
	await screen.getByLabelText('Фамилия').fill('   ');
	await screen.getByRole('button', { name: 'Сохранить' }).click();

	expect(new Headers((profileRequest as RequestInit).headers).get('content-type')).toBe(
		'application/json'
	);
	expect(JSON.parse(String((profileRequest as RequestInit).body))).toEqual({
		firstName: 'Ada',
		lastName: null
	});
	await expect
		.element(screen.getByText('Заполните имя и фамилию для профиля Cadbos.'))
		.not.toBeVisible();
});

it('shows an error when no Nostr extension is present', async () => {
	mockFetch(() => Response.json({ user: { pubkey: pk } }));
	delete window.nostr;

	const screen = render(AuthBar);
	await screen.getByRole('button', { name: 'Войти', exact: true }).click();
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
	await screen.getByRole('button', { name: 'Войти', exact: true }).click();
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
	await screen.getByRole('button', { name: 'Войти', exact: true }).click();
	await screen.getByRole('button', { name: 'Nostr Connect (QR)' }).click();
	await expect.element(screen.getByRole('button', { name: 'Отмена' })).toBeVisible();

	await screen.getByRole('button', { name: 'Отмена' }).click();

	await expect.element(screen.getByRole('button', { name: 'Войти', exact: true })).toBeVisible();
	expect(auth.status).toBe('anonymous');
	expect(auth.error).toBeNull();
});

it('cancelling after the signer connects but before verification stays anonymous', async () => {
	let verifyCalled = false;
	mockFetch(() => {
		verifyCalled = true;
		return Response.json({ user: { pubkey: pk } });
	});

	// A signer that connects but holds its signature pending until we release it,
	// so we can cancel while login is mid-flight. `whenSigning` resolves with the
	// release callback once the signer is asked to sign; if that never happens the
	// awaiting test simply times out, surfacing the failure clearly.
	let onSignRequested!: (release: () => void) => void;
	const whenSigning = new Promise<() => void>((resolve) => {
		onSignRequested = resolve;
	});
	const pendingSigner = {
		getPublicKey: () => Promise.resolve(pk),
		signEvent: (event: EventTemplate) =>
			new Promise<ReturnType<typeof finalizeEvent>>((resolve) => {
				onSignRequested(() => resolve(finalizeEvent(event, sk)));
			}),
		close: () => Promise.resolve()
	};

	const screen = render(AuthBar);
	await screen.getByRole('button', { name: 'Войти', exact: true }).click();
	await screen.getByRole('button', { name: 'Nostr Connect (QR)' }).click();
	await expect.element(screen.getByRole('button', { name: 'Отмена' })).toBeVisible();

	// Signer connects; login proceeds to signing and then parks there.
	nip46.connect(pendingSigner);
	const releaseSignature = await whenSigning;

	// Cancel mid-login, then let the (now-stale) signature resolve.
	auth.cancelNip46();
	releaseSignature();

	await expect.element(screen.getByRole('button', { name: 'Войти', exact: true })).toBeVisible();
	expect(auth.status).toBe('anonymous');
	expect(auth.pubkey).toBeNull();
	expect(verifyCalled).toBe(false);
});
