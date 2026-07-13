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
	import { onDestroy, onMount } from 'svelte';
	import { t, ti } from '$lib/i18n/index.svelte';
	import { deposits } from '$lib/state/deposits.svelte';
	import { formatCredit } from '$lib/utils';
	import QrCode from './QrCode.svelte';

	interface Props {
		onClose: () => void;
	}
	let { onClose }: Props = $props();

	type View = 'packages' | 'invoice' | 'result';

	const view = $derived.by((): View => {
		if (deposits.depositStatus === 'paid' || deposits.depositStatus === 'expired') return 'result';
		if (deposits.depositStatus === 'creating' || deposits.depositStatus === 'polling')
			return 'invoice';
		return 'packages';
	});

	// Tracks which bolt11 was copied so the hint resets when a fresh invoice
	// (a different bolt11) replaces the copied one.
	let copiedInvoice = $state<string | null>(null);
	const copied = $derived(
		copiedInvoice !== null && copiedInvoice === deposits.activeDeposit?.bolt11
	);

	// Autofocuses the "paid" screen's close button: an attachment runs once the
	// node is inserted, which only happens when that screen becomes active.
	function autofocus(node: HTMLElement): void {
		node.focus();
	}

	onMount(() => {
		if (deposits.packagesStatus === 'idle') void deposits.loadPackages();
	});

	onDestroy(() => {
		deposits.reset();
	});

	function close(): void {
		deposits.reset();
		onClose();
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') close();
	}

	async function copyInvoice(): Promise<void> {
		const bolt11 = deposits.activeDeposit?.bolt11;
		if (!bolt11) return;
		try {
			await navigator.clipboard.writeText(bolt11);
			copiedInvoice = bolt11;
		} catch {
			// Clipboard unavailable (denied permission / insecure context) — the
			// invoice text stays visible so the user can select and copy manually.
		}
	}
</script>

<div class="dialog-overlay">
	<dialog
		class="top-up-dialog"
		open
		aria-modal="true"
		aria-labelledby="top-up-title"
		onkeydown={handleKeydown}
	>
		<div class="dialog-header">
			<h2 id="top-up-title">{t('deposit.title')}</h2>
			<button type="button" class="icon-close" aria-label={t('deposit.close')} onclick={close}>
				&times;
			</button>
		</div>

		<div class="dialog-body">
			{#if view === 'packages'}
				{#if deposits.packagesStatus === 'loading'}
					<p class="status">{t('deposit.packagesLoading')}</p>
				{:else if deposits.packagesStatus === 'error'}
					<p class="status error" role="alert">{t('deposit.packagesFailed')}</p>
					<button type="button" onclick={() => void deposits.loadPackages()}>
						{t('deposit.tryAgain')}
					</button>
				{:else if deposits.packagesStatus === 'ready' && deposits.packages.length === 0}
					<p class="status">{t('deposit.packagesEmpty')}</p>
				{:else}
					<ul class="packages">
						{#each deposits.packages as pkg (pkg.id)}
							<li>
								<button
									type="button"
									class="package-card"
									disabled={deposits.depositStatus === 'creating'}
									onclick={() => void deposits.createDeposit(pkg.id)}
								>
									<span class="package-price">${pkg.usdAmount}</span>
									<span class="package-credits">
										{ti('deposit.packageCredits', { credits: formatCredit(pkg.creditsAwarded) })}
									</span>
									<span class="package-buy">{t('deposit.buy')}</span>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
				{#if deposits.depositStatus === 'error'}
					<p class="status error" role="alert">
						{deposits.depositError === 'rate_limited'
							? t('deposit.rateLimited')
							: t('deposit.createFailed')}
					</p>
				{/if}
			{:else if view === 'invoice'}
				<h3>{t('deposit.invoiceTitle')}</h3>
				{#if deposits.depositStatus === 'creating' || !deposits.activeDeposit}
					<p class="status">{t('deposit.creating')}</p>
				{:else}
					<QrCode data={deposits.activeDeposit.bolt11} label={t('deposit.qrAlt')} />
					<p class="invoice-text">{deposits.activeDeposit.bolt11}</p>
					<button type="button" class="secondary" onclick={() => void copyInvoice()}>
						{copied ? t('deposit.copied') : t('deposit.copyInvoice')}
					</button>
					<p class="amount">
						{ti('deposit.amountSats', { sats: deposits.activeDeposit.satsAmount })}
					</p>
					<p class="waiting" aria-live="polite">{t('deposit.waitingPayment')}</p>
				{/if}
			{:else if deposits.depositStatus === 'paid'}
				<p class="status success" role="status">{t('deposit.paid')}</p>
				<button type="button" {@attach autofocus} onclick={close}>{t('deposit.close')}</button>
			{:else}
				<p class="status error" role="alert">{t('deposit.expired')}</p>
				<button type="button" onclick={() => deposits.reset()}>{t('deposit.tryAgain')}</button>
			{/if}
		</div>
	</dialog>
</div>

<style>
	.dialog-overlay {
		position: fixed;
		inset: 0;
		z-index: 10;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-2);
		background: color-mix(in srgb, var(--color-text) 42%, transparent);
	}

	.top-up-dialog {
		width: min(100%, 26rem);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		max-width: none;
		margin: 0;
		padding: var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		box-shadow: var(--shadow-lg);
	}

	.dialog-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	h2 {
		margin: 0;
		color: var(--color-text);
		font-size: 1.1rem;
		font-weight: 650;
	}

	h3 {
		margin: 0;
		color: var(--color-text);
		font-size: 1rem;
		font-weight: 650;
	}

	.icon-close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		padding: 0;
		color: var(--color-muted);
		background: transparent;
		border: none;
		font-size: 1.25rem;
		line-height: 1;
		cursor: pointer;
	}

	.icon-close:hover {
		color: var(--color-text);
	}

	.dialog-body {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: var(--space-2);
	}

	.status {
		margin: 0;
		color: var(--color-muted);
		font-size: 0.9rem;
	}

	.status.error {
		color: var(--color-danger);
	}

	.status.success {
		color: var(--color-accent);
		font-weight: 600;
	}

	.packages {
		display: grid;
		gap: var(--space-2);
		padding: 0;
		margin: 0;
		list-style: none;
	}

	.package-card {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding: var(--space-2);
		color: var(--color-text);
		background: var(--color-background);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		cursor: pointer;
		text-align: left;
	}

	.package-card:hover:not(:disabled) {
		border-color: var(--color-accent);
	}

	.package-card:disabled {
		cursor: progress;
		opacity: 0.65;
	}

	.package-price {
		font-size: 1.1rem;
		font-weight: 700;
	}

	.package-credits {
		flex: 1;
		color: var(--color-muted);
		font-size: 0.85rem;
	}

	.package-buy {
		padding: var(--space-1) var(--space-2);
		color: var(--color-accent-contrast);
		background: var(--color-accent);
		border-radius: var(--radius-sm);
		font-size: 0.85rem;
		font-weight: 650;
	}

	.invoice-text {
		margin: 0;
		padding: var(--space-1);
		color: var(--color-text);
		background: var(--color-background);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		font-family: ui-monospace, monospace;
		font-size: 0.75rem;
		overflow-wrap: anywhere;
		user-select: all;
	}

	.amount {
		margin: 0;
		color: var(--color-text);
		font-weight: 600;
	}

	.waiting {
		margin: 0;
		color: var(--color-muted);
		font-size: 0.85rem;
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

	button.secondary {
		color: var(--color-text);
		background: var(--color-surface);
		border-color: var(--color-border);
	}
</style>
