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
	import { Check } from '@lucide/svelte';
	import { untrack } from 'svelte';
	import { replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import SkeletonBlock from '$lib/components/SkeletonBlock.svelte';
	import { t, type TranslationKey } from '$lib/i18n/index.svelte';
	import { formatMinorAmount } from '$lib/payment-amount';
	import { auth } from '$lib/state/auth.svelte';
	import { INVOICE_CURRENCY, topUp, type TopUpError } from '$lib/state/top-up.svelte';
	import InvoiceCard from './InvoiceCard.svelte';
	import TopUpForm from './TopUpForm.svelte';
	import TopUpOutcome from './TopUpOutcome.svelte';

	const errorKeys: Record<TopUpError, TranslationKey> = {
		fundingRestricted: 'topUp.error.fundingRestricted',
		testDepositLimit: 'topUp.error.testDepositLimit',
		rateLimited: 'topUp.error.rateLimited',
		unavailable: 'topUp.error.unavailable',
		amountOutOfRange: 'topUp.error.amountOutOfRange',
		notFound: 'topUp.error.notFound',
		network: 'topUp.error.network',
		failed: 'topUp.error.failed'
	};

	const stepKeys: TranslationKey[] = ['topUp.step.amount', 'topUp.step.payment', 'topUp.step.done'];

	const account = $derived(
		auth.status === 'authenticated' && auth.credit !== null ? auth.pubkey : null
	);
	const currentStep = $derived(
		topUp.view === 'paid' ? 2 : topUp.view === 'compose' || topUp.view === 'cancelled' ? 0 : 1
	);
	const completed = $derived(topUp.view === 'paid');

	function bindTopUp(): (() => void) | undefined {
		const pubkey = account;
		if (!pubkey) return;
		untrack(() => {
			const returnedFromProvider = page.url.searchParams.has('InvId');
			if (page.url.search) replaceState(resolve('/top-up', {}), page.state);
			topUp.open(pubkey, returnedFromProvider);
		});
		return () => topUp.close();
	}
</script>

<svelte:head>
	<title>{t('topUp.title')}</title>
</svelte:head>

<main class="top-up-page" aria-labelledby="top-up-title" {@attach bindTopUp}>
	<section class="top-up-shell">
		<header class="top-up-header">
			<div class="title-block">
				<h1 id="top-up-title">{t('topUp.title')}</h1>
				<p>{t('topUp.subtitle')}</p>
			</div>
			{#if auth.credit}
				<div class="balance">
					<span class="balance-label">{t('topUp.currentBalance')}</span>
					<span class="balance-value"
						>{formatMinorAmount(Math.round(auth.credit.balance * 100), INVOICE_CURRENCY)}</span
					>
				</div>
			{/if}
		</header>

		{#if auth.status === 'restoring' || auth.status === 'connecting'}
			<div class="loading" aria-hidden="true">
				<SkeletonBlock width="100%" height="3rem" />
				<SkeletonBlock width="100%" height="10rem" />
			</div>
		{:else if auth.status !== 'authenticated'}
			<p class="status">{t('topUp.signInRequired')}</p>
		{:else if auth.credit === null}
			<p class="status">{t('topUp.notApproved')}</p>
		{:else}
			<ol class="steps" aria-label={t('topUp.steps')}>
				{#each stepKeys as key, index (key)}
					<li
						class={{ done: index < currentStep || completed, current: index === currentStep }}
						aria-current={index === currentStep ? 'step' : undefined}
					>
						<span class="step-marker" aria-hidden="true">
							{#if index < currentStep || completed}
								<Check size={13} strokeWidth={2.5} />
							{:else}
								{index + 1}
							{/if}
						</span>
						<span>{t(key)}</span>
					</li>
				{/each}
			</ol>

			{#if topUp.error}
				<p class="status error" role="alert">{t(errorKeys[topUp.error])}</p>
			{/if}

			{#if topUp.busy === 'restore'}
				<div class="loading" aria-hidden="true">
					<SkeletonBlock width="100%" height="12rem" />
				</div>
				<p class="visually-hidden" role="status">{t('topUp.restoring')}</p>
			{:else if topUp.view === 'compose'}
				<TopUpForm />
			{:else if topUp.view === 'invoice' && topUp.invoice?.checkout}
				<InvoiceCard invoice={topUp.invoice} checkout={topUp.invoice.checkout} />
			{:else if topUp.view !== 'invoice'}
				<TopUpOutcome view={topUp.view} />
			{/if}
		{/if}
	</section>
</main>

<style>
	.top-up-page {
		width: 100%;
		min-height: calc(100dvh - 4.5rem);
		padding: clamp(1rem, 2vw, 2rem);
	}

	.top-up-shell {
		width: 100%;
		max-width: 60rem;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		padding: clamp(1rem, 2vw, 1.75rem);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		box-shadow: var(--shadow);
	}

	.top-up-header {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 1.5rem;
	}

	.title-block {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		min-width: 0;
	}

	h1,
	.title-block p,
	.status {
		margin: 0;
	}

	h1 {
		color: var(--color-text);
		font-size: clamp(1.375rem, 2vw, 1.75rem);
		line-height: 1.15;
		font-weight: 720;
	}

	.title-block p,
	.status {
		color: var(--color-muted);
		font-size: 0.9375rem;
	}

	.status.error {
		padding: 0.75rem 1rem;
		color: var(--color-danger);
		background: var(--color-danger-bg);
		border-radius: var(--radius);
	}

	.balance {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		flex: none;
		gap: 0.125rem;
	}

	.balance-label {
		color: var(--color-muted);
		font-size: 0.6875rem;
		font-weight: 650;
		letter-spacing: 0.045em;
		text-transform: uppercase;
	}

	.balance-value {
		color: var(--color-text);
		font-size: 1.375rem;
		font-weight: 720;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.loading {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.steps {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
		counter-reset: none;
	}

	.steps li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--color-muted);
		font-size: 0.875rem;
		font-weight: 600;
	}

	.steps li:not(:last-child)::after {
		content: '';
		width: clamp(1.5rem, 6vw, 4rem);
		height: 1px;
		margin-left: 0.5rem;
		background: var(--color-border);
	}

	.steps li.done::after {
		background: var(--color-accent);
	}

	.step-marker {
		display: grid;
		place-items: center;
		width: 1.5rem;
		height: 1.5rem;
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
		border: 1px solid var(--color-border);
		border-radius: 50%;
	}

	.steps li.current {
		color: var(--color-text);
	}

	.steps li.current .step-marker {
		color: var(--color-accent-contrast);
		background: var(--color-accent);
		border-color: var(--color-accent);
	}

	.steps li.done {
		color: var(--color-accent-text);
	}

	.steps li.done .step-marker {
		color: var(--color-accent-text);
		border-color: var(--color-accent);
	}

	.top-up-page :global(:is(.primary-button, .ghost-button, .text-button)) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.7rem 1rem;
		font: inherit;
		font-weight: 650;
		text-decoration: none;
		border-radius: var(--radius);
		cursor: pointer;
		transition:
			background 0.15s,
			border-color 0.15s,
			color 0.15s;
	}

	.top-up-page :global(:is(.primary-button, .ghost-button, .text-button):disabled) {
		cursor: not-allowed;
		opacity: 0.55;
	}

	.top-up-page :global(.primary-button) {
		color: var(--color-accent-contrast);
		background: var(--color-accent);
		border: 1px solid var(--color-accent);
	}

	.top-up-page :global(.primary-button:hover:not(:disabled)) {
		background: var(--color-accent-hover);
	}

	.top-up-page :global(.ghost-button) {
		color: var(--color-text);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
	}

	.top-up-page :global(.ghost-button:hover:not(:disabled)) {
		border-color: var(--color-accent);
	}

	.top-up-page :global(.text-button) {
		padding-inline: 0.25rem;
		color: var(--color-muted-strong);
		background: transparent;
		border: 1px solid transparent;
	}

	.top-up-page :global(.text-button:hover:not(:disabled)) {
		color: var(--color-danger);
	}

	.top-up-page :global(.spinner) {
		width: 1rem;
		height: 1rem;
		border: 2px solid rgb(255 255 255 / 0.3);
		border-top-color: currentcolor;
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}

	@media (max-width: 720px) {
		.top-up-page {
			padding: 1rem;
		}

		.top-up-shell {
			padding: 1rem;
			border-radius: var(--radius);
		}

		.top-up-header {
			flex-direction: column;
			align-items: stretch;
		}

		.steps li:not(:last-child)::after {
			width: 1rem;
		}
	}
</style>
