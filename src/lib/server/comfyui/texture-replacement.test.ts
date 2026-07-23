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
import workflowTemplate from '$lib/server/workflow-api-texture.json';
import type {
	ComfyDownloadedImage,
	ComfyHistoryEntry,
	ComfyImageDescriptor,
	ComfyUiClient,
	ComfyWorkflow
} from '$lib/server/comfyui/types';
import {
	queueTextureReplacement,
	runTextureReplacement
} from '$lib/server/comfyui/texture-replacement';

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
	filename: 'texture_00001_.png',
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

function request(replacementSurface = '  диван  ') {
	return {
		pollIntervalMs: 25,
		reference: {
			data: new Blob(['reference'], { type: 'image/png' }),
			filename: 'reference.png'
		},
		replacementSurface,
		scene: {
			data: new Blob(['scene'], { type: 'image/png' }),
			filename: 'scene.png',
			subfolder: 'cadbos/jobs'
		},
		timeoutMs: 2_000
	};
}

describe('runTextureReplacement', () => {
	it('uploads both inputs, clones the template, and downloads only node 9', async () => {
		const client = mockClient();
		vi.mocked(client.uploadImage)
			.mockResolvedValueOnce(sceneUpload)
			.mockResolvedValueOnce(referenceUpload);
		vi.mocked(client.queueWorkflow).mockResolvedValue({ promptId: 'prompt-1', queueNumber: 0 });
		vi.mocked(client.waitForCompletion).mockResolvedValue(
			history({
				'9': { images: [finalOutput] },
				'171': { images: [{ filename: 'comparison.png', subfolder: '', type: 'output' }] }
			})
		);
		vi.mocked(client.downloadImage).mockResolvedValue(downloadedImage);

		const result = await runTextureReplacement(client, request());

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
		expectedWorkflow['41'].inputs.image = 'cadbos/jobs/scene (1).png';
		expectedWorkflow['83'].inputs.image = 'reference.png';
		expectedWorkflow['170:151'].inputs.prompt =
			'Replace the texture of the диван in image 1 with the material shown in image 2.';
		expect(queuedWorkflow).toEqual(expectedWorkflow);
		expect(workflowTemplate['41'].inputs.image).toBe('гост3.jpg');
		expect(workflowTemplate['83'].inputs.image).toBe('istockphoto-538165333-612x612.jpg');
		expect(workflowTemplate['170:151'].inputs.prompt).toBe(
			'Replace the sofa upholstery in image 1 with the blue leather from image 2.'
		);
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
			.mockResolvedValueOnce(history({ '9': { images: [finalOutput] } }))
			.mockResolvedValueOnce({
				...history({ '9': { images: [finalOutput] } }),
				promptId: 'prompt-2'
			});
		vi.mocked(client.downloadImage).mockResolvedValue(downloadedImage);

		await runTextureReplacement(client, request('sofa'));
		await runTextureReplacement(client, request('armchair'));

		const firstWorkflow = vi.mocked(client.queueWorkflow).mock.calls[0]?.[0];
		const secondWorkflow = vi.mocked(client.queueWorkflow).mock.calls[1]?.[0];
		expect(firstWorkflow).not.toBe(secondWorkflow);
		expect(firstWorkflow?.['41'].inputs.image).toBe('cadbos/jobs/scene (1).png');
		expect(firstWorkflow?.['170:151'].inputs.prompt).toBe(
			'Replace the texture of the sofa in image 1 with the material shown in image 2.'
		);
		expect(secondWorkflow?.['41'].inputs.image).toBe('cadbos/jobs/second-scene.png');
		expect(secondWorkflow?.['83'].inputs.image).toBe('second-reference.png');
		expect(secondWorkflow?.['170:151'].inputs.prompt).toBe(
			'Replace the texture of the armchair in image 1 with the material shown in image 2.'
		);
	});

	it('fails when the completed workflow has no final node 9 image', async () => {
		const client = mockClient();
		vi.mocked(client.uploadImage)
			.mockResolvedValueOnce(sceneUpload)
			.mockResolvedValueOnce(referenceUpload);
		vi.mocked(client.queueWorkflow).mockResolvedValue({ promptId: 'prompt-1', queueNumber: 0 });
		vi.mocked(client.waitForCompletion).mockResolvedValue(
			history({
				'171': { images: [{ filename: 'comparison.png', subfolder: '', type: 'output' }] }
			})
		);

		await expect(runTextureReplacement(client, request())).rejects.toMatchObject({
			code: 'missing_output',
			operation: 'workflow'
		});
		expect(client.downloadImage).not.toHaveBeenCalled();
	});
});

describe('queueTextureReplacement', () => {
	it('rejects an empty replacement surface before uploading', async () => {
		const client = mockClient();

		await expect(queueTextureReplacement(client, request('   '))).rejects.toMatchObject({
			code: 'invalid_request',
			operation: 'workflow'
		});
		expect(client.uploadImage).not.toHaveBeenCalled();
	});

	it('rejects a workflow whose configured input is missing', async () => {
		const client = mockClient();
		vi.mocked(client.uploadImage)
			.mockResolvedValueOnce(sceneUpload)
			.mockResolvedValueOnce(referenceUpload);
		const sceneNode = workflowTemplate['41'] as ComfyWorkflow[string];
		const originalImage = sceneNode.inputs.image;
		delete sceneNode.inputs.image;

		try {
			await expect(queueTextureReplacement(client, request())).rejects.toMatchObject({
				code: 'invalid_configuration',
				operation: 'workflow'
			});
			expect(client.queueWorkflow).not.toHaveBeenCalled();
		} finally {
			sceneNode.inputs.image = originalImage;
		}
	});

	it('submits the cloned workflow without waiting for completion', async () => {
		const client = mockClient();
		vi.mocked(client.uploadImage)
			.mockResolvedValueOnce(sceneUpload)
			.mockResolvedValueOnce(referenceUpload);
		vi.mocked(client.queueWorkflow).mockResolvedValue({ promptId: 'prompt-1', queueNumber: 2 });

		await expect(queueTextureReplacement(client, request())).resolves.toEqual({
			promptId: 'prompt-1',
			queueNumber: 2
		});
		expect(client.waitForCompletion).not.toHaveBeenCalled();
	});
});
