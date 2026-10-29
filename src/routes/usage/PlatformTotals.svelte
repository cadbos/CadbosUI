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
	import SkeletonBlock from '$lib/components/SkeletonBlock.svelte';
	import { t, ti } from '$lib/i18n/index.svelte';
	import { usage } from '$lib/state/usage.svelte';
	import UsageNumber from './UsageNumber.svelte';

	interface Props {
		// The day every tile covers; platform-wide over all time when omitted.
		dayLabel?: string;
	}

	let { dayLabel }: Props = $props();
</script>

{#if usage.totalsStatus !== 'idle' || usage.walletBalanceStatus !== 'idle' || usage.d1LimitsStatus !== 'idle' || usage.workersAiUsageStatus !== 'idle'}
	<section class="totals" aria-labelledby="usage-totals-title">
		<h2 id="usage-totals-title">
			{dayLabel === undefined
				? t('usage.totals.title')
				: ti('usage.totals.dayTitle', { date: dayLabel })}
		</h2>
		<dl>
			{#if usage.walletBalanceStatus !== 'idle'}
				<div>
					<dt>{t('usage.totals.walletBalance')}</dt>
					{#if usage.walletBalanceStatus === 'loading'}
						<dd><SkeletonBlock width="5rem" height="1rem" /></dd>
						<p class="visually-hidden">{t('usage.walletBalanceLoading')}</p>
					{:else if usage.walletBalanceStatus === 'error'}
						<dd class="tile-status error" role="alert">{t('usage.walletBalanceFailed')}</dd>
					{:else if usage.walletBalance !== null}
						<dd><UsageNumber kind="currency" value={usage.walletBalance} /></dd>
					{/if}
				</div>
			{/if}
			{#if usage.totalsStatus === 'ready' && usage.totals !== null}
				<div>
					<dt>{t('usage.totals.deposits')}</dt>
					<dd><UsageNumber kind="currency" value={usage.totals.totalDeposit} /></dd>
				</div>
				<div>
					<dt>{t('usage.totals.spend')}</dt>
					<dd><UsageNumber kind="currency" value={usage.totals.totalSpend} /></dd>
				</div>
				<div>
					<dt>{t('usage.totals.users')}</dt>
					<dd><UsageNumber kind="count" value={usage.totals.userCount} /></dd>
				</div>
				<div>
					<dt>{t('usage.totals.projects')}</dt>
					<dd><UsageNumber kind="count" value={usage.totals.projectCount} /></dd>
				</div>
				<div>
					<dt>{t('usage.totals.sessions')}</dt>
					<dd><UsageNumber kind="count" value={usage.totals.sessionCount} /></dd>
				</div>
				<div>
					<dt>{t('usage.totals.generations')}</dt>
					<dd><UsageNumber kind="count" value={usage.totals.generationCount} /></dd>
				</div>
				<div>
					<dt>{t('usage.totals.sources')}</dt>
					<dd>
						<UsageNumber
							kind="countWithSize"
							value={usage.totals.sourceCount}
							bytes={usage.totals.sourceBytes}
						/>
					</dd>
				</div>
				<div>
					<dt>{t('usage.totals.references')}</dt>
					<dd>
						<UsageNumber
							kind="countWithSize"
							value={usage.totals.referenceCount}
							bytes={usage.totals.referenceBytes}
						/>
					</dd>
				</div>
			{/if}
			{#if usage.d1LimitsStatus === 'ready' && usage.d1Limits !== null}
				<div>
					<dt>{ti('usage.totals.d1RowsRead', { date: usage.d1Limits.date })}</dt>
					<dd>
						<span class="quota-quotient">
							<span class="quota-used"
								><UsageNumber kind="count" value={usage.d1Limits.rowsRead} /></span
							>
							<span class="quota-divider">{t('usage.totals.quotaDivisionSign')}</span>
							<span class="quota-limit"
								><UsageNumber kind="count" value={usage.d1Limits.readLimit} /></span
							>
						</span>
						{#if usage.d1Limits.rowsRead >= usage.d1Limits.readLimit}
							<span class="limit-reached" role="status">{t('usage.totals.quotaLimitReached')}</span>
						{/if}
					</dd>
				</div>
				<div>
					<dt>{ti('usage.totals.d1RowsWritten', { date: usage.d1Limits.date })}</dt>
					<dd>
						<span class="quota-quotient">
							<span class="quota-used"
								><UsageNumber kind="count" value={usage.d1Limits.rowsWritten} /></span
							>
							<span class="quota-divider">{t('usage.totals.quotaDivisionSign')}</span>
							<span class="quota-limit"
								><UsageNumber kind="count" value={usage.d1Limits.writeLimit} /></span
							>
						</span>
						{#if usage.d1Limits.rowsWritten >= usage.d1Limits.writeLimit}
							<span class="limit-reached" role="status">{t('usage.totals.quotaLimitReached')}</span>
						{/if}
					</dd>
				</div>
			{/if}
			{#if usage.workersAiUsageStatus === 'ready' && usage.workersAiUsage !== null}
				<div>
					<dt>{ti('usage.totals.workersAiNeurons', { date: usage.workersAiUsage.date })}</dt>
					<dd>
						<span class="quota-quotient">
							<span class="quota-used"
								><UsageNumber kind="count" value={usage.workersAiUsage.neurons} /></span
							>
							<span class="quota-divider">{t('usage.totals.quotaDivisionSign')}</span>
							<span class="quota-limit"
								><UsageNumber kind="count" value={usage.workersAiUsage.neuronLimit} /></span
							>
						</span>
						{#if usage.workersAiUsage.neurons >= usage.workersAiUsage.neuronLimit}
							<span class="limit-reached" role="status">{t('usage.totals.quotaLimitReached')}</span>
						{/if}
					</dd>
				</div>
				<div>
					<dt>{ti('usage.totals.workersAiRequests', { date: usage.workersAiUsage.date })}</dt>
					<dd><UsageNumber kind="count" value={usage.workersAiUsage.requests} /></dd>
				</div>
			{/if}
			{#if usage.totalsStatus === 'loading'}
				{#each [0, 1, 2, 3, 4, 5, 6, 7] as slot (slot)}
					<div aria-hidden="true">
						<dt><SkeletonBlock width="70%" height="0.7rem" /></dt>
						<dd><SkeletonBlock width="4.5rem" height="1rem" /></dd>
					</div>
				{/each}
			{/if}
			{#if usage.d1LimitsStatus === 'loading'}
				{#each [0, 1] as slot (`d1-${slot}`)}
					<div aria-hidden="true">
						<dt><SkeletonBlock width="80%" height="0.7rem" /></dt>
						<dd><SkeletonBlock width="5rem" height="1rem" /></dd>
					</div>
				{/each}
			{/if}
			{#if usage.workersAiUsageStatus === 'loading'}
				{#each [0, 1] as slot (`workers-ai-${slot}`)}
					<div aria-hidden="true">
						<dt><SkeletonBlock width="80%" height="0.7rem" /></dt>
						<dd><SkeletonBlock width="5rem" height="1rem" /></dd>
					</div>
				{/each}
			{/if}
		</dl>
		{#if usage.totalsStatus === 'loading'}
			<p class="visually-hidden">{t('usage.totals.loading')}</p>
		{:else if usage.totalsStatus === 'error'}
			<p class="status error" role="alert">{t('usage.totals.failed')}</p>
		{/if}
		{#if usage.d1LimitsStatus === 'loading'}
			<p class="visually-hidden">{t('usage.totals.d1Loading')}</p>
		{:else if usage.d1LimitsStatus === 'error'}
			<p class="status error" role="alert">{t('usage.totals.d1Failed')}</p>
		{/if}
		{#if usage.workersAiUsageStatus === 'loading'}
			<p class="visually-hidden">{t('usage.totals.workersAiLoading')}</p>
		{:else if usage.workersAiUsageStatus === 'error'}
			<p class="status error" role="alert">{t('usage.totals.workersAiFailed')}</p>
		{/if}
	</section>
{/if}

<style>
	.totals {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.totals h2 {
		margin: 0;
		color: var(--color-text);
		font-size: 1rem;
		font-weight: 700;
	}

	.totals dl {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
		gap: 0.75rem;
		margin: 0;
	}

	.totals dl > div {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-background);
	}

	.totals dt {
		min-height: 2lh;
		color: var(--color-muted);
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
	}

	.totals dd {
		margin: auto 0 0;
		color: var(--color-text);
		font-size: 1.125rem;
		font-weight: 700;
	}

	.totals dd.tile-status {
		text-align: left;
		font-size: 0.9375rem;
		font-weight: 500;
	}

	.totals .quota-quotient {
		display: grid;
		grid-template-columns: auto 1fr;
		column-gap: 0.375rem;
		font-variant-numeric: tabular-nums;
	}

	.totals .quota-used,
	.totals .quota-limit {
		grid-column: 2;
		text-align: right;
	}

	.totals .quota-used {
		grid-row: 1;
	}

	.totals .quota-limit {
		grid-row: 2;
	}

	.totals .quota-divider {
		grid-column: 1;
		grid-row: 1 / 3;
		align-self: center;
	}

	.totals .limit-reached {
		display: block;
		color: var(--color-danger);
		font-size: 0.8125rem;
	}
</style>
