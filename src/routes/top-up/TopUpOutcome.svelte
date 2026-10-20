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
	import { CircleCheck, CircleX, Hourglass } from '@lucide/svelte';
	import { resolve } from '$app/paths';
	import { t, ti } from '$lib/i18n/index.svelte';
	import { formatMinorAmount } from '$lib/payment-amount';
	import { topUp, type TopUpView } from '$lib/state/top-up.svelte';

	let { view }: { view: Exclude<TopUpView, 'compose' | 'invoice'> } = $props();

	const credited = $derived(
		topUp.invoice ? formatMinorAmount(topUp.invoice.amountMinor, topUp.invoice.currency) : ''
	);
</script>

<section
	class={['outcome', { success: view === 'paid', neutral: view === 'cancelled' }]}
	aria-labelledby="top-up-outcome-title"
	aria-live="polite"
>
	<span class="outcome-icon" aria-hidden="true">
		{#if view === 'confirming'}
			<span class="ring"></span>
		{:else if view === 'pending'}
			<Hourglass size={26} strokeWidth={1.8} />
		{:else if view === 'paid'}
			<CircleCheck size={28} strokeWidth={1.8} />
		{:else}
			<CircleX size={28} strokeWidth={1.8} />
		{/if}
	</span>

	{#if view === 'confirming'}
		<h2 id="top-up-outcome-title">{t('topUp.confirming.title')}</h2>
		<p>{t('topUp.confirming.text')}</p>
	{:else if view === 'pending'}
		<h2 id="top-up-outcome-title">{t('topUp.pending.title')}</h2>
		<p>{t('topUp.pending.text')}</p>
		<div class="actions">
			<button
				type="button"
				class="primary-button"
				disabled={topUp.busy !== null}
				onclick={() => void topUp.confirm()}
			>
				{t('topUp.pending.check')}
			</button>
			{#if topUp.invoice?.checkout}
				<a class="ghost-button" href={topUp.invoice.checkout.paymentUrl} rel="external">
					{t('topUp.pending.resume')}
				</a>
			{/if}
			<button
				type="button"
				class="text-button"
				disabled={topUp.busy !== null}
				onclick={() => void topUp.cancel()}
			>
				{topUp.busy === 'cancel' ? t('topUp.invoice.cancelling') : t('topUp.invoice.cancel')}
			</button>
		</div>
	{:else if view === 'paid'}
		<h2 id="top-up-outcome-title">{t('topUp.paid.title')}</h2>
		<p class="credited">{ti('topUp.paid.text', { amount: credited })}</p>
		<div class="actions">
			<a class="primary-button" href={resolve('/projects', {})}>{t('topUp.paid.projects')}</a>
			<button type="button" class="ghost-button" onclick={() => topUp.startOver()}>
				{t('topUp.paid.another')}
			</button>
		</div>
	{:else}
		<h2 id="top-up-outcome-title">{t('topUp.cancelled.title')}</h2>
		<p>{t('topUp.cancelled.text')}</p>
		<div class="actions">
			<button type="button" class="primary-button" onclick={() => topUp.startOver()}>
				{t('topUp.cancelled.newInvoice')}
			</button>
		</div>
	{/if}
</section>

<style>
	.outcome {
		--outcome-color: var(--color-accent-text);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		max-width: 30rem;
		margin: 0 auto;
		padding: 2rem 1.5rem;
		text-align: center;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: color-mix(in srgb, var(--color-background) 60%, var(--color-surface));
	}

	.outcome.neutral {
		--outcome-color: var(--color-muted-strong);
	}

	.outcome-icon {
		display: grid;
		place-items: center;
		width: 3.5rem;
		height: 3.5rem;
		color: var(--outcome-color);
		background: color-mix(in srgb, var(--outcome-color) 12%, var(--color-surface));
		border-radius: 50%;
	}

	.outcome.success .outcome-icon {
		animation: pop 0.35s ease-out;
	}

	.ring {
		width: 1.75rem;
		height: 1.75rem;
		border: 3px solid color-mix(in srgb, var(--outcome-color) 25%, transparent);
		border-top-color: var(--outcome-color);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	h2 {
		margin: 0;
		color: var(--color-text);
		font-size: 1.25rem;
		font-weight: 720;
	}

	p {
		margin: 0;
		max-width: 26rem;
		color: var(--color-muted-strong);
		font-size: 0.9375rem;
	}

	.credited {
		color: var(--color-text);
		font-size: 1.0625rem;
		font-weight: 650;
		font-variant-numeric: tabular-nums;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 0.625rem;
		margin-top: 0.5rem;
	}

	@keyframes pop {
		from {
			transform: scale(0.6);
			opacity: 0;
		}

		to {
			transform: scale(1);
			opacity: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.outcome.success .outcome-icon,
		.ring {
			animation: none;
		}
	}
</style>
