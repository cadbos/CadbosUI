<script lang="ts">
	import { npubEncode } from 'nostr-tools/nip19';
	import { auth, type AuthError } from '$lib/state/auth.svelte';
	import { t, type TranslationKey } from '$lib/i18n/index.svelte';
	import QrCode from './QrCode.svelte';

	const errorKeys: Record<AuthError, TranslationKey> = {
		extension_missing: 'auth.error.extensionMissing',
		rejected: 'auth.error.rejected',
		failed: 'auth.error.failed'
	};

	const shortNpub = $derived.by(() => {
		if (!auth.pubkey) return '';
		const npub = npubEncode(auth.pubkey);
		return `${npub.slice(0, 12)}…${npub.slice(-6)}`;
	});

	// Track which URI was copied so the hint resets automatically when a fresh
	// connection (a different URI) is started.
	let copiedUri = $state<string | null>(null);
	const copied = $derived(copiedUri !== null && copiedUri === auth.connectUri);

	async function copyUri(): Promise<void> {
		if (!auth.connectUri) return;
		await navigator.clipboard.writeText(auth.connectUri);
		copiedUri = auth.connectUri;
	}
</script>

<div class="auth">
	{#if auth.status === 'authenticated'}
		<span class="who" title={auth.pubkey ?? ''}>{shortNpub}</span>
		<button type="button" onclick={() => auth.logout()}>{t('auth.logout')}</button>
	{:else if auth.connectUri}
		<div class="connect">
			<p class="hint">{t('auth.connect.scan')}</p>
			<QrCode data={auth.connectUri} label={t('auth.connect.qrAlt')} />
			{#if auth.authUrl}
				<a class="approve" href={auth.authUrl} target="_blank" rel="noopener noreferrer">
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
		<button type="button" onclick={() => auth.loginNip07()} disabled={auth.status === 'connecting'}>
			{auth.status === 'connecting' ? t('auth.connecting') : t('auth.login.nip07')}
		</button>
		<button type="button" onclick={() => auth.loginNip46()} disabled={auth.status === 'connecting'}>
			{t('auth.login.nip46')}
		</button>
		{#if auth.error}
			<p class="error" role="alert">{t(errorKeys[auth.error])}</p>
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
		font-size: 0.9rem;
		color: var(--color-muted);
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
</style>
