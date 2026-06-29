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

	let menuOpen = $state(false);

	// Track which URI was copied so the hint resets automatically when a fresh
	// connection (a different URI) is started.
	let copiedUri = $state<string | null>(null);
	const copied = $derived(copiedUri !== null && copiedUri === auth.connectUri);

	async function copyUri(): Promise<void> {
		if (!auth.connectUri) return;
		await navigator.clipboard.writeText(auth.connectUri);
		copiedUri = auth.connectUri;
	}

	function choose(method: () => Promise<void>): void {
		menuOpen = false;
		method();
	}

	// Dismiss the open menu on an outside pointer press or Escape. An attachment
	// keeps the listeners tied to the element's lifetime without an effect.
	function dismissable(node: HTMLElement) {
		const onPointer = (event: PointerEvent) => {
			if (menuOpen && !node.contains(event.target as Node)) menuOpen = false;
		};
		const onKey = (event: KeyboardEvent) => {
			if (!menuOpen || event.key !== 'Escape') return;
			menuOpen = false;
			// Return focus to the trigger so keyboard users aren't dropped to <body>.
			node.querySelector<HTMLButtonElement>('.trigger')?.focus();
		};
		window.addEventListener('pointerdown', onPointer);
		window.addEventListener('keydown', onKey);
		return () => {
			window.removeEventListener('pointerdown', onPointer);
			window.removeEventListener('keydown', onKey);
		};
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
		<div class="signin" {@attach dismissable}>
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
		z-index: 1;
		display: flex;
		flex-direction: column;
		min-width: 12rem;
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
