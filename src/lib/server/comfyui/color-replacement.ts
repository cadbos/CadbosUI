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

import workflowTemplate from '$lib/server/workflow-api-color.json';
import {
	ComfyUiError,
	type ComfyDownloadedImage,
	type ComfyImageDescriptor,
	type ComfyUiClient,
	type ComfyQueuedWorkflow,
	type ComfyWorkflow
} from '$lib/server/comfyui/types';

export interface ColorReplacementImage {
	data: Blob;
	filename: string;
	subfolder?: string | undefined;
}

export interface ColorReplacementRequest {
	clientId?: string | undefined;
	color: string;
	scene: ColorReplacementImage;
	signal?: AbortSignal | undefined;
	targetObject: string;
	pollIntervalMs?: number | undefined;
	timeoutMs?: number | undefined;
}

export type QueueColorReplacementRequest = Omit<
	ColorReplacementRequest,
	'pollIntervalMs' | 'timeoutMs'
>;

const FINAL_OUTPUT_NODE_ID = '13';
const TARGET_OBJECT_PLACEHOLDER = '[target object]';
const COLOR_PLACEHOLDER = '[color]';

function invalidWorkflow(): ComfyUiError {
	return new ComfyUiError(
		'invalid_configuration',
		'workflow',
		'Invalid color replacement workflow'
	);
}

function uploadedImagePath(image: ComfyImageDescriptor): string {
	const subfolder = image.subfolder.replace(/^\/+|\/+$/g, '');
	return subfolder.length === 0 ? image.filename : `${subfolder}/${image.filename}`;
}

function colorReplacementWorkflow(
	scene: ComfyImageDescriptor,
	targetObject: string,
	color: string
): ComfyWorkflow {
	const workflow = structuredClone(workflowTemplate) as ComfyWorkflow;
	const sceneNode = workflow['1'];
	if (!sceneNode || sceneNode.class_type !== 'LoadImage' || !('image' in sceneNode.inputs)) {
		throw invalidWorkflow();
	}
	sceneNode.inputs.image = uploadedImagePath(scene);

	const promptNode = workflow['7'];
	const prompt = promptNode?.inputs.prompt;
	if (
		!promptNode ||
		promptNode.class_type !== 'TextEncodeQwenImageEditPlus' ||
		typeof prompt !== 'string' ||
		!prompt.includes(TARGET_OBJECT_PLACEHOLDER) ||
		!prompt.includes(COLOR_PLACEHOLDER)
	) {
		throw invalidWorkflow();
	}
	promptNode.inputs.prompt = prompt
		.replaceAll(TARGET_OBJECT_PLACEHOLDER, targetObject)
		.replaceAll(COLOR_PLACEHOLDER, color);

	const outputNode = workflow[FINAL_OUTPUT_NODE_ID];
	if (!outputNode || outputNode.class_type !== 'SaveImage') {
		throw invalidWorkflow();
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

export async function queueColorReplacement(
	client: ComfyUiClient,
	request: QueueColorReplacementRequest
): Promise<ComfyQueuedWorkflow> {
	const targetObject = request.targetObject.trim();
	const color = request.color.trim();
	if (targetObject.length === 0 || color.length === 0) {
		throw new ComfyUiError('invalid_request', 'workflow', 'Invalid color replacement request');
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
	const workflow = colorReplacementWorkflow(scene, targetObject, color);
	return client.queueWorkflow(workflow, { clientId: request.clientId, signal: request.signal });
}

export async function getColorReplacementResult(
	client: ComfyUiClient,
	promptId: string,
	signal?: AbortSignal
): Promise<ComfyDownloadedImage | null> {
	const output = completedOutput(await client.getHistory(promptId, { signal }));
	return output ? client.downloadImage(output, { signal }) : null;
}

export async function runColorReplacement(
	client: ComfyUiClient,
	request: ColorReplacementRequest
): Promise<ComfyDownloadedImage> {
	const queued = await queueColorReplacement(client, request);
	const history = await client.waitForCompletion(queued.promptId, {
		pollIntervalMs: request.pollIntervalMs,
		signal: request.signal,
		timeoutMs: request.timeoutMs
	});
	const output = completedOutput(history);
	if (!output) throw new ComfyUiError('invalid_response', 'workflow', 'Invalid workflow status');
	return client.downloadImage(output, { signal: request.signal });
}
