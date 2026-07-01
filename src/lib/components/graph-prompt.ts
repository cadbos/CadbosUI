/*
 * Copyright (c) 2026 Cadbos company. All rights reserved.
 *
 * SPDX-License-Identifier: LicenseRef-Cadbos-BSL-1.1
 *
 * Cadbos Interior Design AI is licensed under the Business Source License 1.1.
 * Access is limited to automated analysis tools for analysis of this repository.
 * This code is not open for contribution or usage except under a separate
 * written agreement with Cadbos company.
 *
 * Commercial use in Interior Design & AEC Generative AI Services is prohibited
 * before the Change Date. See LICENSE for complete terms.
 */

import type { PromptFragment } from '$lib/state/request.svelte';

export const IMAGE_NODE_ID = 'image';
export const COMPOSE_NODE_ID = 'compose';

const fragmentNodePrefix = 'fragment:';

export type PromptGraphNode =
	| { id: typeof IMAGE_NODE_ID; kind: 'image' }
	| { id: string; kind: 'fragment'; text: string }
	| { id: typeof COMPOSE_NODE_ID; kind: 'compose' };

export interface PromptGraphEdge {
	from: string;
	to: string;
}

export interface PromptGraph {
	nodes: PromptGraphNode[];
	edges: PromptGraphEdge[];
}

export type PromptGraphValidationError =
	| 'unknown-node'
	| 'branching-node'
	| 'cycle'
	| 'dangling-node';

export type PromptGraphResult =
	| { valid: true; fragments: Pick<PromptFragment, 'text' | 'order'>[] }
	| { valid: false; errors: PromptGraphValidationError[] };

export function fragmentNodeId(fragmentId: string): string {
	return `${fragmentNodePrefix}${fragmentId}`;
}

export function fragmentIdFromNodeId(nodeId: string): string | null {
	return nodeId.startsWith(fragmentNodePrefix) ? nodeId.slice(fragmentNodePrefix.length) : null;
}

export function buildPromptGraph(fragments: PromptFragment[]): PromptGraph {
	const orderedFragments = [...fragments].sort((a, b) => a.order - b.order);
	const fragmentNodes = orderedFragments.map(
		(fragment): PromptGraphNode => ({
			id: fragmentNodeId(fragment.id),
			kind: 'fragment',
			text: fragment.text
		})
	);
	const path = [IMAGE_NODE_ID, ...fragmentNodes.map((node) => node.id), COMPOSE_NODE_ID];

	return {
		nodes: [
			{ id: IMAGE_NODE_ID, kind: 'image' },
			...fragmentNodes,
			{ id: COMPOSE_NODE_ID, kind: 'compose' }
		],
		edges: path.slice(0, -1).map((from, index) => ({ from, to: path[index + 1] }))
	};
}

export function graphWithFragmentText(
	graph: PromptGraph,
	textByNodeId: ReadonlyMap<string, string>
): PromptGraph {
	return {
		nodes: graph.nodes.map((node) =>
			node.kind === 'fragment' ? { ...node, text: textByNodeId.get(node.id) ?? '' } : node
		),
		edges: graph.edges
	};
}

export function graphToPromptFragments(graph: PromptGraph): PromptGraphResult {
	const errors: PromptGraphValidationError[] = [];
	const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
	const adjacency = new Map<string, string[]>();
	const incoming = new Map<string, string[]>();

	for (const node of graph.nodes) {
		adjacency.set(node.id, []);
		incoming.set(node.id, []);
	}

	for (const edge of graph.edges) {
		if (!nodeById.has(edge.from) || !nodeById.has(edge.to)) {
			errors.push('unknown-node');
			continue;
		}
		adjacency.get(edge.from)?.push(edge.to);
		incoming.get(edge.to)?.push(edge.from);
	}

	for (const node of graph.nodes) {
		if ((adjacency.get(node.id)?.length ?? 0) > 1 || (incoming.get(node.id)?.length ?? 0) > 1) {
			errors.push('branching-node');
		}
	}

	if (hasCycle(graph.nodes, adjacency)) {
		errors.push('cycle');
	}

	const pathFragments: Extract<PromptGraphNode, { kind: 'fragment' }>[] = [];
	const visited = new Set<string>();
	let current = IMAGE_NODE_ID;

	while (current !== COMPOSE_NODE_ID) {
		if (visited.has(current)) break;
		visited.add(current);

		const next = adjacency.get(current) ?? [];
		if (next.length !== 1) {
			errors.push('dangling-node');
			break;
		}

		current = next[0];
		const node = nodeById.get(current);
		if (node?.kind === 'fragment') {
			pathFragments.push(node);
		}
	}

	const pathFragmentIds = new Set(pathFragments.map((node) => node.id));
	if (graph.nodes.some((node) => node.kind === 'fragment' && !pathFragmentIds.has(node.id))) {
		errors.push('dangling-node');
	}

	if (errors.length > 0) {
		return { valid: false, errors: [...new Set(errors)] };
	}

	return {
		valid: true,
		fragments: pathFragments.map((node, order) => ({ text: node.text, order }))
	};
}

function hasCycle(nodes: PromptGraphNode[], adjacency: ReadonlyMap<string, string[]>): boolean {
	const visiting = new Set<string>();
	const visited = new Set<string>();

	function visit(id: string): boolean {
		if (visiting.has(id)) return true;
		if (visited.has(id)) return false;

		visiting.add(id);
		for (const next of adjacency.get(id) ?? []) {
			if (visit(next)) return true;
		}
		visiting.delete(id);
		visited.add(id);
		return false;
	}

	return nodes.some((node) => visit(node.id));
}
