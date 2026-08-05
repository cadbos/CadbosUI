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
	import { Dialog } from 'bits-ui';
	import { onDestroy } from 'svelte';

	import QrCode from '$lib/components/QrCode.svelte';
	import { getLocale, t, ti } from '$lib/i18n/index.svelte';
	import { auth } from '$lib/state/auth.svelte';
	import { deposits } from '$lib/state/deposits.svelte';
	import { formatCredit } from '$lib/utils';

	let open = $state(false);

	const selectedPackage = $derived(
		deposits.packages.find((item) => item.id === deposits.selectedPackageId) ?? null
	);
	const invoiceCopied = $derived(
		deposits.deposit?.bolt11 !== undefined && deposits.copiedBolt11 === deposits.deposit.bolt11
	);
	const canCreate = $derived(selectedPackage !== null && !deposits.creating);

	onDestroy(() => deposits.deactivate());

	function handleOpenChange(next: boolean): void {
		open = next;
		const pubkey = auth.pubkey;
		if (next && pubkey) deposits.activate(pubkey);
		else deposits.deactivate();
	}

	function formatUsd(amount: number): string {
		return new Intl.NumberFormat(getLocale(), {
			style: 'currency',
			currency: 'USD',
			minimumFractionDigits: 0,
			maximumFractionDigits: 2
		}).format(amount);
	}

	function formatExpiry(value: number): string {
		return new Intl.DateTimeFormat(getLocale(), {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(new Date(value));
	}
</script>

<Dialog.Root {open} onOpenChange={handleOpenChange}>
	<Dialog.Trigger class="top-up-dialog-trigger">{t('topUp.trigger')}</Dialog.Trigger>
	<Dialog.Portal>
		<Dialog.Overlay class="top-up-dialog-overlay" />
		<Dialog.Content class="top-up-dialog-content" data-top-up-dialog>
			<header>
				<div>
					<Dialog.Title class="top-up-dialog-title">{t('topUp.title')}</Dialog.Title>
					<Dialog.Description class="top-up-dialog-description">
						{t('topUp.description')}
					</Dialog.Description>
				</div>
				<Dialog.Close class="top-up-dialog-close" aria-label={t('topUp.close')}>×</Dialog.Close>
			</header>

			{#if deposits.deposit}
				<section class="payment" aria-live="polite">
					{#if deposits.deposit.status === 'paid'}
						<div class="result success">
							<span class="result-icon" aria-hidden="true">✓</span>
							<h3>{t('topUp.paid.title')}</h3>
							<p>{t('topUp.paid.description')}</p>
							{#if deposits.deposit.balance !== undefined}
								<p class="new-balance">
									{ti('topUp.paid.balance', {
										balance: formatCredit(deposits.deposit.balance)
									})}
								</p>
							{/if}
							<button type="button" onclick={() => deposits.startAnother()}>
								{t('topUp.another')}
							</button>
						</div>
					{:else if deposits.deposit.status === 'expired' || deposits.deposit.status === 'failed'}
						<div class="result failed">
							<span class="result-icon" aria-hidden="true">!</span>
							<h3>
								{deposits.deposit.status === 'expired'
									? t('topUp.expired.title')
									: t('topUp.failed.title')}
							</h3>
							<p>
								{deposits.deposit.status === 'expired'
									? t('topUp.expired.description')
									: t('topUp.failed.description')}
							</p>
							<button type="button" onclick={() => deposits.retryAttempt()}>
								{t('topUp.retryPayment')}
							</button>
						</div>
					{:else}
						<h3>{t('topUp.invoice.title')}</h3>
						{#if deposits.deposit.bolt11}
							<div class="qr-wrap">
								<QrCode data={deposits.deposit.bolt11} label={t('topUp.invoice.qrAlt')} />
							</div>
							<dl>
								{#if deposits.deposit.satsAmount !== undefined}
									<div>
										<dt>{t('topUp.invoice.amount')}</dt>
										<dd>{ti('topUp.invoice.sats', { sats: deposits.deposit.satsAmount })}</dd>
									</div>
								{/if}
								{#if deposits.deposit.expiresAt !== undefined}
									<div>
										<dt>{t('topUp.invoice.expires')}</dt>
										<dd>{formatExpiry(deposits.deposit.expiresAt)}</dd>
									</div>
								{/if}
							</dl>
							<button type="button" class="copy" onclick={() => void deposits.copyInvoice()}>
								{invoiceCopied ? t('topUp.invoice.copied') : t('topUp.invoice.copy')}
							</button>
							{#if deposits.copyFailed}
								<p class="error" role="alert">{t('topUp.invoice.copyFailed')}</p>
							{/if}
						{:else}
							<div class="loading-row" role="status">
								<span class="spinner" aria-hidden="true"></span>
								<span>{t('topUp.invoice.preparing')}</span>
							</div>
						{/if}
						<p class="pending">{t('topUp.invoice.pending')}</p>
						{#if deposits.pollWarning}
							<p class="warning" role="status">{t('topUp.invoice.pollWarning')}</p>
						{/if}
						{#if deposits.error === 'poll'}
							<div class="inline-error" role="alert">
								<span>{t('topUp.invoice.pollFailed')}</span>
								<button type="button" class="secondary" onclick={() => deposits.resumePolling()}>
									{t('topUp.retry')}
								</button>
							</div>
						{/if}
					{/if}
				</section>
			{:else}
				<section class="packages">
					<h3>{t('topUp.packages.title')}</h3>
					{#if deposits.packagesStatus === 'loading' || deposits.packagesStatus === 'idle'}
						<div class="loading-row" role="status">
							<span class="spinner" aria-hidden="true"></span>
							<span>{t('topUp.packages.loading')}</span>
						</div>
					{:else if deposits.packagesStatus === 'error'}
						<div class="inline-error" role="alert">
							<span>{t('topUp.packages.failed')}</span>
							<button type="button" class="secondary" onclick={() => void deposits.retryPackages()}>
								{t('topUp.retry')}
							</button>
						</div>
					{:else}
						<div class="package-grid" role="group" aria-label={t('topUp.packages.title')}>
							{#each deposits.packages as item (item.id)}
								<button
									type="button"
									class:selected={deposits.selectedPackageId === item.id}
									aria-pressed={deposits.selectedPackageId === item.id}
									onclick={() => deposits.selectPackage(item.id)}
								>
									<strong>{formatUsd(item.usdAmount)}</strong>
									<span>{ti('topUp.packages.credits', { credits: item.creditsAwarded })}</span>
								</button>
							{/each}
						</div>
						{#if deposits.error === 'create'}
							<p class="error" role="alert">{t('topUp.createFailed')}</p>
						{/if}
						<button
							type="button"
							class="create"
							disabled={!canCreate}
							onclick={() => void deposits.createDeposit()}
						>
							{deposits.creating ? t('topUp.creating') : t('topUp.create')}
						</button>
					{/if}
				</section>
			{/if}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<style>
	:global(.top-up-dialog-trigger),
	button {
		padding: var(--space-1) var(--space-2);
		font: inherit;
		color: var(--color-accent-contrast);
		background: var(--color-accent);
		border: 1px solid var(--color-accent);
		border-radius: var(--radius);
		cursor: pointer;
	}

	:global(.top-up-dialog-trigger) {
		white-space: nowrap;
	}

	:global(.top-up-dialog-overlay) {
		position: fixed;
		inset: 0;
		z-index: 50;
		background: rgb(0 0 0 / 48%);
		backdrop-filter: blur(2px);
	}

	:global(.top-up-dialog-content) {
		position: fixed;
		left: 50%;
		top: 50%;
		z-index: 51;
		width: min(32rem, calc(100vw - var(--space-4)));
		max-height: calc(100dvh - var(--space-4));
		overflow-y: auto;
		box-sizing: border-box;
		padding: var(--space-3);
		color: var(--color-text);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: calc(var(--radius) * 1.5);
		box-shadow: 0 24px 64px rgb(0 0 0 / 24%);
		transform: translate(-50%, -50%);
	}

	header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-2);
	}

	:global(.top-up-dialog-title),
	h3,
	p {
		margin: 0;
	}

	:global(.top-up-dialog-title) {
		font-size: 1.35rem;
	}

	:global(.top-up-dialog-description) {
		margin-top: 0.35rem;
		color: var(--color-muted);
		font-size: 0.92rem;
		line-height: 1.45;
	}

	:global(.top-up-dialog-close) {
		display: grid;
		place-items: center;
		min-width: 2rem;
		min-height: 2rem;
		padding: 0;
		color: var(--color-muted);
		background: transparent;
		border-color: transparent;
		font-size: 1.45rem;
		line-height: 1;
	}

	section {
		display: grid;
		gap: var(--space-2);
		margin-top: var(--space-3);
	}

	h3 {
		font-size: 1rem;
	}

	.package-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--space-2);
	}

	.package-grid button {
		display: grid;
		gap: 0.2rem;
		padding: var(--space-2);
		color: var(--color-text);
		background: var(--color-bg);
		border-color: var(--color-border);
	}

	.package-grid button.selected {
		border-color: var(--color-accent);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 25%, transparent);
	}

	.package-grid strong {
		font-size: 1.15rem;
	}

	.package-grid span {
		color: var(--color-muted);
		font-size: 0.82rem;
	}

	button.create {
		justify-self: end;
		min-width: 9rem;
	}

	button:disabled {
		cursor: progress;
		opacity: 0.65;
	}

	.loading-row,
	.inline-error {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--color-muted);
	}

	.spinner {
		width: 1rem;
		height: 1rem;
		flex: 0 0 auto;
		border: 2px solid var(--color-border);
		border-top-color: var(--color-accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	.qr-wrap {
		width: min(17rem, 100%);
		margin-inline: auto;
		padding: var(--space-2);
		box-sizing: border-box;
		background: white;
		border-radius: var(--radius);
	}

	.qr-wrap :global(.qr) {
		display: block;
		width: 100%;
		height: auto;
	}

	dl {
		display: grid;
		gap: var(--space-1);
		margin: 0;
	}

	dl div {
		display: flex;
		justify-content: space-between;
		gap: var(--space-2);
	}

	dt {
		color: var(--color-muted);
	}

	dd {
		margin: 0;
		font-weight: 600;
		text-align: right;
	}

	button.copy {
		justify-self: center;
	}

	.pending,
	.warning {
		text-align: center;
		color: var(--color-muted);
		font-size: 0.9rem;
	}

	.warning {
		color: var(--color-text);
	}

	.error {
		color: var(--color-danger);
		font-size: 0.9rem;
	}

	.inline-error {
		justify-content: space-between;
		color: var(--color-danger);
	}

	button.secondary {
		color: var(--color-text);
		background: transparent;
		border-color: var(--color-border);
	}

	.result {
		display: grid;
		justify-items: center;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-2);
		text-align: center;
	}

	.result-icon {
		display: grid;
		place-items: center;
		width: 3rem;
		height: 3rem;
		color: var(--color-accent-contrast);
		background: var(--color-accent);
		border-radius: 50%;
		font-size: 1.5rem;
		font-weight: 700;
	}

	.failed .result-icon {
		background: var(--color-danger);
	}

	.new-balance {
		font-weight: 700;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (max-width: 480px) {
		.package-grid {
			grid-template-columns: 1fr;
		}

		:global(.top-up-dialog-content) {
			padding: var(--space-2);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation: none;
		}
	}
</style>
