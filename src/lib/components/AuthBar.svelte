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
	import { ArrowUpRight, Check, ChevronRight, Copy, LogOut, User } from '@lucide/svelte';
	import { dev } from '$app/environment';
	import { resolve } from '$app/paths';
	import { npubEncode } from 'nostr-tools/nip19';
	import { auth, type AuthError } from '$lib/state/auth.svelte';
	import { currency } from '$lib/state/currency.svelte';
	import { t, ti, type TranslationKey } from '$lib/i18n/index.svelte';
	import { dismissable, logBoundaryError } from '$lib/utils';
	import QrCode from './QrCode.svelte';
	import CurrencySwitcher from './CurrencySwitcher.svelte';
	import LanguageSwitcher from './LanguageSwitcher.svelte';
	import ThemeToggle from './ThemeToggle.svelte';

	const errorKeys: Record<AuthError, TranslationKey> = {
		extension_missing: 'auth.error.extensionMissing',
		rejected: 'auth.error.rejected',
		failed: 'auth.error.failed'
	};

	const npub = $derived(auth.pubkey ? npubEncode(auth.pubkey) : null);
	const shortNpub = $derived(npub ? `${npub.slice(0, 12)}…${npub.slice(-6)}` : '');
	const primalUrl = $derived(npub ? `https://primal.net/profile/${npub}` : null);

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

	let npubCopied = $state(false);
	let npubCopyError = $state<string | null>(null);
	let npubCopyResetTimer: ReturnType<typeof setTimeout> | undefined;

	async function copyNpub(value: string): Promise<void> {
		npubCopyError = null;
		try {
			await navigator.clipboard.writeText(value);
			npubCopied = true;
			clearTimeout(npubCopyResetTimer);
			npubCopyResetTimer = setTimeout(() => (npubCopied = false), 2000);
		} catch (error) {
			npubCopied = false;
			npubCopyError = t('auth.profile.npubCopyFailed');
			logBoundaryError('authBar.copyNpub', error);
		}
	}

	async function saveProfile(): Promise<void> {
		savingProfile = true;
		saveError = null;
		try {
			await auth.saveProfile();
		} catch {
			saveError = t('auth.profile.saveError');
		} finally {
			savingProfile = false;
		}
	}

	// Commit the field immediately on Enter instead of waiting for blur — blurring
	// fires the native 'change' event, which is what triggers the autosave below.
	function commitOnEnter(event: KeyboardEvent): void {
		if (event.key === 'Enter') (event.currentTarget as HTMLInputElement).blur();
	}
</script>

<div class="auth">
	<div
		class="profile"
		{@attach dismissable(
			() => profileOpen,
			() => (profileState = 'closed'),
			'.auth-trigger'
		)}
	>
		<div class="profile-chip">
			<button
				type="button"
				class="auth-trigger"
				aria-expanded={profileOpen}
				aria-controls="auth-panel"
				onclick={() => (profileState = profileOpen ? 'closed' : 'open')}
			>
				{#if auth.nostrProfile?.picture}
					<img src={auth.nostrProfile.picture} alt="" />
				{:else if auth.status === 'authenticated'}
					<span class="avatar" aria-hidden="true">{displayName.slice(0, 1).toUpperCase()}</span>
				{:else}
					<span class="avatar avatar-guest" aria-hidden="true">
						<User size={16} strokeWidth={1.8} />
					</span>
				{/if}
				<span class="identity">
					{#if auth.status === 'authenticated'}
						{#if dev && auth.user?.pubkey?.startsWith('000000')}
							<span class="demo-badge">{t('auth.demo.badge')}</span>
						{/if}
						<span class="display">{displayName}</span>
						<span class="who" title={auth.pubkey ?? ''}>{shortNpub}</span>
					{:else}
						<span class="display">{t('auth.guest')}</span>
					{/if}
				</span>
			</button>
			{#if auth.status === 'authenticated'}
				<div class="chip-actions">
					{#if primalUrl}
						<a
							class="chip-action"
							href={primalUrl}
							target="_blank"
							rel="noopener noreferrer"
							title={t('auth.profile.viewOnPrimal')}
						>
							<ArrowUpRight size={13} strokeWidth={1.8} aria-hidden="true" />
							<span class="visually-hidden">{t('auth.profile.viewOnPrimal')}</span>
						</a>
					{/if}
					<button
						type="button"
						class="chip-action"
						class:chip-action-error={npubCopyError !== null}
						title={npubCopyError ??
							(npubCopied ? t('auth.profile.npubCopied') : t('auth.profile.npubCopy'))}
						onclick={() => npub && copyNpub(npub)}
					>
						{#if npubCopied}
							<Check size={13} strokeWidth={2} aria-hidden="true" />
						{:else}
							<Copy size={13} strokeWidth={1.8} aria-hidden="true" />
						{/if}
						<span class="visually-hidden" aria-live="polite">
							{npubCopyError ??
								(npubCopied ? t('auth.profile.npubCopied') : t('auth.profile.npubCopy'))}
						</span>
					</button>
				</div>
			{/if}
		</div>
		<div id="auth-panel" class="auth-panel" hidden={!profileOpen}>
			{#if auth.status === 'authenticated'}
				{#if auth.nostrProfile?.about}
					<p class="bio">{auth.nostrProfile.about}</p>
				{/if}

				{#if missingCadbosName}
					<span class="notice">{t('auth.profile.completeHint')}</span>
				{/if}

				<div class="profile-fields">
					<label class="airy-field">
						<span class="visually-hidden">{t('auth.profile.firstName')}</span>
						<input
							class="airy-input"
							autocomplete="given-name"
							placeholder={t('auth.profile.firstName')}
							bind:value={auth.profileDraft.firstName}
							onchange={saveProfile}
							onkeydown={commitOnEnter}
						/>
					</label>
					<label class="airy-field">
						<span class="visually-hidden">{t('auth.profile.lastName')}</span>
						<input
							class="airy-input"
							autocomplete="family-name"
							placeholder={t('auth.profile.lastName')}
							bind:value={auth.profileDraft.lastName}
							onchange={saveProfile}
							onkeydown={commitOnEnter}
						/>
					</label>
					{#if savingProfile}
						<p class="saving-hint" aria-live="polite">{t('auth.profile.saving')}</p>
					{/if}
					{#if saveError}
						<p class="error" role="alert">{saveError}</p>
					{/if}
				</div>
			{:else if auth.connectUri}
				<div class="connect">
					<p class="hint">{t('auth.connect.scan')}</p>
					<QrCode data={auth.connectUri} label={t('auth.connect.qrAlt')} />
					{#if auth.authUrl}
						<a
							class="approve"
							href={auth.authUrl}
							target="_blank"
							rel="external noopener noreferrer"
						>
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
			{:else if auth.status === 'connecting'}
				<p class="restoring" role="status">{t('auth.connecting')}</p>
			{:else if auth.status === 'restoring'}
				<p class="restoring" role="status">{t('auth.restoring')}</p>
			{:else}
				<p class="notice">{t('auth.signIn')}</p>
				<button type="button" onclick={() => auth.loginNip07()}>
					{t('auth.login.nip07')}
				</button>
				<button type="button" onclick={() => auth.loginNip46()}>
					{t('auth.login.nip46')}
				</button>
				{#if auth.error}
					<p class="error" role="alert">{t(errorKeys[auth.error])}</p>
				{/if}
				{#if dev}
					<button type="button" class="demo-btn" onclick={() => void auth.loginDemo()}>
						{t('auth.demo.login')}
					</button>
				{/if}
			{/if}

			<div class="bottom-row">
				<a
					class="balance-link"
					href={resolve('/expenses', {})}
					onclick={() => (profileState = 'closed')}
				>
					<span
						>{ti('auth.credit.balance', {
							balance: currency.format(auth.credit?.balance ?? 0)
						})}</span
					>
					<ChevronRight size={14} strokeWidth={1.8} aria-hidden="true" />
				</a>
				{#if auth.status === 'authenticated'}
					<button
						type="button"
						class="logout-button"
						title={t('auth.logout')}
						onclick={() => auth.logout()}
					>
						<LogOut size={16} strokeWidth={1.8} aria-hidden="true" />
						<span class="visually-hidden">{t('auth.logout')}</span>
					</button>
				{/if}
			</div>

			<p class="relay-count">{ti('auth.profile.relayCount', { count: relayCount })}</p>

			<div class="settings-row">
				<LanguageSwitcher />
				<CurrencySwitcher />
				<ThemeToggle />
			</div>
		</div>
	</div>
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

	.profile-chip {
		display: flex;
		align-items: stretch;
		min-width: 16.53rem;
		padding: var(--space-1);
		color: var(--color-text);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
	}

	.auth-trigger {
		display: inline-flex;
		flex: 1;
		align-items: center;
		justify-content: flex-start;
		gap: var(--space-1);
		min-width: 0;
		padding: 0;
		color: inherit;
		background: transparent;
		border: none;
	}

	.auth-trigger img,
	.avatar {
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		flex: 0 0 auto;
	}

	.auth-trigger img {
		object-fit: cover;
	}

	.chip-actions {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		margin-left: var(--space-1);
	}

	.chip-action {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.4rem;
		height: 1.4rem;
		padding: 0;
		color: var(--color-muted);
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
	}

	.chip-action:hover,
	.chip-action:focus-visible {
		color: var(--color-accent);
		background: var(--color-bg);
		border-color: var(--color-border);
	}

	.chip-action-error {
		color: var(--color-danger);
		border-color: var(--color-danger);
	}

	.avatar {
		display: grid;
		place-items: center;
		color: var(--color-accent-contrast);
		background: var(--color-accent);
		font-weight: 700;
	}

	.avatar-guest {
		color: var(--color-muted);
		background: var(--color-border);
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

	.auth-panel {
		position: absolute;
		right: 0;
		top: calc(100% + var(--space-1));
		z-index: 2;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		width: min(22rem, calc(100vw - var(--space-4)));
		padding: var(--space-2);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		box-shadow: var(--shadow-lg);
	}

	.auth-panel[hidden] {
		display: none;
	}

	.notice {
		font-size: 0.85rem;
		color: var(--color-text);
	}

	.profile-fields {
		display: grid;
		gap: var(--space-2);
	}

	.saving-hint {
		margin: 0;
		color: var(--color-muted);
		font-size: 0.85rem;
	}

	.settings-row {
		display: flex;
		align-items: center;
		gap: var(--space-1);
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
		color: var(--color-accent-text);
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

	.restoring {
		margin: 0;
		color: var(--color-muted);
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

	.bio {
		margin: 0;
		color: var(--color-muted-strong);
		font-size: 0.85rem;
		line-height: 1.4;
	}

	.bottom-row {
		display: flex;
		align-items: stretch;
		gap: var(--space-1);
	}

	.balance-link {
		display: flex;
		flex: 1;
		align-items: center;
		justify-content: space-between;
		min-width: 0;
		padding: 0.4rem 0.75rem;
		color: var(--color-text);
		background: color-mix(in srgb, var(--color-accent) 8%, var(--color-surface));
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		font-size: 0.9rem;
		font-weight: 600;
		text-decoration: none;
		transition:
			border-color 0.15s,
			background 0.15s;
	}

	.logout-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.2rem;
		padding: 0;
		color: var(--color-muted);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
	}

	.logout-button:hover,
	.logout-button:focus-visible {
		color: var(--color-danger);
		background: var(--color-danger-bg);
		border-color: var(--color-danger);
	}

	.balance-link:hover,
	.balance-link:focus-visible {
		border-color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 14%, var(--color-surface));
	}

	.airy-field {
		display: block;
	}

	.airy-input {
		width: 100%;
		box-sizing: border-box;
		padding: 0.35rem 0;
		font: inherit;
		color: var(--color-text);
		background: transparent;
		border: none;
		border-bottom: 1px solid var(--color-border);
		border-radius: 0;
	}

	.airy-input::placeholder {
		color: var(--color-muted);
	}

	.airy-input:focus-visible {
		outline: none;
		border-bottom-color: var(--color-accent);
	}

	.relay-count {
		margin: 0;
		color: var(--color-muted);
		font-size: 0.78rem;
	}
</style>
