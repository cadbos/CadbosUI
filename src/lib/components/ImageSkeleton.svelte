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
		quiet?: boolean;
	}

	let { quiet = false }: Props = $props();
</script>

<span class="image-skeleton" class:quiet aria-hidden="true"></span>

<style>
	.image-skeleton {
		position: absolute;
		inset: 0;
		z-index: 1;
		display: block;
		width: 100%;
		height: 100%;
		border-radius: inherit;
		pointer-events: none;
		background: var(--color-skeleton);
		animation: image-skeleton-pulse 1.4s ease-in-out infinite;
	}

	.quiet,
	.image-skeleton.quiet {
		animation: none;
	}

	@media (prefers-reduced-motion: reduce) {
		.image-skeleton {
			animation: none;
		}
	}

	@keyframes image-skeleton-pulse {
		50% {
			filter: brightness(1.08);
		}
	}
</style>
