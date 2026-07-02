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
	import { Handle, Position, type Node, type NodeProps } from '@xyflow/svelte';
	import { t } from '$lib/i18n/index.svelte';
	import { request } from '$lib/state/request.svelte';

	type ImageNode = Node<Record<string, never>, 'image'>;

	let props: NodeProps<ImageNode> = $props();
</script>

<div id={props.id} class="graph-node graph-node--image">
	{#if request.image?.url}
		<img
			class="graph-node__thumbnail"
			src={request.image.url}
			alt={t('view.graph.imageNode.alt')}
		/>
	{:else}
		<p class="graph-node__placeholder">{t('view.graph.imageNode.placeholder')}</p>
	{/if}
	<Handle type="source" position={Position.Right} />
</div>

<style>
	.graph-node {
		width: 12rem;
		padding: var(--space-2);
		background: var(--color-surface);
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius);
	}

	.graph-node__thumbnail {
		display: block;
		width: 100%;
		height: 6rem;
		object-fit: cover;
		border-radius: var(--radius-sm);
	}

	.graph-node__placeholder {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--color-muted);
		text-align: center;
	}
</style>
