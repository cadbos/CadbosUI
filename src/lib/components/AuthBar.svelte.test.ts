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
import { userEvent } from 'vitest/browser';
import {
	finalizeEvent,
	generateSecretKey,
	getPublicKey,
	type EventTemplate
} from 'nostr-tools/pure';
import AuthBar from './AuthBar.svelte';
import { auth } from '$lib/state/auth.svelte';

// A real, out-of-component click target for the outside-pointerdown assertions below.
// `dismissable` only needs the click to land outside the panel's own node, but a
// synthetic dispatchEvent doesn't reliably drive Svelte's reactive scheduling the way
// a genuine (Playwright-driven) interaction does — so this is clicked for real.
function appendOutsideTarget(): HTMLButtonElement {
	const target = document.createElement('button');
	target.type = 'button';
	target.textContent = 'outside';
	target.style.cssText = 'position:fixed;top:0;left:0;width:2px;height:2px;padding:0;';
	document.body.appendChild(target);
	return target;
}

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
	profile?: (init?: RequestInit) => Response,
	me?: () => Response
) {
	vi.stubGlobal(
		'fetch',
		vi.fn((input: string, init?: RequestInit) => {
			if (input.endsWith('/auth/me')) {
				return Promise.resolve(me?.() ?? new Response(null, { status: 401 }));
			}
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
						Response.json({
							featurebaseJwt: null,
							user: { pubkey: pk, firstName: 'Ada', lastName: 'Lovelace' }
						})
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
		return Response.json({ featurebaseJwt: null, user: { pubkey: pk } });
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
		() => Response.json({ featurebaseJwt: null, user: { pubkey: pk } }),
		(init) => {
			profileRequest = init;
			return Response.json({ featurebaseJwt: null, user: { pubkey: pk, firstName: 'Ada' } });
		}
	);

	const screen = render(AuthBar);
	await screen.getByRole('button', { name: 'Войти', exact: true }).click();
	await screen.getByRole('button', { name: 'Расширение Nostr' }).click();

	await expect.element(screen.getByText('Заполните имя и фамилию для профиля.')).toBeVisible();
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
	await expect.element(screen.getByText('Заполните имя и фамилию для профиля.')).not.toBeVisible();
});

it('shows an error when no Nostr extension is present', async () => {
	mockFetch(() => Response.json({ featurebaseJwt: null, user: { pubkey: pk } }));
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
		return Response.json({ featurebaseJwt: null, user: { pubkey: pk } });
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
	mockFetch(() => Response.json({ featurebaseJwt: null, user: { pubkey: pk } }));

	const screen = render(AuthBar);
	await screen.getByRole('button', { name: 'Войти', exact: true }).click();
	await screen.getByRole('button', { name: 'Nostr Connect (QR)' }).click();
	await expect.element(screen.getByRole('button', { name: 'Отмена' })).toBeVisible();

	await screen.getByRole('button', { name: 'Отмена' }).click();

	await expect.element(screen.getByRole('button', { name: 'Войти', exact: true })).toBeVisible();
	expect(auth.status).toBe('anonymous');
	expect(auth.error).toBeNull();
});

it('shows the approved-account balance and history rounded to two decimals after sign-in', async () => {
	mockFetch(
		() => Response.json({ featurebaseJwt: null, user: { pubkey: pk } }),
		undefined,
		() =>
			Response.json({
				featurebaseJwt: null,
				user: { pubkey: pk },
				credit: {
					balance: 4.9399999999999995,
					updatedAt: Date.now(),
					history: [
						{
							id: 'txn-1',
							amount: 0.06,
							balanceAfter: 4.9399999999999995,
							kind: 'render',
							createdAt: 1
						}
					]
				}
			})
	);

	const screen = render(AuthBar);
	await screen.getByRole('button', { name: 'Войти', exact: true }).click();
	await screen.getByRole('button', { name: 'Расширение Nostr' }).click();

	await expect.element(screen.getByText('Баланс: 4.94')).toBeVisible();
	await screen.getByText('История трат').click();
	await expect.element(screen.getByText(/−0\.06 → 4\.94/)).toBeVisible();
});

it('restores an authenticated session on load, including an upscale entry in credit history', async () => {
	mockFetch(
		() => new Response(null, { status: 401 }),
		undefined,
		() =>
			Response.json({
				featurebaseJwt: null,
				user: { pubkey: pk },
				credit: {
					balance: 10,
					updatedAt: Date.now(),
					history: [{ id: 'txn-2', amount: 1.2, balanceAfter: 10, kind: 'upscale', createdAt: 2 }]
				}
			})
	);

	await auth.loadSession();

	expect(auth.status).toBe('authenticated');
	expect(auth.pubkey).toBe(pk);
	expect(auth.credit?.history).toEqual([expect.objectContaining({ kind: 'upscale' })]);
});

it('closes the sign-in menu on an outside click, and on Escape returns focus to the trigger', async () => {
	mockFetch(() => Response.json({ featurebaseJwt: null, user: { pubkey: pk } }));

	const screen = render(AuthBar);
	const trigger = screen.getByRole('button', { name: 'Войти', exact: true });
	const menuItem = screen.getByRole('button', { name: 'Расширение Nostr' });
	const outside = appendOutsideTarget();
	// role queries drop out of the accessibility tree once an ancestor gets the
	// `hidden` attribute, so the "closed" checks below read `hidden` directly instead
	// of `.not.toBeVisible()`.
	const menuPanel = screen.container.querySelector<HTMLElement>('#signin-menu');
	if (!menuPanel) throw new Error('signin menu not rendered');

	try {
		await trigger.click();
		await expect.element(menuItem).toBeVisible();

		await userEvent.click(outside);
		await expect.poll(() => menuPanel.hidden).toBe(true);
		expect(trigger.element().getAttribute('aria-expanded')).toBe('false');

		await trigger.click();
		await expect.element(menuItem).toBeVisible();
		// Move focus into the menu first so the post-Escape check is meaningful — the
		// trigger already had focus from the click above.
		menuItem.element().focus();
		expect(document.activeElement).toBe(menuItem.element());

		await userEvent.keyboard('{Escape}');
		await expect.poll(() => menuPanel.hidden).toBe(true);
		expect(document.activeElement).toBe(trigger.element());
	} finally {
		outside.remove();
	}
});

it('closes the profile panel on an outside click, and on Escape returns focus to the toggle', async () => {
	// firstName/lastName present so the panel starts closed (no missingCadbosName
	// auto-open) — the dismiss/reopen cycle below needs a real closed→open transition.
	mockFetch(() =>
		Response.json({
			featurebaseJwt: null,
			user: { pubkey: pk, firstName: 'Ada', lastName: 'Lovelace' }
		})
	);

	const screen = render(AuthBar);
	await screen.getByRole('button', { name: 'Войти', exact: true }).click();
	await screen.getByRole('button', { name: 'Расширение Nostr' }).click();

	const logoutButton = screen.getByRole('button', { name: 'Выйти' });
	// The panel starts closed, so wait on the always-visible toggle rather than on
	// panel content to know the authenticated view has actually rendered.
	await expect.poll(() => screen.container.querySelector('.profile-toggle')).not.toBeNull();
	const profileToggle = screen.container.querySelector<HTMLButtonElement>('.profile-toggle');
	if (!profileToggle) throw new Error('profile toggle not rendered');
	const profilePanel = screen.container.querySelector<HTMLElement>('#auth-profile');
	if (!profilePanel) throw new Error('profile panel not rendered');
	expect(profilePanel.hidden).toBe(true);

	const outside = appendOutsideTarget();

	try {
		await userEvent.click(profileToggle);
		await expect.element(logoutButton).toBeVisible();

		await userEvent.click(outside);
		await expect.poll(() => profilePanel.hidden).toBe(true);
		expect(profileToggle.getAttribute('aria-expanded')).toBe('false');

		await userEvent.click(profileToggle);
		await expect.element(logoutButton).toBeVisible();
		logoutButton.element().focus();
		expect(document.activeElement).toBe(logoutButton.element());

		await userEvent.keyboard('{Escape}');
		await expect.poll(() => profilePanel.hidden).toBe(true);
		expect(document.activeElement).toBe(profileToggle);
	} finally {
		outside.remove();
	}
});

it('cancelling after the signer connects but before verification stays anonymous', async () => {
	let verifyCalled = false;
	mockFetch(() => {
		verifyCalled = true;
		return Response.json({ featurebaseJwt: null, user: { pubkey: pk } });
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
