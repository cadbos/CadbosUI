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
	import type { CreditTransaction } from '$lib/api/contract';
	import { t, ti, type TranslationKey } from '$lib/i18n/index.svelte';
	import { auth } from '$lib/state/auth.svelte';
	import { formatCredit } from '$lib/utils';

	const creditEntryKeys: Record<CreditTransaction['kind'], TranslationKey> = {
		render: 'auth.credit.entryRender',
		edit: 'auth.credit.entryEdit',
		'style-transfer': 'auth.credit.entryStyleTransfer',
		'object-replacement': 'auth.credit.entryObjectReplacement',
		'texture-replacement': 'auth.credit.entryTextureReplacement',
		upscale: 'auth.credit.entryUpscale'
	};

	function creditEntryText(entry: CreditTransaction): string {
		return ti(creditEntryKeys[entry.kind], {
			date: new Date(entry.createdAt).toLocaleString(),
			amount: formatCredit(entry.amount),
			balance: formatCredit(entry.balanceAfter)
		});
	}
</script>

<svelte:head>
	<title>{t('expenses.title')}</title>
</svelte:head>

<main class="expenses-page" aria-labelledby="expenses-title">
	<section class="expenses-shell">
		<header class="expenses-header">
			<h1 id="expenses-title">{t('expenses.title')}</h1>
			<p>{t('expenses.subtitle')}</p>
		</header>

		{#if auth.status !== 'authenticated'}
			<p class="status">{t('expenses.signInRequired')}</p>
		{:else}
			{@const credit = auth.credit}
			{#if !credit || credit.history.length === 0}
				<p class="status">{t('auth.credit.historyEmpty')}</p>
			{:else}
				<ul class="history-list" aria-label={t('auth.credit.history')}>
					{#each credit.history as entry (entry.id)}
						<li>{creditEntryText(entry)}</li>
					{/each}
				</ul>
			{/if}
		{/if}
	</section>
</main>

<style>
	.expenses-page {
		width: 100%;
		min-height: calc(100dvh - 4.5rem);
		padding: clamp(1rem, 2vw, 2rem);
	}

	.expenses-shell {
		width: 100%;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		padding: clamp(1rem, 2vw, 1.5rem);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		box-shadow: var(--shadow);
	}

	.expenses-header {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	h1,
	.expenses-header p,
	.status {
		margin: 0;
	}

	h1 {
		color: var(--color-text);
		font-size: clamp(1.375rem, 2vw, 1.75rem);
		line-height: 1.15;
		font-weight: 720;
	}

	.expenses-header p,
	.status {
		color: var(--color-muted);
		font-size: 0.9375rem;
	}

	.history-list {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.history-list li {
		padding: 0.75rem;
		color: var(--color-text);
		font-size: 0.875rem;
		background: color-mix(in srgb, var(--color-background) 72%, var(--color-surface));
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
	}

	@media (max-width: 720px) {
		.expenses-page {
			padding: 1rem;
		}

		.expenses-shell {
			padding: 1rem;
			border-radius: var(--radius);
		}
	}
</style>
