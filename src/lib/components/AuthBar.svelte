<script lang="ts">
	import { npubEncode } from 'nostr-tools/nip19';
	import { auth, type AuthError } from '$lib/state/auth.svelte';
	import { t, type TranslationKey } from '$lib/i18n/index.svelte';

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
</script>

<div class="auth">
	{#if auth.status === 'authenticated'}
		<span class="who" title={auth.pubkey ?? ''}>{shortNpub}</span>
		<button type="button" onclick={() => auth.logout()}>{t('auth.logout')}</button>
	{:else}
		<button type="button" onclick={() => auth.loginNip07()} disabled={auth.status === 'connecting'}>
			{auth.status === 'connecting' ? t('auth.connecting') : t('auth.login.nip07')}
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
