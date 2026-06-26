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

const sk = generateSecretKey();
const pk = getPublicKey(sk);

// Minimal NIP-07 provider backed by a real test key, so NDK's signer produces a
// genuinely-signed event. The mocked server accepts it without re-verifying.
const nostr = {
	getPublicKey: () => Promise.resolve(pk),
	signEvent: (event: EventTemplate) => Promise.resolve(finalizeEvent(event, sk))
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
	window.nostr = nostr;
});

afterEach(() => {
	vi.unstubAllGlobals();
});

it('signs in via NIP-07 (sends a Nostr authorization) and signs out', async () => {
	let sentAuthHeader: string | null = null;
	mockFetch((init) => {
		sentAuthHeader = new Headers(init?.headers).get('authorization');
		return Response.json({ user: { pubkey: pk } });
	});

	const screen = render(AuthBar);
	await screen.getByRole('button', { name: 'Войти через расширение Nostr' }).click();

	await expect.element(screen.getByRole('button', { name: 'Выйти' })).toBeVisible();
	expect(sentAuthHeader).toMatch(/^Nostr .+/);
	expect(auth.pubkey).toBe(pk);

	await screen.getByRole('button', { name: 'Выйти' }).click();
	await expect
		.element(screen.getByRole('button', { name: 'Войти через расширение Nostr' }))
		.toBeVisible();
});

it('shows an error when no Nostr extension is present', async () => {
	mockFetch(() => Response.json({ user: { pubkey: pk } }));
	delete window.nostr;

	const screen = render(AuthBar);
	await screen.getByRole('button', { name: 'Войти через расширение Nostr' }).click();

	await expect
		.element(screen.getByText('Расширение Nostr не найдено. Установите Alby или nos2x.'))
		.toBeVisible();
});
