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
	import { Check, Copy, Download, X } from '@lucide/svelte';
	import { auth, type AuthError } from '$lib/state/auth.svelte';
	import { t, ti, type TranslationKey } from '$lib/i18n/index.svelte';
	import {
		ACCOUNT_KEY_FILENAME,
		createAccountKey,
		formatAccountKeyFile,
		rememberAccountKey,
		type AccountKeyPair
	} from '$lib/nostr/local-key';
	import { logBoundaryError } from '$lib/utils';

	interface Props {
		replacing: boolean;
		onClose: () => void;
	}

	let { replacing, onClose }: Props = $props();

	const errorKeys: Record<AuthError, TranslationKey> = {
		extension_missing: 'auth.error.extensionMissing',
		rejected: 'auth.error.rejected',
		failed: 'auth.error.failed'
	};

	let step = $state<'intro' | 'keys'>('intro');
	let pair = $state<AccountKeyPair | null>(null);
	let copied = $state(false);
	let downloaded = $state(false);
	let acknowledged = $state(false);
	let copyError = $state<string | null>(null);
	let attempted = $state(false);

	const stepNumber = $derived(step === 'intro' ? 1 : 2);
	const saved = $derived(copied || downloaded);
	const canFinish = $derived(
		pair !== null && acknowledged && saved && auth.status !== 'connecting'
	);
	const setupError = $derived(attempted ? auth.error : null);

	function revealKeys(): void {
		pair = createAccountKey();
		copied = false;
		downloaded = false;
		acknowledged = false;
		copyError = null;
		attempted = false;
		step = 'keys';
	}

	function back(): void {
		pair = null;
		copied = false;
		downloaded = false;
		acknowledged = false;
		copyError = null;
		step = 'intro';
	}

	async function copySecret(): Promise<void> {
		if (!pair) return;
		copyError = null;
		try {
			await navigator.clipboard.writeText(pair.nsec);
			copied = true;
		} catch (error) {
			copied = false;
			copyError = t('auth.setup.copyFailed');
			logBoundaryError('accountSetup.copySecret', error);
		}
	}

	function downloadKeyFile(): void {
		if (!pair) return;
		const contents = formatAccountKeyFile({
			title: t('auth.setup.fileTitle'),
			publicLabel: t('auth.setup.publicLabel'),
			publicKey: pair.npub,
			secretLabel: t('auth.setup.secretLabel'),
			secretKey: pair.nsec,
			warning: t('auth.setup.fileWarning')
		});
		const url = URL.createObjectURL(new Blob([contents], { type: 'text/plain;charset=utf-8' }));
		const link = document.createElement('a');
		link.href = url;
		link.download = ACCOUNT_KEY_FILENAME;
		document.body.appendChild(link);
		link.click();
		link.remove();
		URL.revokeObjectURL(url);
		downloaded = true;
	}

	async function finish(): Promise<void> {
		if (!pair || !canFinish) return;
		rememberAccountKey(pair.secretKey);
		attempted = true;
		await auth.loginWithSecretKey(pair.secretKey);
		if (auth.status === 'authenticated') onClose();
	}

	function attachDialog(node: HTMLDialogElement): () => void {
		node.showModal();
		const handleClose = () => onClose();
		node.addEventListener('close', handleClose);
		return () => {
			node.removeEventListener('close', handleClose);
			if (node.open) node.close();
		};
	}
</script>

<dialog class="setup-dialog" {@attach attachDialog} aria-labelledby="account-setup-title">
	<div class="dialog-header">
		<div>
			<p class="progress">{ti('auth.setup.progress', { current: stepNumber, total: 2 })}</p>
			<h2 id="account-setup-title">{t('auth.setup.title')}</h2>
		</div>
		<button type="button" class="close-button" onclick={onClose}>
			<X size={16} strokeWidth={1.8} aria-hidden="true" />
			<span class="visually-hidden">{t('auth.setup.close')}</span>
		</button>
	</div>

	{#if step === 'intro'}
		<section class="step">
			<h3>{t('auth.setup.introTitle')}</h3>
			<p>{t('auth.setup.intro')}</p>
			{#if replacing}
				<p class="replace" role="status">{t('auth.setup.replace')}</p>
			{/if}
			<button type="button" onclick={revealKeys}>{t('auth.setup.createKeys')}</button>
		</section>
	{:else if pair}
		<section class="step">
			<h3>{t('auth.setup.keysTitle')}</h3>
			<div class="key-slip">
				<div>
					<p class="key-label">{t('auth.setup.publicLabel')}</p>
					<p class="key-value">{pair.npub}</p>
				</div>
				<div class="secret">
					<p class="key-label">{t('auth.setup.secretLabel')}</p>
					<p class="key-value">{pair.nsec}</p>
					<p class="secret-hint">{t('auth.setup.secretHint')}</p>
				</div>
			</div>
			<div class="save-actions">
				<button type="button" class="secondary" onclick={() => void copySecret()}>
					{#if copied}
						<Check size={16} strokeWidth={1.8} aria-hidden="true" />
						{t('auth.setup.copiedSecret')}
					{:else}
						<Copy size={16} strokeWidth={1.8} aria-hidden="true" />
						{t('auth.setup.copySecret')}
					{/if}
				</button>
				<button type="button" class="secondary" onclick={downloadKeyFile}>
					<Download size={16} strokeWidth={1.8} aria-hidden="true" />
					{t('auth.setup.download')}
				</button>
			</div>
			{#if copyError}
				<p class="error" role="alert">{copyError}</p>
			{/if}
			<label class="ack">
				<input type="checkbox" bind:checked={acknowledged} />
				<span>{t('auth.setup.ack')}</span>
			</label>
			{#if setupError}
				<p class="error" role="alert">{t(errorKeys[setupError])}</p>
			{/if}
			<div class="finish-row">
				<button
					type="button"
					class="secondary"
					onclick={back}
					disabled={auth.status === 'connecting'}
				>
					{t('auth.setup.back')}
				</button>
				<button type="button" onclick={() => void finish()} disabled={!canFinish}>
					{auth.status === 'connecting' ? t('auth.connecting') : t('auth.setup.finish')}
				</button>
			</div>
		</section>
	{/if}
</dialog>

<style>
	.setup-dialog {
		width: min(100% - 2rem, 32rem);
		max-height: calc(100% - 2rem);
		margin: auto;
		padding: 1.25rem;
		overflow: auto;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		color: var(--color-text);
		box-shadow: var(--shadow-lg);
	}

	.setup-dialog::backdrop {
		background: rgb(29 29 31 / 0.32);
		backdrop-filter: blur(4px);
	}

	.dialog-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}

	.progress {
		margin: 0 0 0.25rem;
		color: var(--color-accent-text);
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	h2,
	h3,
	p {
		margin: 0;
	}

	h2 {
		font-size: 1.25rem;
		font-weight: 700;
	}

	h3 {
		font-size: 1rem;
		font-weight: 600;
	}

	.close-button {
		display: inline-flex;
		flex: 0 0 auto;
		align-items: center;
		justify-content: center;
		width: 2.5rem;
		height: 2.5rem;
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: 50%;
		background: var(--color-background);
		color: var(--color-text);
		cursor: pointer;
	}

	.close-button:hover,
	.close-button:focus-visible {
		border-color: var(--color-accent);
		color: var(--color-accent-text);
	}

	.step {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		margin-top: 1rem;
	}

	.step > p {
		color: var(--color-muted-strong);
		font-size: 0.9375rem;
		line-height: 1.5;
	}

	.replace {
		padding: 0.75rem 0.875rem;
		border-radius: var(--radius-sm);
		background: var(--color-warning-bg);
		color: var(--color-warning-text);
		font-size: 0.875rem;
		line-height: 1.45;
	}

	.key-slip {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		padding: 0.9rem 1rem;
		border: 1px solid var(--color-border);
		border-left: 4px solid var(--color-accent);
		border-radius: var(--radius);
		background: var(--color-background);
	}

	.secret {
		padding-top: 0.875rem;
		border-top: 1px solid var(--color-border);
	}

	.key-label {
		margin-bottom: 0.35rem;
		color: var(--color-muted);
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.03em;
		text-transform: uppercase;
	}

	.key-value {
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 0.8125rem;
		line-height: 1.45;
		overflow-wrap: anywhere;
		user-select: all;
	}

	.secret-hint {
		margin-top: 0.5rem;
		color: var(--color-muted-strong);
		font-size: 0.8125rem;
		line-height: 1.4;
	}

	.save-actions,
	.finish-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.finish-row {
		justify-content: flex-end;
	}

	button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		padding: 0.55rem 0.9rem;
		font: inherit;
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-accent-contrast);
		background: var(--color-accent);
		border: 1px solid var(--color-accent);
		border-radius: var(--radius);
		cursor: pointer;
	}

	button:focus-visible {
		outline: 2px solid var(--color-border-focus);
		outline-offset: 2px;
	}

	button:disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}

	.secondary {
		color: var(--color-text);
		background: var(--color-surface);
		border-color: var(--color-border);
	}

	.ack {
		display: flex;
		align-items: flex-start;
		gap: 0.625rem;
		font-size: 0.875rem;
		line-height: 1.4;
		cursor: pointer;
	}

	.ack input {
		width: 1rem;
		height: 1rem;
		margin-top: 0.15rem;
		accent-color: var(--color-accent);
	}

	.error {
		color: var(--color-danger);
		font-size: 0.875rem;
	}

	@media (prefers-reduced-motion: reduce) {
		.setup-dialog::backdrop {
			backdrop-filter: none;
		}
	}
</style>
