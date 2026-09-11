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

import workflowTemplate from '$lib/server/pro-mode-workflow.json';
import {
	ComfyUiError,
	type ComfyDownloadedImage,
	type ComfyImageDescriptor,
	type ComfyJsonValue,
	type ComfyUiClient,
	type ComfyQueuedWorkflow,
	type ComfyWorkflow
} from '$lib/server/comfyui/types';

export interface ProModeImage {
	data: Blob;
	filename: string;
	subfolder?: string | undefined;
}

export interface ProModeRequest {
	clientId?: string | undefined;
	prompt: string;
	speedVsQuality: number;
	reference?: ProModeImage | undefined;
	scene: ProModeImage;
	signal?: AbortSignal | undefined;
	pollIntervalMs?: number | undefined;
	timeoutMs?: number | undefined;
}

export type QueueProModeRequest = Omit<ProModeRequest, 'pollIntervalMs' | 'timeoutMs'>;

const FINAL_OUTPUT_NODE_ID = '17';

// Node 23's default template assumes a reference (Picture 2) is present. When
// the user submits without one, this replaces it — see omitReferenceImage.
const SINGLE_IMAGE_PROMPT_TEMPLATE =
	'Apply exactly this edit instruction: "{prompt}"\n\n' +
	'Photorealistic and seamless, as if photographed in a single shot.';

function uploadedImagePath(image: ComfyImageDescriptor): string {
	const subfolder = image.subfolder.replace(/^\/+|\/+$/g, '');
	return subfolder.length === 0 ? image.filename : `${subfolder}/${image.filename}`;
}

function setWorkflowInput(
	workflow: ComfyWorkflow,
	nodeId: string,
	classType: string,
	input: string,
	value: ComfyJsonValue
): void {
	const node = workflow[nodeId];
	if (!node || node.class_type !== classType || !(input in node.inputs)) {
		throw new ComfyUiError('invalid_configuration', 'workflow', 'Invalid pro mode workflow');
	}
	node.inputs[input] = value;
}

// Drops the optional reference image (node 2) and everything downstream that
// only exists to consume it, so the graph stays valid with a single input
// image. Node 28 is the history-stitch preview only (not read by the app —
// only node 17's output is fetched) but is rewired too for correctness.
function omitReferenceImage(workflow: ComfyWorkflow): void {
	const referenceNode = workflow['2'];
	const scaledReferenceNode = workflow['4'];
	const promptNode = workflow['11'];
	const templateNode = workflow['23'];
	const historyNode = workflow['28'];
	if (
		!referenceNode ||
		referenceNode.class_type !== 'LoadImage' ||
		!scaledReferenceNode ||
		scaledReferenceNode.class_type !== 'ImageScaleToTotalPixels' ||
		!promptNode ||
		promptNode.class_type !== 'TextEncodeQwenImageEditPlus' ||
		!('image2' in promptNode.inputs) ||
		!templateNode ||
		templateNode.class_type !== 'PrimitiveStringMultiline' ||
		!historyNode ||
		historyNode.class_type !== 'AILab_ImageStitch' ||
		!('image3' in historyNode.inputs)
	) {
		throw new ComfyUiError('invalid_configuration', 'workflow', 'Invalid pro mode workflow');
	}
	delete workflow['2'];
	delete workflow['4'];
	delete promptNode.inputs.image2;
	templateNode.inputs.value = SINGLE_IMAGE_PROMPT_TEMPLATE;
	historyNode.inputs.image2 = historyNode.inputs.image3;
	delete historyNode.inputs.image3;
}

function proModeWorkflow(
	scene: ComfyImageDescriptor,
	reference: ComfyImageDescriptor | undefined,
	prompt: string,
	speedVsQuality: number
): ComfyWorkflow {
	const workflow = structuredClone(workflowTemplate) as ComfyWorkflow;
	setWorkflowInput(workflow, '1', 'LoadImage', 'image', uploadedImagePath(scene));
	setWorkflowInput(workflow, '142:21', 'PromptTranslatorNode', 'prompt', prompt);
	setWorkflowInput(workflow, '151', 'PrimitiveFloat', 'value', speedVsQuality);
	if (reference) {
		setWorkflowInput(workflow, '2', 'LoadImage', 'image', uploadedImagePath(reference));
	} else {
		omitReferenceImage(workflow);
	}
	const outputNode = workflow[FINAL_OUTPUT_NODE_ID];
	if (!outputNode || outputNode.class_type !== 'SaveImage') {
		throw new ComfyUiError('invalid_configuration', 'workflow', 'Invalid pro mode workflow');
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

export async function queueProMode(
	client: ComfyUiClient,
	request: QueueProModeRequest
): Promise<ComfyQueuedWorkflow> {
	const prompt = request.prompt.trim();
	if (prompt.length === 0) {
		throw new ComfyUiError('invalid_request', 'workflow', 'Invalid prompt');
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
	const reference = request.reference
		? await client.uploadImage(
				{
					data: request.reference.data,
					filename: request.reference.filename,
					subfolder: request.reference.subfolder,
					type: 'input'
				},
				{ signal: request.signal }
			)
		: undefined;
	const workflow = proModeWorkflow(scene, reference, prompt, request.speedVsQuality);
	return client.queueWorkflow(workflow, { clientId: request.clientId, signal: request.signal });
}

export async function getProModeResult(
	client: ComfyUiClient,
	promptId: string,
	signal?: AbortSignal
): Promise<ComfyDownloadedImage | null> {
	const output = completedOutput(await client.getHistory(promptId, { signal }));
	return output ? client.downloadImage(output, { signal }) : null;
}

export async function runProMode(
	client: ComfyUiClient,
	request: ProModeRequest
): Promise<ComfyDownloadedImage> {
	const queued = await queueProMode(client, request);
	const history = await client.waitForCompletion(queued.promptId, {
		pollIntervalMs: request.pollIntervalMs,
		signal: request.signal,
		timeoutMs: request.timeoutMs
	});
	const output = completedOutput(history);
	if (!output) throw new ComfyUiError('invalid_response', 'workflow', 'Invalid workflow status');
	return client.downloadImage(output, { signal: request.signal });
}
