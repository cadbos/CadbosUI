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

export type ComfyJsonValue =
	| boolean
	| number
	| string
	| null
	| ComfyJsonValue[]
	| { [key: string]: ComfyJsonValue };

export interface ComfyWorkflowNode {
	class_type: string;
	inputs: Record<string, ComfyJsonValue>;
	_meta?: { title?: string | undefined } | undefined;
}

export type ComfyWorkflow = Record<string, ComfyWorkflowNode>;

export type ComfyImageStorageType = 'input' | 'output' | 'temp';

export interface ComfyImageDescriptor {
	filename: string;
	subfolder: string;
	type: ComfyImageStorageType;
}

export interface ComfyDownloadedImage extends ComfyImageDescriptor {
	bytes: ArrayBuffer;
	contentType: string;
}

export interface ComfyImageUpload {
	data: Blob;
	filename: string;
	overwrite?: boolean | undefined;
	subfolder?: string | undefined;
	type?: ComfyImageStorageType | undefined;
}

export interface ComfyQueuedWorkflow {
	promptId: string;
	queueNumber: number;
}

export interface ComfyHistoryStatus {
	completed: boolean;
	status: string;
}

export interface ComfyHistoryNodeOutput {
	images?: ComfyImageDescriptor[] | undefined;
}

export interface ComfyHistoryEntry {
	promptId: string;
	outputs: Record<string, ComfyHistoryNodeOutput>;
	status: ComfyHistoryStatus;
}

export type ComfyUiOperation =
	| 'configuration'
	| 'download_image'
	| 'get_history'
	| 'queue_workflow'
	| 'upload_image'
	| 'wait_for_completion'
	| 'workflow';

export type ComfyUiErrorCode =
	| 'aborted'
	| 'execution_failed'
	| 'http_error'
	| 'invalid_configuration'
	| 'invalid_request'
	| 'invalid_response'
	| 'missing_output'
	| 'network_error'
	| 'prompt_rejected'
	| 'timeout';

export class ComfyUiError extends Error {
	readonly code: ComfyUiErrorCode;
	readonly operation: ComfyUiOperation;
	readonly status?: number | undefined;

	constructor(
		code: ComfyUiErrorCode,
		operation: ComfyUiOperation,
		message: string,
		options: { cause?: unknown; status?: number | undefined } = {}
	) {
		super(message, options.cause === undefined ? undefined : { cause: options.cause });
		this.name = 'ComfyUiError';
		this.code = code;
		this.operation = operation;
		this.status = options.status;
	}
}

export interface ComfyUiClientOptions {
	baseUrl: string | URL;
	fetch?: typeof fetch | undefined;
	headers?: HeadersInit | undefined;
}

export interface ComfyRequestOptions {
	signal?: AbortSignal | undefined;
}

export interface ComfyQueueOptions extends ComfyRequestOptions {
	clientId?: string | undefined;
	promptId?: string | undefined;
}

export interface ComfyWaitOptions extends ComfyRequestOptions {
	pollIntervalMs?: number | undefined;
	timeoutMs?: number | undefined;
}

export interface ComfyUiClient {
	downloadImage(
		image: ComfyImageDescriptor,
		options?: ComfyRequestOptions
	): Promise<ComfyDownloadedImage>;
	getHistory(promptId: string, options?: ComfyRequestOptions): Promise<ComfyHistoryEntry | null>;
	queueWorkflow(workflow: ComfyWorkflow, options?: ComfyQueueOptions): Promise<ComfyQueuedWorkflow>;
	uploadImage(
		image: ComfyImageUpload,
		options?: ComfyRequestOptions
	): Promise<ComfyImageDescriptor>;
	waitForCompletion(promptId: string, options?: ComfyWaitOptions): Promise<ComfyHistoryEntry>;
}
