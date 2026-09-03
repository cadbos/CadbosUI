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

import workflowTemplate from '$lib/server/obj-adder-v1.json';
import {
	ComfyUiError,
	type ComfyDownloadedImage,
	type ComfyImageDescriptor,
	type ComfyUiClient,
	type ComfyQueuedWorkflow,
	type ComfyWorkflow
} from '$lib/server/comfyui/types';

export interface ObjectAdderImage {
	data: Blob;
	filename: string;
	subfolder?: string | undefined;
}

export interface ObjectAdderRequest {
	clientId?: string | undefined;
	composite: ObjectAdderImage;
	prompt: string;
	scene: ObjectAdderImage;
	signal?: AbortSignal | undefined;
	pollIntervalMs?: number | undefined;
	timeoutMs?: number | undefined;
}

export type QueueObjectAdderRequest = Omit<ObjectAdderRequest, 'pollIntervalMs' | 'timeoutMs'>;

const FINAL_OUTPUT_NODE_ID = '105';

function uploadedImagePath(image: ComfyImageDescriptor): string {
	const subfolder = image.subfolder.replace(/^\/+|\/+$/g, '');
	return subfolder.length === 0 ? image.filename : `${subfolder}/${image.filename}`;
}

function setWorkflowInput(
	workflow: ComfyWorkflow,
	nodeId: string,
	classType: string,
	input: string,
	value: string | number
): void {
	const node = workflow[nodeId];
	if (!node || node.class_type !== classType || !(input in node.inputs)) {
		throw new ComfyUiError('invalid_configuration', 'workflow', 'Invalid object adder workflow');
	}
	node.inputs[input] = value;
}

// The workflow's own noise_seed is a fixed value baked in at export time —
// ComfyUI's "-1 / randomize" seed control is a queue-button convenience in
// its own UI, not something the exported API-format JSON can express, so a
// fixed seed here would otherwise make every generation (and in particular
// ObjectAdderPanel's "regenerate" retry, which reuses the exact same scene/
// object/prompt) produce the same, or near-identical, output every time.
// Kept within Number.MAX_SAFE_INTEGER so it round-trips through JSON exactly.
function randomNoiseSeed(): number {
	return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
}

function objectAdderWorkflow(
	scene: ComfyImageDescriptor,
	composite: ComfyImageDescriptor,
	prompt: string
): ComfyWorkflow {
	const workflow = structuredClone(workflowTemplate) as ComfyWorkflow;
	setWorkflowInput(workflow, '100', 'LoadImage', 'image', uploadedImagePath(scene));
	setWorkflowInput(workflow, '103', 'LoadImage', 'image', uploadedImagePath(composite));
	setWorkflowInput(workflow, '109', 'PrimitiveStringMultiline', 'value', prompt);
	setWorkflowInput(workflow, '93', 'KSampler Adv. (Efficient)', 'noise_seed', randomNoiseSeed());
	const outputNode = workflow[FINAL_OUTPUT_NODE_ID];
	if (!outputNode || outputNode.class_type !== 'SaveImage') {
		throw new ComfyUiError('invalid_configuration', 'workflow', 'Invalid object adder workflow');
	}
	return workflow;
}

function completedOutput(history: Awaited<ReturnType<ComfyUiClient['getHistory']>>) {
	if (history === null) return null;
	if (
		history.status.status === 'error' ||
		(history.status.completed && history.status.status !== 'success')
	) {
		throw new ComfyUiError('execution_failed', 'workflow', 'ComfyUI workflow execution failed');
	}
	if (!history.status.completed) return null;
	const output = history.outputs[FINAL_OUTPUT_NODE_ID]?.images?.[0];
	if (!output) {
		throw new ComfyUiError(
			'missing_output',
			'workflow',
			'ComfyUI workflow did not produce a final image'
		);
	}
	return output;
}

export async function queueObjectAdder(
	client: ComfyUiClient,
	request: QueueObjectAdderRequest
): Promise<ComfyQueuedWorkflow> {
	const scene = await client.uploadImage(
		{
			data: request.scene.data,
			filename: request.scene.filename,
			subfolder: request.scene.subfolder,
			type: 'input'
		},
		{ signal: request.signal }
	);
	const composite = await client.uploadImage(
		{
			data: request.composite.data,
			filename: request.composite.filename,
			subfolder: request.composite.subfolder,
			type: 'input'
		},
		{ signal: request.signal }
	);
	const workflow = objectAdderWorkflow(scene, composite, request.prompt);
	return client.queueWorkflow(workflow, { clientId: request.clientId, signal: request.signal });
}

export async function getObjectAdderResult(
	client: ComfyUiClient,
	promptId: string,
	signal?: AbortSignal
): Promise<ComfyDownloadedImage | null> {
	const output = completedOutput(await client.getHistory(promptId, { signal }));
	return output ? client.downloadImage(output, { signal }) : null;
}

export async function runObjectAdder(
	client: ComfyUiClient,
	request: ObjectAdderRequest
): Promise<ComfyDownloadedImage> {
	const queued = await queueObjectAdder(client, request);
	const history = await client.waitForCompletion(queued.promptId, {
		pollIntervalMs: request.pollIntervalMs,
		signal: request.signal,
		timeoutMs: request.timeoutMs
	});
	const output = completedOutput(history);
	if (!output) throw new ComfyUiError('invalid_response', 'workflow', 'Invalid workflow status');
	return client.downloadImage(output, { signal: request.signal });
}
