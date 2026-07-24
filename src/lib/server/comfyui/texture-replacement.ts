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

import workflowTemplate from '$lib/server/workflow-api-texture.json';
import {
	ComfyUiError,
	type ComfyDownloadedImage,
	type ComfyImageDescriptor,
	type ComfyUiClient,
	type ComfyQueuedWorkflow,
	type ComfyWorkflow
} from '$lib/server/comfyui/types';

export interface TextureReplacementImage {
	data: Blob;
	filename: string;
	subfolder?: string | undefined;
}

export interface TextureReplacementRequest {
	clientId?: string | undefined;
	reference: TextureReplacementImage;
	replacementSurface: string;
	scene: TextureReplacementImage;
	signal?: AbortSignal | undefined;
	pollIntervalMs?: number | undefined;
	timeoutMs?: number | undefined;
}

export type QueueTextureReplacementRequest = Omit<
	TextureReplacementRequest,
	'pollIntervalMs' | 'timeoutMs'
>;

const FINAL_OUTPUT_NODE_ID = '9';

function uploadedImagePath(image: ComfyImageDescriptor): string {
	const subfolder = image.subfolder.replace(/^\/+|\/+$/g, '');
	return subfolder.length === 0 ? image.filename : `${subfolder}/${image.filename}`;
}

function setWorkflowInput(
	workflow: ComfyWorkflow,
	nodeId: string,
	classType: string,
	input: string,
	value: string
): void {
	const node = workflow[nodeId];
	if (!node || node.class_type !== classType || !(input in node.inputs)) {
		throw new ComfyUiError(
			'invalid_configuration',
			'workflow',
			'Invalid texture replacement workflow'
		);
	}
	node.inputs[input] = value;
}

// Unlike object replacement's workflow, this graph has no in-graph
// StringConcatenate chain — the positive TextEncodeQwenImageEditPlus node's
// `prompt` widget is the final instruction text, so the full sentence is
// built here instead of inside ComfyUI.
function textureReplacementWorkflow(
	scene: ComfyImageDescriptor,
	reference: ComfyImageDescriptor,
	replacementSurface: string
): ComfyWorkflow {
	const workflow = structuredClone(workflowTemplate) as ComfyWorkflow;
	setWorkflowInput(workflow, '41', 'LoadImage', 'image', uploadedImagePath(scene));
	setWorkflowInput(workflow, '83', 'LoadImage', 'image', uploadedImagePath(reference));
	setWorkflowInput(
		workflow,
		'170:151',
		'TextEncodeQwenImageEditPlus',
		'prompt',
		`Replace the texture of the ${replacementSurface} in image 1 with the material shown in image 2.`
	);
	const outputNode = workflow[FINAL_OUTPUT_NODE_ID];
	if (!outputNode || outputNode.class_type !== 'SaveImage') {
		throw new ComfyUiError(
			'invalid_configuration',
			'workflow',
			'Invalid texture replacement workflow'
		);
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

export async function queueTextureReplacement(
	client: ComfyUiClient,
	request: QueueTextureReplacementRequest
): Promise<ComfyQueuedWorkflow> {
	const replacementSurface = request.replacementSurface.trim();
	if (replacementSurface.length === 0) {
		throw new ComfyUiError('invalid_request', 'workflow', 'Invalid replacement surface');
	}

	const scene = await client.uploadImage(
		{
			data: request.scene.data,
			filename: request.scene.filename,
			subfolder: request.scene.subfolder,
			type: 'input'
		},
		{ signal: request.signal }
	);
	const reference = await client.uploadImage(
		{
			data: request.reference.data,
			filename: request.reference.filename,
			subfolder: request.reference.subfolder,
			type: 'input'
		},
		{ signal: request.signal }
	);
	const workflow = textureReplacementWorkflow(scene, reference, replacementSurface);
	return client.queueWorkflow(workflow, { clientId: request.clientId, signal: request.signal });
}

export async function getTextureReplacementResult(
	client: ComfyUiClient,
	promptId: string,
	signal?: AbortSignal
): Promise<ComfyDownloadedImage | null> {
	const output = completedOutput(await client.getHistory(promptId, { signal }));
	return output ? client.downloadImage(output, { signal }) : null;
}

export async function runTextureReplacement(
	client: ComfyUiClient,
	request: TextureReplacementRequest
): Promise<ComfyDownloadedImage> {
	const queued = await queueTextureReplacement(client, request);
	const history = await client.waitForCompletion(queued.promptId, {
		pollIntervalMs: request.pollIntervalMs,
		signal: request.signal,
		timeoutMs: request.timeoutMs
	});
	const output = completedOutput(history);
	if (!output) throw new ComfyUiError('invalid_response', 'workflow', 'Invalid workflow status');
	return client.downloadImage(output, { signal: request.signal });
}
