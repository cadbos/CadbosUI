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
	import { ArrowUpRight, Lock, ReceiptText } from '@lucide/svelte';
	import type { InvoiceCheckout, InvoiceResponse } from '$lib/api/contract';
	import { t, ti } from '$lib/i18n/index.svelte';
	import { formatMinorAmount } from '$lib/payment-amount';
	import { topUp } from '$lib/state/top-up.svelte';
	import { processorLabel } from './processor-labels';

	let { invoice, checkout }: { invoice: InvoiceResponse; checkout: InvoiceCheckout } = $props();

	const processor = $derived(processorLabel(invoice.paymentProcessor));
	const amountDue = $derived(formatMinorAmount(checkout.amountMinor, checkout.currency));
</script>

<article class="invoice-card" aria-labelledby="top-up-invoice-title">
	<header class="invoice-header">
		<span class="invoice-icon" aria-hidden="true"><ReceiptText size={20} strokeWidth={1.8} /></span>
		<div class="invoice-heading">
			<h2 id="top-up-invoice-title">{t('topUp.invoice.title')}</h2>
			<p class="invoice-number">{ti('topUp.invoice.number', { id: invoice.id })}</p>
		</div>
		{#if checkout.isTest}
			<span class="test-badge" title={t('topUp.invoice.testModeHint')}>
				{t('topUp.invoice.testMode')}
			</span>
		{/if}
	</header>

	<div class="amount-due">
		<span class="amount-label">{t('topUp.invoice.toPay')}</span>
		<span class="amount-value">{amountDue}</span>
		<span class="rate-note">
			<Lock size={13} strokeWidth={2} aria-hidden="true" />
			{t('topUp.invoice.rateFixed')}
		</span>
	</div>

	<dl class="invoice-details">
		<div>
			<dt>{t('topUp.summary.credit')}</dt>
			<dd class="numeric">{formatMinorAmount(invoice.amountMinor, invoice.currency)}</dd>
		</div>
		<div>
			<dt>{t('topUp.method.title')}</dt>
			<dd>{processor.name}</dd>
		</div>
	</dl>

	<div class="invoice-actions">
		<a class="primary-button" href={checkout.paymentUrl} rel="external">
			<span>{ti('topUp.invoice.pay', { amount: amountDue })}</span>
			<ArrowUpRight size={16} strokeWidth={2} aria-hidden="true" />
		</a>
		<p class="redirect-hint">{ti('topUp.invoice.redirectHint', { processor: processor.name })}</p>
		<div class="secondary-actions">
			<button
				type="button"
				class="ghost-button"
				disabled={topUp.busy !== null}
				onclick={() => void topUp.confirm()}
			>
				{t('topUp.invoice.check')}
			</button>
			<button
				type="button"
				class="text-button"
				disabled={topUp.busy !== null}
				onclick={() => void topUp.cancel()}
			>
				{topUp.busy === 'cancel' ? t('topUp.invoice.cancelling') : t('topUp.invoice.cancel')}
			</button>
		</div>
	</div>
</article>

<style>
	.invoice-card {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		width: 100%;
		max-width: 30rem;
		margin: 0 auto;
		padding: 1.5rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: color-mix(in srgb, var(--color-background) 60%, var(--color-surface));
	}

	.invoice-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.invoice-icon {
		display: grid;
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		flex: none;
		color: var(--color-accent-text);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
	}

	.invoice-heading {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
	}

	h2 {
		margin: 0;
		color: var(--color-text);
		font-size: 1.0625rem;
		font-weight: 700;
	}

	.invoice-number {
		margin: 0;
		color: var(--color-muted);
		font-size: 0.8125rem;
	}

	.test-badge {
		padding: 0.2rem 0.55rem;
		color: var(--color-warning-text);
		background: var(--color-warning-bg);
		border-radius: 999px;
		font-size: 0.75rem;
		font-weight: 650;
		white-space: nowrap;
	}

	.amount-due {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.25rem;
		padding: 1rem 1.25rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
	}

	.amount-label {
		align-self: flex-start;
		color: var(--color-muted);
		font-size: 0.6875rem;
		font-weight: 650;
		letter-spacing: 0.045em;
		text-transform: uppercase;
	}

	.amount-value {
		color: var(--color-text);
		font-size: clamp(1.75rem, 4vw, 2.25rem);
		font-weight: 750;
		line-height: 1.1;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.rate-note {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		color: var(--color-muted-strong);
		font-size: 0.8125rem;
	}

	.invoice-details {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin: 0;
	}

	.invoice-details div {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
	}

	dt {
		color: var(--color-muted-strong);
		font-size: 0.875rem;
	}

	dd {
		margin: 0;
		color: var(--color-text);
		font-weight: 600;
		text-align: right;
	}

	.numeric {
		font-variant-numeric: tabular-nums;
	}

	.invoice-actions {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
	}

	.redirect-hint {
		margin: 0;
		color: var(--color-muted);
		font-size: 0.75rem;
		text-align: center;
	}

	.secondary-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
	}
</style>
