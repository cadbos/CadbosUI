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
	interface Props {
		width?: string;
		height?: string;
		radius?: string;
		grow?: boolean;
	}

	let { width = '100%', height = '0.75rem', radius = '999px', grow = false }: Props = $props();
</script>

<span
	class="skeleton-block"
	class:grow
	style:width={grow ? 'auto' : width}
	style:height
	style:border-radius={radius}
	aria-hidden="true"
></span>

<style>
	.skeleton-block {
		display: block;
		flex: 0 0 auto;
		max-width: 100%;
		background: var(--color-skeleton);
		animation: skeleton-block-pulse 1.4s ease-in-out infinite;
	}

	.grow {
		flex: 1 1 auto;
		width: auto;
	}

	@media (prefers-reduced-motion: reduce) {
		.skeleton-block {
			animation: none;
		}
	}

	@keyframes skeleton-block-pulse {
		50% {
			filter: brightness(1.08);
		}
	}
</style>
