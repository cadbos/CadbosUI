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

import workflowTemplate from '$lib/server/flux_kontext_edit_single_api.json';
import {
	ComfyUiError,
	type ComfyDownloadedImage,
	type ComfyImageDescriptor,
	type ComfyUiClient,
	type ComfyQueuedWorkflow,
	type ComfyWorkflow
} from '$lib/server/comfyui/types';

export interface FluxKontextEditImage {
	data: Blob;
	filename: string;
	subfolder?: string | undefined;
}

export interface FluxKontextEditRequest {
	clientId?: string | undefined;
	instruction: string;
	scene: FluxKontextEditImage;
	signal?: AbortSignal | undefined;
	pollIntervalMs?: number | undefined;
	timeoutMs?: number | undefined;
}

export type QueueFluxKontextEditRequest = Omit<
	FluxKontextEditRequest,
	'pollIntervalMs' | 'timeoutMs'
>;

const FINAL_OUTPUT_NODE_ID = '17';

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
			'Invalid Flux Kontext edit workflow'
		);
	}
	node.inputs[input] = value;
}

function fluxKontextEditWorkflow(scene: ComfyImageDescriptor, instruction: string): ComfyWorkflow {
	const workflow = structuredClone(workflowTemplate) as ComfyWorkflow;
	setWorkflowInput(workflow, '4', 'LoadImage', 'image', uploadedImagePath(scene));
	// The translation preamble lives in `string_a`; `string_b` is the actual
	// scene instruction, concatenated ahead of the GGUF text-generation node
	// (153:150) that produces the English prompt CLIPTextEncode (154) uses.
	setWorkflowInput(workflow, '153:152', 'StringConcatenate', 'string_b', instruction);
	const outputNode = workflow[FINAL_OUTPUT_NODE_ID];
	if (!outputNode || outputNode.class_type !== 'SaveImage') {
		throw new ComfyUiError(
			'invalid_configuration',
			'workflow',
			'Invalid Flux Kontext edit workflow'
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

export async function queueFluxKontextEdit(
	client: ComfyUiClient,
	request: QueueFluxKontextEditRequest
): Promise<ComfyQueuedWorkflow> {
	const instruction = request.instruction.trim();
	if (instruction.length === 0) {
		throw new ComfyUiError('invalid_request', 'workflow', 'Invalid Flux Kontext edit instruction');
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
	const workflow = fluxKontextEditWorkflow(scene, instruction);
	return client.queueWorkflow(workflow, { clientId: request.clientId, signal: request.signal });
}

export async function getFluxKontextEditResult(
	client: ComfyUiClient,
	promptId: string,
	signal?: AbortSignal
): Promise<ComfyDownloadedImage | null> {
	const output = completedOutput(await client.getHistory(promptId, { signal }));
	return output ? client.downloadImage(output, { signal }) : null;
}

export async function runFluxKontextEdit(
	client: ComfyUiClient,
	request: FluxKontextEditRequest
): Promise<ComfyDownloadedImage> {
	const queued = await queueFluxKontextEdit(client, request);
	const history = await client.waitForCompletion(queued.promptId, {
		pollIntervalMs: request.pollIntervalMs,
		signal: request.signal,
		timeoutMs: request.timeoutMs
	});
	const output = completedOutput(history);
	if (!output) throw new ComfyUiError('invalid_response', 'workflow', 'Invalid workflow status');
	return client.downloadImage(output, { signal: request.signal });
}
