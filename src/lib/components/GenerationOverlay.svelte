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
	import { t } from '$lib/i18n/index.svelte';
	import { generationOverlay } from '$lib/state/generation-overlay.svelte';

	// Traces each ribbon along its real outline (mirrors a plain-JS
	// `getTotalLength()` measurement) instead of a hand-picked dash length, so
	// the draw animation stays exact if a path ever changes.
	function traceRibbons(svg: SVGSVGElement): void {
		for (const path of svg.querySelectorAll<SVGPathElement>('.strokePath')) {
			const length = path.getTotalLength();
			path.style.setProperty('--len', String(length));
			path.style.strokeDasharray = String(length);
			path.style.strokeDashoffset = String(length);
		}
	}
</script>

{#if generationOverlay.active}
	<div class="overlay" role="status" aria-live="polite">
		<div class="card">
			<div class="ribbon-stage" aria-hidden="true">
				<svg
					{@attach traceRibbons}
					viewBox="0 0 511 579"
					fill="none"
					xmlns="http://www.w3.org/2000/svg"
				>
					<g class="p1">
						<path
							class="fillPath"
							d="M228.403 100.79L83.337 188.395V389.981L228.403 477.585V578.378L-0.499908 435.197V143.18L228.403 -0.00268555V100.79Z"
							fill="#2F6F4F"
						/>
						<path
							class="strokePath"
							d="M228.403 100.79L83.337 188.395V389.981L228.403 477.585V578.378L-0.499908 435.197V143.18L228.403 -0.00268555V100.79Z"
							stroke="#2F6F4F"
						/>
					</g>

					<g class="p2">
						<path
							class="fillPath"
							d="M511 143.18V243.973L427.163 294.84V294.809L422.453 297.665V355.127L338.616 308.97V252.45L427.163 198.495V188.395L282.097 100.79V-0.00268555L511 143.18Z"
							fill="#313A41"
						/>
						<path
							class="strokePath"
							d="M511 143.18V243.973L427.163 294.84V294.809L422.453 297.665V355.127L338.616 308.97V252.45L427.163 198.495V188.395L282.097 100.79V-0.00268555L511 143.18Z"
							stroke="#313A41"
						/>
					</g>

					<g class="p3">
						<path
							class="fillPath"
							d="M511 436.138V335.346L427.163 284.477V284.509L422.453 281.652V224.19L338.616 255.276V326.867L427.163 380.822V390.923L282.5 478.5V578.5L511 436.138Z"
							fill="#313A41"
						/>
						<path
							class="strokePath"
							d="M511 436.138V335.346L427.163 284.477V284.509L422.453 281.652V224.19L338.616 255.276V326.867L427.163 380.822V390.923L282.5 478.5V578.5L511 436.138Z"
							stroke="#313A41"
						/>
					</g>

					<g class="p4">
						<path
							class="fillPath"
							d="M511 243.972V143.18L282.097 286.362L282.5 578.5L365.934 526.875V332.519L511 243.972Z"
							fill="#9C9E9D"
						/>
						<path
							class="strokePath"
							d="M511 243.972V143.18L282.097 286.362L282.5 578.5L365.934 526.875V332.519L511 243.972Z"
							stroke="#9C9E9D"
						/>
					</g>
				</svg>
			</div>

			{#if generationOverlay.messageKey}
				<p class="message">{t(generationOverlay.messageKey)}</p>
			{/if}
			{#if generationOverlay.detailKey}
				<p class="detail">{t(generationOverlay.detailKey)}</p>
			{/if}
		</div>
	</div>
{/if}

<style>
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.5rem;
		background: color-mix(in srgb, var(--color-background) 55%, transparent);
		backdrop-filter: blur(10px);
		-webkit-backdrop-filter: blur(10px);
		animation: overlayIn 0.35s ease both;
	}

	.card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		max-width: 22rem;
		padding: 2rem 2.25rem 1.75rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
		text-align: center;
		animation: cardIn 0.4s cubic-bezier(0.22, 1, 0.36, 1) both;
	}

	.ribbon-stage {
		width: 140px;
		height: 159px;
	}

	.ribbon-stage svg {
		width: 100%;
		height: 100%;
		overflow: visible;
	}

	.strokePath {
		fill: none;
		stroke-width: 7;
		stroke-linejoin: round;
		stroke-linecap: round;
		animation-name: drawStroke;
		animation-duration: 4.2s;
		animation-timing-function: cubic-bezier(0.65, 0.05, 0.36, 1);
		animation-iteration-count: infinite;
	}

	.fillPath {
		opacity: 0;
		animation-name: fillFade;
		animation-duration: 4.2s;
		animation-timing-function: ease-in-out;
		animation-iteration-count: infinite;
	}

	.p1 .strokePath,
	.p1 .fillPath {
		animation-delay: 0s;
	}

	.p2 .strokePath,
	.p2 .fillPath {
		animation-delay: 0.28s;
	}

	.p3 .strokePath,
	.p3 .fillPath {
		animation-delay: 0.56s;
	}

	.p4 .strokePath,
	.p4 .fillPath {
		animation-delay: 0.84s;
	}

	@keyframes drawStroke {
		0% {
			stroke-dashoffset: var(--len);
			opacity: 1;
		}
		16% {
			stroke-dashoffset: 0;
			opacity: 1;
		}
		68% {
			stroke-dashoffset: 0;
			opacity: 1;
		}
		86% {
			stroke-dashoffset: 0;
			opacity: 0;
		}
		100% {
			stroke-dashoffset: var(--len);
			opacity: 0;
		}
	}

	@keyframes fillFade {
		0% {
			opacity: 0;
		}
		18% {
			opacity: 0;
		}
		26% {
			opacity: 1;
		}
		64% {
			opacity: 1;
		}
		76% {
			opacity: 0;
		}
		100% {
			opacity: 0;
		}
	}

	.message {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.detail {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--color-muted-strong);
	}

	@keyframes overlayIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes cardIn {
		from {
			opacity: 0;
			transform: translateY(10px) scale(0.96);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}
</style>
