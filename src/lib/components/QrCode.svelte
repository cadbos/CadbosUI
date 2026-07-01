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
	import { encode } from 'uqr';

	let { data, label }: { data: string; label: string } = $props();

	// `uqr` is a pure encoder (no eval, no canvas) → CSP-safe. We render the module
	// matrix ourselves as one SVG <path> (a rect per dark module) rather than using
	// {@html}, so nothing inline reaches the DOM. Fixed black-on-white with the
	// default quiet-zone border keeps the code reliably scannable regardless of theme.
	const qr = $derived(encode(data, { ecc: 'M' }));
	const path = $derived.by(() => {
		let d = '';
		for (let y = 0; y < qr.size; y++) {
			for (let x = 0; x < qr.size; x++) {
				if (qr.data[y][x]) d += `M${x} ${y}h1v1h-1z`;
			}
		}
		return d;
	});
</script>

<svg
	class="qr"
	viewBox="0 0 {qr.size} {qr.size}"
	role="img"
	aria-label={label}
	xmlns="http://www.w3.org/2000/svg"
>
	<rect width={qr.size} height={qr.size} fill="#fff" />
	<path d={path} fill="#000" />
</svg>

<style>
	.qr {
		display: block;
		width: 100%;
		height: auto;
		shape-rendering: crispEdges;
	}
</style>
