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

import { describe, expect, it, vi } from 'vitest';
import workflowTemplate from '$lib/server/workflow-api.json';
import type {
	ComfyDownloadedImage,
	ComfyHistoryEntry,
	ComfyImageDescriptor,
	ComfyUiClient,
	ComfyWorkflow
} from '$lib/server/comfyui/types';
import { runObjectReplacement } from '$lib/server/comfyui/object-replacement';

const sceneUpload: ComfyImageDescriptor = {
	filename: 'scene (1).png',
	subfolder: 'cadbos/jobs',
	type: 'input'
};
const referenceUpload: ComfyImageDescriptor = {
	filename: 'reference.png',
	subfolder: '',
	type: 'input'
};
const finalOutput: ComfyImageDescriptor = {
	filename: 'stage3_00001_.png',
	subfolder: 'outputs',
	type: 'output'
};
const downloadedImage: ComfyDownloadedImage = {
	...finalOutput,
	bytes: new TextEncoder().encode('image').buffer,
	contentType: 'image/png'
};

function history(outputs: ComfyHistoryEntry['outputs']): ComfyHistoryEntry {
	return {
		outputs,
		promptId: 'prompt-1',
		status: { completed: true, status: 'success' }
	};
}

function mockClient(): ComfyUiClient {
	return {
		downloadImage: vi.fn(),
		getHistory: vi.fn(),
		queueWorkflow: vi.fn(),
		uploadImage: vi.fn(),
		waitForCompletion: vi.fn()
	};
}

function request(replacementObject = '  sofa  ') {
	return {
		pollIntervalMs: 25,
		reference: {
			data: new Blob(['reference'], { type: 'image/png' }),
			filename: 'reference.png'
		},
		replacementObject,
		scene: {
			data: new Blob(['scene'], { type: 'image/png' }),
			filename: 'scene.png',
			subfolder: 'cadbos/jobs'
		},
		timeoutMs: 2_000
	};
}

describe('runObjectReplacement', () => {
	it('uploads both inputs, clones the template, and downloads only node 29', async () => {
		const client = mockClient();
		vi.mocked(client.uploadImage)
			.mockResolvedValueOnce(sceneUpload)
			.mockResolvedValueOnce(referenceUpload);
		vi.mocked(client.queueWorkflow).mockResolvedValue({ promptId: 'prompt-1', queueNumber: 0 });
		vi.mocked(client.waitForCompletion).mockResolvedValue(
			history({
				'14': { images: [{ filename: 'removed.png', subfolder: '', type: 'output' }] },
				'25': { images: [{ filename: 'replaced.png', subfolder: '', type: 'output' }] },
				'29': { images: [finalOutput] }
			})
		);
		vi.mocked(client.downloadImage).mockResolvedValue(downloadedImage);

		const result = await runObjectReplacement(client, request());

		expect(result).toBe(downloadedImage);
		expect(client.uploadImage).toHaveBeenNthCalledWith(
			1,
			{
				data: expect.any(Blob),
				filename: 'scene.png',
				subfolder: 'cadbos/jobs',
				type: 'input'
			},
			{ signal: undefined }
		);
		expect(client.uploadImage).toHaveBeenNthCalledWith(
			2,
			{
				data: expect.any(Blob),
				filename: 'reference.png',
				subfolder: undefined,
				type: 'input'
			},
			{ signal: undefined }
		);
		const queuedWorkflow = vi.mocked(client.queueWorkflow).mock.calls[0]?.[0];
		const expectedWorkflow = structuredClone(workflowTemplate) as ComfyWorkflow;
		expectedWorkflow['4'].inputs.image = 'cadbos/jobs/scene (1).png';
		expectedWorkflow['15'].inputs.image = 'reference.png';
		expectedWorkflow['30'].inputs.value = 'sofa';
		expect(queuedWorkflow).toEqual(expectedWorkflow);
		expect(workflowTemplate['4'].inputs.image).toBe('scene.png');
		expect(workflowTemplate['15'].inputs.image).toBe('reference_object.png');
		expect(workflowTemplate['30'].inputs.value).toBe('sofa');
		expect(client.waitForCompletion).toHaveBeenCalledWith('prompt-1', {
			pollIntervalMs: 25,
			signal: undefined,
			timeoutMs: 2_000
		});
		expect(client.downloadImage).toHaveBeenCalledTimes(1);
		expect(client.downloadImage).toHaveBeenCalledWith(finalOutput, { signal: undefined });
	});

	it('keeps workflow state isolated across repeated runs', async () => {
		const client = mockClient();
		vi.mocked(client.uploadImage)
			.mockResolvedValueOnce(sceneUpload)
			.mockResolvedValueOnce(referenceUpload)
			.mockResolvedValueOnce({ ...sceneUpload, filename: 'second-scene.png' })
			.mockResolvedValueOnce({ ...referenceUpload, filename: 'second-reference.png' });
		vi.mocked(client.queueWorkflow)
			.mockResolvedValueOnce({ promptId: 'prompt-1', queueNumber: 0 })
			.mockResolvedValueOnce({ promptId: 'prompt-2', queueNumber: 0 });
		vi.mocked(client.waitForCompletion)
			.mockResolvedValueOnce(history({ '29': { images: [finalOutput] } }))
			.mockResolvedValueOnce({
				...history({ '29': { images: [finalOutput] } }),
				promptId: 'prompt-2'
			});
		vi.mocked(client.downloadImage).mockResolvedValue(downloadedImage);

		await runObjectReplacement(client, request('sofa'));
		await runObjectReplacement(client, request('armchair'));

		const firstWorkflow = vi.mocked(client.queueWorkflow).mock.calls[0]?.[0];
		const secondWorkflow = vi.mocked(client.queueWorkflow).mock.calls[1]?.[0];
		expect(firstWorkflow).not.toBe(secondWorkflow);
		expect(firstWorkflow?.['4'].inputs.image).toBe('cadbos/jobs/scene (1).png');
		expect(firstWorkflow?.['30'].inputs.value).toBe('sofa');
		expect(secondWorkflow?.['4'].inputs.image).toBe('cadbos/jobs/second-scene.png');
		expect(secondWorkflow?.['15'].inputs.image).toBe('second-reference.png');
		expect(secondWorkflow?.['30'].inputs.value).toBe('armchair');
	});

	it('fails when the completed workflow has no final node 29 image', async () => {
		const client = mockClient();
		vi.mocked(client.uploadImage)
			.mockResolvedValueOnce(sceneUpload)
			.mockResolvedValueOnce(referenceUpload);
		vi.mocked(client.queueWorkflow).mockResolvedValue({ promptId: 'prompt-1', queueNumber: 0 });
		vi.mocked(client.waitForCompletion).mockResolvedValue(
			history({
				'25': { images: [{ filename: 'intermediate.png', subfolder: '', type: 'output' }] }
			})
		);

		await expect(runObjectReplacement(client, request())).rejects.toMatchObject({
			code: 'missing_output',
			operation: 'workflow'
		});
		expect(client.downloadImage).not.toHaveBeenCalled();
	});

	it('rejects an empty replacement object before uploading', async () => {
		const client = mockClient();

		await expect(runObjectReplacement(client, request('   '))).rejects.toMatchObject({
			code: 'invalid_request',
			operation: 'workflow'
		});
		expect(client.uploadImage).not.toHaveBeenCalled();
	});
});
