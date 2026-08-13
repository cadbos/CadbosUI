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
	import type { HealthServiceStatus, HealthSnapshot } from '$lib/api/contract';
	import { getLocale, t, ti, type TranslationKey } from '$lib/i18n/index.svelte';
	import { status } from '$lib/state/status.svelte';

	type ServiceKey = keyof HealthSnapshot['services'];

	const serviceKeys: ServiceKey[] = ['archai', 'assets', 'comfyui', 'd1', 'nostr', 'r2'];

	$effect(() => {
		status.startPolling();
		return () => status.stopPolling();
	});

	function serviceName(key: ServiceKey): string {
		return t(`status.service.${key}` as TranslationKey);
	}

	function healthLabel(health: HealthServiceStatus): string {
		return t(health === 'healthy' ? 'status.healthy' : 'status.unhealthy');
	}

	function formatTimestamp(timestamp: string): string {
		return new Intl.DateTimeFormat(getLocale(), {
			dateStyle: 'medium',
			timeStyle: 'medium'
		}).format(new Date(timestamp));
	}
</script>

<svelte:head>
	<title>{t('status.title')}</title>
</svelte:head>

<main class="status-page" aria-labelledby="status-title">
	<section class="status-shell">
		<header class="status-header">
			<h1 id="status-title">{t('status.title')}</h1>
			<p>{t('status.subtitle')}</p>
		</header>

		{#if status.state === 'loading'}
			<div class="loader" role="status">
				<p>{t('status.loading')}</p>
			</div>
		{:else if status.state === 'error' && status.snapshot === null}
			<p class="message error" role="alert">{t('status.failed')}</p>
		{:else if status.snapshot}
			{@const snapshot = status.snapshot}
			<div class="summary">
				<div>
					<span class="summary-label">{t('status.overall')}</span>
					<span class:healthy={snapshot.status === 'healthy'} class="health-badge">
						{healthLabel(snapshot.status)}
					</span>
				</div>
				<p>
					<time datetime={snapshot.timestamp}
						>{ti('status.lastChecked', { timestamp: formatTimestamp(snapshot.timestamp) })}</time
					>
				</p>
			</div>

			{#if status.error}
				<p class="message error" role="alert">{t('status.refreshFailed')}</p>
			{/if}

			<div class="table-wrap">
				<table>
					<caption class="visually-hidden">{t('status.tableCaption')}</caption>
					<thead>
						<tr>
							<th scope="col">{t('status.column.service')}</th>
							<th scope="col">{t('status.column.status')}</th>
							<th scope="col">{t('status.column.latency')}</th>
							<th scope="col">{t('status.column.details')}</th>
						</tr>
					</thead>
					<tbody>
						{#each serviceKeys as key (key)}
							{@const service = snapshot.services[key]}
							<tr>
								<th scope="row">{serviceName(key)}</th>
								<td>
									<span class:healthy={service.status === 'healthy'} class="health-badge">
										{healthLabel(service.status)}
									</span>
								</td>
								<td>{ti('status.latencyValue', { latency: service.latencyMs })}</td>
								<td>
									{#if key === 'nostr'}
										{ti('status.nostrAvailability', {
											reachable: snapshot.services.nostr.reachable,
											total: snapshot.services.nostr.total
										})}
									{:else}
										{t('status.noDetails')}
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
</main>

<style>
	.status-page {
		width: 100%;
		min-height: calc(100dvh - 4.5rem);
		padding: clamp(1rem, 2vw, 2rem);
	}

	.status-shell {
		width: 100%;
		max-width: 70rem;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: clamp(1rem, 2vw, 1.5rem);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		box-shadow: var(--shadow);
	}

	.status-header {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	h1,
	.status-header p,
	.summary p,
	.loader p,
	.message {
		margin: 0;
	}

	h1 {
		color: var(--color-text);
		font-size: clamp(1.375rem, 2vw, 1.75rem);
		font-weight: 720;
		line-height: 1.15;
	}

	.status-header p,
	.loader,
	.message {
		color: var(--color-muted);
		font-size: 0.9375rem;
	}

	.loader {
		display: grid;
		place-items: center;
		padding: clamp(4rem, 12vw, 8rem) 1rem;
		text-align: center;
	}

	.message.error {
		color: var(--color-danger);
	}

	.summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--color-background) 72%, var(--color-surface));
	}

	.summary > div,
	.summary p {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--color-text);
		font-size: 0.875rem;
	}

	.summary-label {
		color: var(--color-muted-strong);
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.health-badge {
		display: inline-flex;
		align-items: center;
		width: fit-content;
		padding: 0.25rem 0.5rem;
		border-radius: 999px;
		color: var(--color-danger);
		background: var(--color-danger-bg);
		font-size: 0.75rem;
		font-weight: 700;
		line-height: 1.2;
	}

	.health-badge.healthy {
		color: var(--color-accent-hover);
		background: color-mix(in srgb, var(--color-accent) 12%, var(--color-surface));
	}

	.table-wrap {
		width: 100%;
		overflow-x: auto;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.875rem;
	}

	th,
	td {
		padding: 0.75rem;
		border-bottom: 1px solid var(--color-border);
		color: var(--color-text);
		font-weight: 500;
		text-align: left;
		vertical-align: middle;
		white-space: nowrap;
	}

	thead th {
		background: var(--color-background);
		color: var(--color-muted);
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
	}

	tbody tr:last-child th,
	tbody tr:last-child td {
		border-bottom: 0;
	}

	tbody tr:hover {
		background: var(--color-surface-hover);
	}

	@media (max-width: 720px) {
		.status-page,
		.status-shell {
			padding: 1rem;
		}

		.status-shell {
			border-radius: var(--radius);
		}

		.summary {
			align-items: flex-start;
			flex-direction: column;
		}
	}
</style>
