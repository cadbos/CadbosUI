<!--
Copyright (c) 2026 Cadbos company. All rights reserved.

SPDX-License-Identifier: LicenseRef-Cadbos-BSL-1.1

Cadbos Interior Design AI is licensed under the Business Source License 1.1.
Access is limited to automated analysis tools for analysis of this repository.
This code is not open for contribution or usage except under a separate written
agreement with Cadbos company.

Commercial use in Interior Design & AEC Generative AI Services is prohibited
before the Change Date. See LICENSE for complete terms.
-->

<script lang="ts">
	import { dev } from '$app/environment';
	import { npubEncode } from 'nostr-tools/nip19';
	import { auth, type AuthError } from '$lib/state/auth.svelte';
	import { t, ti, type TranslationKey } from '$lib/i18n/index.svelte';
	import type { CreditTransaction } from '$lib/api/contract';
	import { formatCredit } from '$lib/utils';
	import QrCode from './QrCode.svelte';

	const errorKeys: Record<AuthError, TranslationKey> = {
		extension_missing: 'auth.error.extensionMissing',
		rejected: 'auth.error.rejected',
		failed: 'auth.error.failed'
	};
	const creditEntryKeys: Record<CreditTransaction['kind'], TranslationKey> = {
		render: 'auth.credit.entryRender',
		edit: 'auth.credit.entryEdit',
		'style-transfer': 'auth.credit.entryStyleTransfer',
		'object-replacement': 'auth.credit.entryObjectReplacement',
		'texture-replacement': 'auth.credit.entryTextureReplacement',
		upscale: 'auth.credit.entryUpscale'
	};

	const shortNpub = $derived.by(() => {
		if (!auth.pubkey) return '';
		const npub = npubEncode(auth.pubkey);
		return `${npub.slice(0, 12)}…${npub.slice(-6)}`;
	});

	let menuOpen = $state(false);
	// 'auto' = open iff missingCadbosName; 'open'/'closed' = user overrode.
	let profileState = $state<'auto' | 'open' | 'closed'>('auto');
	let savingProfile = $state(false);
	let saveError = $state<string | null>(null);

	const displayName = $derived(auth.nostrProfile?.name ?? shortNpub);
	const missingCadbosName = $derived(
		auth.status === 'authenticated' && (!auth.user?.firstName || !auth.user?.lastName)
	);
	const relayCount = $derived(auth.nostrProfile?.relays.length ?? 0);
	const profileOpen = $derived(
		profileState === 'open' || (profileState === 'auto' && missingCadbosName)
	);

	// Track which URI was copied so the hint resets automatically when a fresh
	// connection (a different URI) is started.
	let copiedUri = $state<string | null>(null);
	const copied = $derived(copiedUri !== null && copiedUri === auth.connectUri);

	async function copyUri(): Promise<void> {
		// Capture before awaiting: connectUri may change mid-write, and we must mark
		// the URI we actually wrote as copied — not a newer one.
		const uri = auth.connectUri;
		if (!uri) return;
		try {
			await navigator.clipboard.writeText(uri);
			copiedUri = uri;
		} catch {
			// Clipboard unavailable (denied permission / insecure context): leave the
			// connect panel untouched so the user can still scan or copy manually.
		}
	}

	function creditEntryText(entry: CreditTransaction): string {
		return ti(creditEntryKeys[entry.kind], {
			date: new Date(entry.createdAt).toLocaleString(),
			amount: formatCredit(entry.amount),
			balance: formatCredit(entry.balanceAfter)
		});
	}

	function choose(method: () => Promise<void>): void {
		menuOpen = false;
		method();
	}

	async function saveProfile(): Promise<void> {
		savingProfile = true;
		saveError = null;
		try {
			await auth.saveProfile();
			profileState = 'closed';
		} catch {
			saveError = t('auth.profile.saveError');
		} finally {
			savingProfile = false;
		}
	}

	// Dismiss an open panel on an outside pointer press or Escape. An attachment
	// factory keeps the listeners tied to the element's lifetime without an effect.
	function dismissable(isOpen: () => boolean, close: () => void, triggerSelector: string) {
		return (node: HTMLElement) => {
			const onPointer = (event: PointerEvent) => {
				if (isOpen() && !node.contains(event.target as Node)) close();
			};
			const onKey = (event: KeyboardEvent) => {
				if (!isOpen() || event.key !== 'Escape') return;
				close();
				// Return focus to the trigger so keyboard users aren't dropped to <body>.
				node.querySelector<HTMLButtonElement>(triggerSelector)?.focus();
			};
			window.addEventListener('pointerdown', onPointer);
			window.addEventListener('keydown', onKey);
			return () => {
				window.removeEventListener('pointerdown', onPointer);
				window.removeEventListener('keydown', onKey);
			};
		};
	}
</script>

<div class="auth">
	{#if auth.status === 'authenticated'}
		<div
			class="profile"
			{@attach dismissable(
				() => profileOpen,
				() => (profileState = 'closed'),
				'.profile-toggle'
			)}
		>
			<button
				type="button"
				class="profile-toggle"
				aria-expanded={profileOpen}
				aria-controls="auth-profile"
				onclick={() => (profileState = profileOpen ? 'closed' : 'open')}
			>
				{#if auth.nostrProfile?.picture}
					<img src={auth.nostrProfile.picture} alt="" />
				{:else}
					<span class="avatar" aria-hidden="true">{displayName.slice(0, 1).toUpperCase()}</span>
				{/if}
				<span class="identity">
					{#if dev && auth.user?.pubkey?.startsWith('000000')}
						<span class="demo-badge">{t('auth.demo.badge')}</span>
					{/if}
					<span class="display">{displayName}</span>
					<span class="who" title={auth.pubkey ?? ''}>{shortNpub}</span>
				</span>
			</button>
			<div id="auth-profile" class="profile-panel" hidden={!profileOpen}>
				<div class="profile-meta">
					<span>{ti('auth.profile.relayCount', { count: relayCount })}</span>
					{#if auth.credit}
						<span class="balance">
							{ti('auth.credit.balance', { balance: formatCredit(auth.credit.balance) })}
						</span>
						<details class="credit-history">
							<summary>{t('auth.credit.history')}</summary>
							{#if auth.credit.history.length === 0}
								<p class="history-empty">{t('auth.credit.historyEmpty')}</p>
							{:else}
								<ul>
									{#each auth.credit.history as entry (entry.id)}
										<li>{creditEntryText(entry)}</li>
									{/each}
								</ul>
							{/if}
						</details>
					{/if}
					{#if missingCadbosName}
						<span class="notice">{t('auth.profile.completeHint')}</span>
					{/if}
				</div>
				<form onsubmit={(event) => void (event.preventDefault(), saveProfile())}>
					<label>
						<span>{t('auth.profile.firstName')}</span>
						<input autocomplete="given-name" bind:value={auth.profileDraft.firstName} />
					</label>
					<label>
						<span>{t('auth.profile.lastName')}</span>
						<input autocomplete="family-name" bind:value={auth.profileDraft.lastName} />
					</label>
					<div class="profile-actions">
						<button type="submit" disabled={savingProfile}>
							{savingProfile ? t('auth.profile.saving') : t('auth.profile.save')}
						</button>
						<button type="button" class="secondary" onclick={() => auth.logout()}>
							{t('auth.logout')}
						</button>
					</div>
					{#if saveError}
						<p class="error" role="alert">{saveError}</p>
					{/if}
				</form>
			</div>
		</div>
	{:else if auth.connectUri}
		<div class="connect">
			<p class="hint">{t('auth.connect.scan')}</p>
			<QrCode data={auth.connectUri} label={t('auth.connect.qrAlt')} />
			{#if auth.authUrl}
				<a class="approve" href={auth.authUrl} target="_blank" rel="external noopener noreferrer">
					{t('auth.connect.approve')}
				</a>
			{/if}
			<div class="connect-actions">
				<button type="button" onclick={copyUri}>
					{copied ? t('auth.connect.copied') : t('auth.connect.copy')}
				</button>
				<button type="button" onclick={() => auth.cancelNip46()}>
					{t('auth.connect.cancel')}
				</button>
			</div>
		</div>
	{:else}
		<div
			class="signin"
			{@attach dismissable(
				() => menuOpen,
				() => (menuOpen = false),
				'.trigger'
			)}
		>
			<button
				type="button"
				class="trigger"
				aria-expanded={menuOpen}
				aria-controls="signin-menu"
				disabled={auth.status === 'connecting'}
				onclick={() => (menuOpen = !menuOpen)}
			>
				<span>{auth.status === 'connecting' ? t('auth.connecting') : t('auth.signIn')}</span>
				<svg class="chevron" viewBox="0 0 16 16" aria-hidden="true">
					<path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" />
				</svg>
			</button>
			<div id="signin-menu" class="menu" hidden={!menuOpen}>
				<button type="button" onclick={() => choose(() => auth.loginNip07())}>
					{t('auth.login.nip07')}
				</button>
				<button type="button" onclick={() => choose(() => auth.loginNip46())}>
					{t('auth.login.nip46')}
				</button>
			</div>
		</div>
		{#if auth.error}
			<p class="error" role="alert">{t(errorKeys[auth.error])}</p>
		{/if}
		{#if dev}
			<button type="button" class="demo-btn" onclick={() => void auth.loginDemo()}>
				{t('auth.demo.login')}
			</button>
		{/if}
	{/if}
</div>

<style>
	.auth {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
		justify-content: flex-end;
	}

	.who {
		font-family: ui-monospace, monospace;
		font-size: 0.78rem;
		color: var(--color-muted);
	}

	.profile {
		position: relative;
	}

	button.profile-toggle {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-1);
		color: var(--color-text);
		background: var(--color-surface);
		border-color: var(--color-border);
	}

	.profile-toggle img,
	.avatar {
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		flex: 0 0 auto;
	}

	.profile-toggle img {
		object-fit: cover;
	}

	.avatar {
		display: grid;
		place-items: center;
		color: var(--color-accent-contrast);
		background: var(--color-accent);
		font-weight: 700;
	}

	.identity {
		display: grid;
		gap: 0.1rem;
		text-align: left;
		min-width: 0;
	}

	.display {
		max-width: 11rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 700;
	}

	.profile-panel {
		position: absolute;
		right: 0;
		top: calc(100% + var(--space-1));
		z-index: 2;
		width: min(22rem, calc(100vw - var(--space-4)));
		padding: var(--space-2);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		box-shadow: 0 8px 24px rgb(0 0 0 / 12%);
	}

	.profile-panel[hidden] {
		display: none;
	}

	.profile-meta {
		display: grid;
		gap: var(--space-1);
		margin-bottom: var(--space-2);
		font-size: 0.85rem;
		color: var(--color-muted);
	}

	.notice {
		color: var(--color-text);
	}

	form {
		display: grid;
		gap: var(--space-2);
	}

	label {
		display: grid;
		gap: 0.35rem;
		font-size: 0.85rem;
		color: var(--color-muted);
	}

	input {
		width: 100%;
		box-sizing: border-box;
		padding: var(--space-1) var(--space-2);
		font: inherit;
		color: var(--color-text);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
	}

	.profile-actions {
		display: flex;
		gap: var(--space-2);
		justify-content: flex-end;
	}

	button.secondary {
		color: var(--color-text);
		background: var(--color-surface);
		border-color: var(--color-border);
	}

	.signin {
		position: relative;
	}

	.trigger {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
	}

	.chevron {
		width: 0.85em;
		height: 0.85em;
		transition: transform 0.15s ease;
	}

	@media (prefers-reduced-motion: reduce) {
		.chevron {
			transition: none;
		}
	}

	.trigger[aria-expanded='true'] .chevron {
		transform: rotate(180deg);
	}

	.menu {
		position: absolute;
		right: 0;
		top: calc(100% + var(--space-1));
		z-index: 20;
		display: flex;
		flex-direction: column;
		min-width: 12rem;
		max-width: calc(100vw - var(--space-4));
		padding: var(--space-1);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		box-shadow: 0 8px 24px rgb(0 0 0 / 12%);
	}

	.menu[hidden] {
		display: none;
	}

	.menu button {
		justify-content: flex-start;
		text-align: left;
		color: var(--color-text);
		background: transparent;
		border-color: transparent;
	}

	.menu button:hover,
	.menu button:focus-visible {
		background: var(--color-bg);
	}

	@media (max-width: 480px) {
		.menu {
			left: 0;
			right: auto;
			width: min(18rem, calc(100vw - var(--space-4)));
		}
	}

	.connect {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: var(--space-2);
		max-width: 16rem;
	}

	.hint {
		margin: 0;
		font-size: 0.9rem;
		color: var(--color-muted);
	}

	.approve {
		text-align: center;
		color: var(--color-accent);
	}

	.connect-actions {
		display: flex;
		gap: var(--space-2);
		justify-content: flex-end;
	}

	button {
		padding: var(--space-1) var(--space-2);
		font: inherit;
		color: var(--color-accent-contrast);
		background: var(--color-accent);
		border: 1px solid var(--color-accent);
		border-radius: var(--radius);
		cursor: pointer;
	}

	button:disabled {
		cursor: progress;
		opacity: 0.7;
	}

	.error {
		margin: 0;
		color: var(--color-danger);
		font-size: 0.9rem;
	}

	.demo-btn {
		color: var(--color-text);
		background: transparent;
		border-color: var(--color-border);
		font-size: 0.85rem;
	}

	.demo-badge {
		display: inline-block;
		padding: 0 0.3rem;
		font-size: 0.65rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		color: var(--color-accent-contrast);
		background: var(--color-accent);
		border-radius: 2px;
		vertical-align: middle;
	}

	.balance {
		font-size: 0.8rem;
		color: var(--color-text);
		font-weight: 500;
	}

	.credit-history {
		font-size: 0.8rem;
		color: var(--color-text);
	}

	.credit-history summary {
		cursor: pointer;
		color: var(--color-accent);
	}

	.credit-history ul {
		margin: var(--space-1) 0 0;
		padding-left: 1.1rem;
		max-height: 8rem;
		overflow-y: auto;
	}

	.credit-history li {
		color: var(--color-muted);
	}

	.history-empty {
		margin: var(--space-1) 0 0;
		color: var(--color-muted);
	}
</style>
