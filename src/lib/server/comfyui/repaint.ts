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

import workflowTemplate from '$lib/server/repaint-workflow-api.json';
import {
	ComfyUiError,
	type ComfyDownloadedImage,
	type ComfyImageDescriptor,
	type ComfyUiClient,
	type ComfyQueuedWorkflow,
	type ComfyWorkflow
} from '$lib/server/comfyui/types';

export interface RepaintImage {
	data: Blob;
	filename: string;
	subfolder?: string | undefined;
}

export interface QueueRepaintRequest {
	clientId?: string | undefined;
	target: string;
	scene: RepaintImage;
	swatch: RepaintImage;
	signal?: AbortSignal | undefined;
}

const FINAL_OUTPUT_NODE_ID = '100';

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
		throw new ComfyUiError('invalid_configuration', 'workflow', 'Invalid repaint workflow');
	}
	node.inputs[input] = value;
}

function repaintWorkflow(
	scene: ComfyImageDescriptor,
	swatch: ComfyImageDescriptor,
	target: string
): ComfyWorkflow {
	const workflow = structuredClone(workflowTemplate) as ComfyWorkflow;
	// Picture 1 (node 42) is the scene and fixes the output size; picture 2
	// (node 46) is the solid color swatch. The target is translated to English
	// (102:*) and substituted into the prompt template's `{}` slots (105).
	setWorkflowInput(workflow, '42', 'LoadImage', 'image', uploadedImagePath(scene));
	setWorkflowInput(workflow, '46', 'LoadImage', 'image', uploadedImagePath(swatch));
	setWorkflowInput(workflow, '101', 'PrimitiveString', 'value', target);
	const outputNode = workflow[FINAL_OUTPUT_NODE_ID];
	if (!outputNode || outputNode.class_type !== 'SaveImage') {
		throw new ComfyUiError('invalid_configuration', 'workflow', 'Invalid repaint workflow');
	}
	return workflow;
}

export async function queueRepaint(
	client: ComfyUiClient,
	request: QueueRepaintRequest
): Promise<ComfyQueuedWorkflow> {
	const target = request.target.trim();
	if (target.length === 0) {
		throw new ComfyUiError('invalid_request', 'workflow', 'Invalid repaint target');
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
	const swatch = await client.uploadImage(
		{
			data: request.swatch.data,
			filename: request.swatch.filename,
			subfolder: request.swatch.subfolder,
			type: 'input'
		},
		{ signal: request.signal }
	);
	const workflow = repaintWorkflow(scene, swatch, target);
	return client.queueWorkflow(workflow, { clientId: request.clientId, signal: request.signal });
}

export async function getRepaintResult(
	client: ComfyUiClient,
	promptId: string,
	signal?: AbortSignal
): Promise<{
	completedAt: number;
	executionStartedAt: number | null;
	executionSucceededAt: number | null;
	downloadSec: number;
	image: ComfyDownloadedImage;
} | null> {
	const history = await client.getHistory(promptId, { signal });
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
	const completedAt = Date.now();
	const image = await client.downloadImage(output, { signal });
	const downloadSec = Math.round((Date.now() - completedAt) / 1000);
	return {
		completedAt,
		executionStartedAt: history.status.executionStartedAt,
		executionSucceededAt: history.status.executionSucceededAt,
		downloadSec,
		image
	};
}
