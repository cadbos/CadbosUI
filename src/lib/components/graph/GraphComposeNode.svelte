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

	type ComposeNode = Node<Record<string, never>, 'compose'>;

	let props: NodeProps<ComposeNode> = $props();
</script>

<div id={props.id} class="graph-node graph-node--compose">
	<Handle type="target" position={Position.Left} />
	<label class="graph-node__field">
		<span>{t('view.keyValue.promptPreview')}</span>
		<textarea class="nodrag" readonly value={request.prompt}></textarea>
	</label>
</div>

<style>
	.graph-node {
		width: 14rem;
		padding: var(--space-2);
		background: var(--color-surface);
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius);
	}

	.graph-node__field {
		display: grid;
		gap: var(--space-1);
		font-size: 0.8125rem;
	}

	textarea {
		font: inherit;
		resize: vertical;
		min-height: 4rem;
		padding: var(--space-1);
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-background);
		color: var(--color-text);
	}
</style>
