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
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<main class="usage-page">
	<section class="usage-shell">
		{@render children()}
	</section>
</main>

<style>
	.usage-page {
		width: 100%;
		min-height: calc(100dvh - 4.5rem);
		padding: clamp(1rem, 2vw, 2rem);
	}

	.usage-shell {
		width: 100%;
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

	.usage-shell :global(.usage-header) {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.usage-shell :global(h1),
	.usage-shell :global(.usage-header p),
	.usage-shell :global(.status) {
		margin: 0;
	}

	.usage-shell > :global(.status) {
		text-align: center;
	}

	.usage-shell :global(h1) {
		color: var(--color-text);
		font-size: clamp(1.375rem, 2vw, 1.75rem);
		line-height: 1.15;
		font-weight: 720;
	}

	.usage-shell :global(.usage-header p),
	.usage-shell :global(.status) {
		color: var(--color-muted);
		font-size: 0.9375rem;
	}

	.usage-shell :global(.error) {
		color: var(--color-danger);
	}

	.usage-shell :global(.table-wrap) {
		width: 100%;
		overflow-x: auto;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
	}

	.usage-shell :global(table) {
		border-collapse: collapse;
		font-size: 0.875rem;
	}

	.usage-shell :global(th),
	.usage-shell :global(td) {
		padding: 0.75rem;
		border-bottom: 1px solid var(--color-border);
		text-align: left;
		vertical-align: middle;
		line-height: 1;
		white-space: nowrap;
	}

	.usage-shell :global(.numeric-column) {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.usage-shell :global(thead th) {
		position: sticky;
		top: 0;
		z-index: 1;
		background: var(--color-background);
		color: var(--color-muted);
		font-size: 0.75rem;
		font-weight: 700;
		line-height: 1;
		text-transform: uppercase;
	}

	.usage-shell :global(tbody tr:last-child th),
	.usage-shell :global(tbody tr:last-child td) {
		border-bottom: 0;
	}

	.usage-shell :global(tbody tr:hover) {
		background: var(--color-surface-hover);
	}

	.usage-shell :global(tbody th),
	.usage-shell :global(td) {
		color: var(--color-text);
		font-weight: 500;
	}

	.usage-shell :global(.load-more-sentinel) {
		min-height: 3rem;
		display: flex;
		align-items: center;
	}

	@media (max-width: 720px) {
		.usage-page {
			padding: 1rem;
		}

		.usage-shell {
			padding: 1rem;
			border-radius: var(--radius);
		}
	}
</style>
