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
	import { Wallet } from '@lucide/svelte';
	import { t, ti } from '$lib/i18n/index.svelte';
	import { request } from '$lib/state/request.svelte';
	import { currency } from '$lib/state/currency.svelte';
	const render = $derived(request.currentRender);
</script>

{#if render}
	<div class="finances">
		<div class="values desktop">
			<span>{ti('render.cost', { cost: currency.format(render.cost) })}</span>
			<span>{ti('render.balance', { balance: currency.format(render.balance) })}</span>
		</div>
		<details class="mobile">
			<summary aria-label={t('render.finances')} title={t('render.finances')}
				><Wallet size={18} aria-hidden="true" /></summary
			>
			<div class="values disclosure">
				<span>{ti('render.cost', { cost: currency.format(render.cost) })}</span>
				<span>{ti('render.balance', { balance: currency.format(render.balance) })}</span>
			</div>
		</details>
	</div>
{/if}

<style>
	.finances {
		position: relative;
		font-size: 0.8125rem;
		color: var(--color-muted);
	}
	.values {
		display: flex;
		gap: 0.75rem;
		align-items: center;
	}
	.mobile {
		display: none;
	}
	summary {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 2.75rem;
		min-height: 2.75rem;
		cursor: pointer;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		color: var(--color-text);
	}
	summary:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}
	.disclosure {
		position: absolute;
		right: 0;
		top: calc(100% + 0.5rem);
		flex-direction: column;
		align-items: flex-start;
		padding: 0.75rem;
		white-space: nowrap;
		z-index: 26;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-surface);
		box-shadow: var(--shadow-lg);
	}
	@media (max-width: 900px) {
		.desktop {
			display: none;
		}
		.mobile {
			display: block;
		}
	}
</style>
