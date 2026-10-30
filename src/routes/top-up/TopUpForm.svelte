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
	import { ArrowRight } from '@lucide/svelte';
	import SkeletonBlock from '$lib/components/SkeletonBlock.svelte';
	import { t, ti } from '$lib/i18n/index.svelte';
	import { formatAmountInput, formatMinorAmount } from '$lib/payment-amount';
	import { currency } from '$lib/state/currency.svelte';
	import { AMOUNT_PRESETS_MINOR, INVOICE_CURRENCY, topUp } from '$lib/state/top-up.svelte';
	import { processorLabel } from './processor-labels';

	const amountInvalid = $derived(topUp.amountInput.trim() !== '' && topUp.amountMinor === null);
	const amountError = $derived(
		amountInvalid
			? t('topUp.amount.invalid')
			: topUp.amountExceedsLimit && topUp.amountLimitMinor !== null
				? ti('topUp.amount.overLimit', {
						amount: formatMinorAmount(topUp.amountLimitMinor, INVOICE_CURRENCY)
					})
				: null
	);
	const estimateMinor = $derived(
		topUp.amountMinor !== null &&
			currency.rubPerUsd !== null &&
			topUp.processor?.paymentCurrencies.includes('RUB')
			? Math.round(topUp.amountMinor * currency.rubPerUsd)
			: null
	);
</script>

<form
	class="top-up-form"
	onsubmit={(event) => {
		event.preventDefault();
		void topUp.submit();
	}}
>
	<div class="steps-column">
		<fieldset class="step" disabled={!topUp.editable}>
			<legend>{t('topUp.amount.title')}</legend>
			<div class="presets" role="radiogroup" aria-label={t('topUp.amount.presets')}>
				{#each AMOUNT_PRESETS_MINOR as preset (preset)}
					{@const overLimit = topUp.amountLimitMinor !== null && preset > topUp.amountLimitMinor}
					<label
						class={['preset', { selected: topUp.amountMinor === preset, unavailable: overLimit }]}
					>
						<input
							type="radio"
							name="amount-preset"
							disabled={overLimit}
							checked={topUp.amountMinor === preset}
							onchange={() => (topUp.amountInput = formatAmountInput(preset))}
						/>
						<span>{formatMinorAmount(preset, INVOICE_CURRENCY)}</span>
					</label>
				{/each}
			</div>
			<label class="custom-amount">
				<span class="field-label">{t('topUp.amount.custom')}</span>
				<input
					class="amount-input"
					type="text"
					inputmode="decimal"
					autocomplete="off"
					aria-invalid={amountError !== null}
					aria-describedby={amountError ? 'top-up-amount-error' : undefined}
					bind:value={topUp.amountInput}
				/>
			</label>
			{#if amountError}
				<p id="top-up-amount-error" class="field-error">{amountError}</p>
			{/if}
		</fieldset>

		<fieldset class="step" disabled={!topUp.editable}>
			<legend>{t('topUp.method.title')}</legend>
			{#if topUp.processorsStatus === 'loading'}
				<div class="method-skeleton" aria-hidden="true">
					<SkeletonBlock width="100%" height="4.25rem" />
				</div>
				<p class="visually-hidden" role="status">{t('topUp.method.loading')}</p>
			{:else if topUp.processorsStatus === 'error'}
				<div class="method-status">
					<p class="error" role="alert">{t('topUp.method.failed')}</p>
					<button type="button" class="ghost-button" onclick={() => topUp.retryProcessors()}>
						{t('topUp.method.retry')}
					</button>
				</div>
			{:else if topUp.processors.length === 0}
				<p class="muted">{t('topUp.method.empty')}</p>
			{:else}
				<div class="methods">
					{#each topUp.processors as processor (processor.id)}
						{@const label = processorLabel(processor.id)}
						{@const exhausted = processor.maxAmountMinor === 0}
						<label
							class={[
								'method',
								{ selected: topUp.processorId === processor.id, unavailable: exhausted }
							]}
						>
							<input
								type="radio"
								name="payment-processor"
								disabled={exhausted}
								value={processor.id}
								bind:group={topUp.processorId}
							/>
							<span class="method-icon" aria-hidden="true">
								<label.icon size={20} strokeWidth={1.8} />
							</span>
							<span class="method-text">
								<span class="method-name">{label.name}</span>
								{#if label.description}
									<span class="method-description">{label.description}</span>
								{/if}
								{#if exhausted}
									<span class="method-limit exhausted">{t('topUp.method.limitReached')}</span>
								{:else if processor.maxAmountMinor !== null}
									<span class="method-limit">
										{ti('topUp.method.limit', {
											amount: formatMinorAmount(processor.maxAmountMinor, INVOICE_CURRENCY)
										})}
									</span>
								{/if}
							</span>
							<span class="method-currency">
								{ti('topUp.method.paysIn', { currencies: processor.paymentCurrencies.join(', ') })}
							</span>
						</label>
					{/each}
				</div>
			{/if}
		</fieldset>
	</div>

	<aside class="summary" aria-labelledby="top-up-summary-title">
		<h2 id="top-up-summary-title">{t('topUp.summary.title')}</h2>
		<dl>
			<div class="summary-row">
				<dt>{t('topUp.summary.credit')}</dt>
				<dd class="amount">
					{topUp.amountMinor === null
						? t('expenses.emptyValue')
						: formatMinorAmount(topUp.amountMinor, INVOICE_CURRENCY)}
				</dd>
			</div>
			{#if estimateMinor !== null}
				<div class="summary-row">
					<dt>{t('topUp.summary.estimate')}</dt>
					<dd class="amount estimate">≈ {formatMinorAmount(estimateMinor, 'RUB')}</dd>
				</div>
			{/if}
		</dl>
		{#if estimateMinor !== null}
			<p class="hint">{t('topUp.summary.estimateHint')}</p>
		{/if}
		<button type="submit" class="primary-button" disabled={!topUp.canSubmit}>
			{#if topUp.busy === 'submit'}
				<span class="spinner" aria-hidden="true"></span>
				<span>{t('topUp.submitting')}</span>
			{:else}
				<span>{topUp.terms ? t('topUp.submitRetry') : t('topUp.submit')}</span>
				<ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
			{/if}
		</button>
		{#if topUp.terms && topUp.busy === null}
			<button type="button" class="ghost-button" onclick={() => void topUp.cancel()}>
				{t('topUp.invoice.cancel')}
			</button>
		{/if}
	</aside>
</form>

<style>
	.top-up-form {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(16rem, 20rem);
		gap: 1.5rem;
		align-items: start;
	}

	.steps-column {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		min-width: 0;
	}

	.step {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
	}

	.step:disabled {
		opacity: 0.6;
	}

	legend {
		margin-bottom: 0.75rem;
		padding: 0;
		color: var(--color-muted);
		font-size: 0.6875rem;
		font-weight: 650;
		letter-spacing: 0.045em;
		text-transform: uppercase;
	}

	.presets {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: 0.5rem;
	}

	.preset,
	.method {
		position: relative;
		cursor: pointer;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: color-mix(in srgb, var(--color-background) 72%, var(--color-surface));
		transition:
			border-color 0.15s,
			background 0.15s,
			box-shadow 0.15s;
	}

	.preset input,
	.method input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}

	.preset {
		display: flex;
		justify-content: center;
		padding: 0.75rem 0.5rem;
		color: var(--color-text);
		font-weight: 650;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.preset:hover,
	.method:hover {
		border-color: var(--color-accent);
	}

	.preset.selected,
	.method.selected {
		border-color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 10%, var(--color-surface));
		box-shadow: inset 0 0 0 1px var(--color-accent);
	}

	.preset:has(input:focus-visible),
	.method:has(input:focus-visible) {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}

	.step:disabled .preset,
	.step:disabled .method {
		cursor: not-allowed;
	}

	.custom-amount {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.field-label {
		color: var(--color-muted-strong);
		font-size: 0.875rem;
	}

	.amount-input {
		width: 9rem;
		padding: 0.55rem 0.75rem;
		font: inherit;
		font-weight: 650;
		font-variant-numeric: tabular-nums;
		text-align: right;
		color: var(--color-text);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
	}

	.amount-input:focus-visible {
		border-color: var(--color-border-focus);
		outline-offset: 0;
	}

	.amount-input[aria-invalid='true'] {
		border-color: var(--color-danger);
	}

	.field-error,
	.error {
		margin: 0;
		color: var(--color-danger);
		font-size: 0.8125rem;
	}

	.muted {
		margin: 0;
		color: var(--color-muted);
		font-size: 0.875rem;
	}

	.methods {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.method {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.875rem;
		padding: 0.875rem 1rem;
	}

	.method-icon {
		display: grid;
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		color: var(--color-accent-text);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
	}

	.method-text {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
	}

	.method-name {
		color: var(--color-text);
		font-weight: 650;
	}

	.method-description,
	.method-currency {
		color: var(--color-muted);
		font-size: 0.8125rem;
	}

	.method-limit {
		color: var(--color-accent-text);
		font-size: 0.8125rem;
		font-weight: 600;
	}

	.method-limit.exhausted {
		color: var(--color-danger);
	}

	.preset.unavailable,
	.method.unavailable {
		cursor: not-allowed;
		opacity: 0.5;
	}

	.preset.unavailable:hover,
	.method.unavailable:hover {
		border-color: var(--color-border);
	}

	.method-currency {
		white-space: nowrap;
	}

	.method-status {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.summary {
		position: sticky;
		top: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		padding: 1.25rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: color-mix(in srgb, var(--color-background) 60%, var(--color-surface));
	}

	h2 {
		margin: 0;
		color: var(--color-text);
		font-size: 1rem;
		font-weight: 700;
	}

	dl {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin: 0;
	}

	.summary-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
	}

	dt {
		color: var(--color-muted-strong);
		font-size: 0.875rem;
	}

	dd {
		margin: 0;
	}

	.amount {
		color: var(--color-text);
		font-size: 1.125rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		text-align: right;
		white-space: nowrap;
	}

	.amount.estimate {
		color: var(--color-muted-strong);
		font-size: 0.9375rem;
		font-weight: 600;
	}

	.hint {
		margin: 0;
		color: var(--color-muted);
		font-size: 0.75rem;
		line-height: 1.4;
	}

	@media (max-width: 720px) {
		.top-up-form {
			grid-template-columns: minmax(0, 1fr);
		}

		.presets {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}

		.summary {
			position: static;
		}

		.method {
			grid-template-columns: auto minmax(0, 1fr);
		}

		.method-currency {
			grid-column: 2;
		}
	}
</style>
