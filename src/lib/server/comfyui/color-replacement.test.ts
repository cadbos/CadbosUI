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
import workflowTemplate from '$lib/server/workflow-api-color.json';
import type {
	ComfyDownloadedImage,
	ComfyHistoryEntry,
	ComfyImageDescriptor,
	ComfyUiClient,
	ComfyWorkflow
} from '$lib/server/comfyui/types';
import {
	getColorReplacementResult,
	queueColorReplacement,
	runColorReplacement
} from '$lib/server/comfyui/color-replacement';

const originalPrompt =
	"Change only the color of the [target object] to [color]. Do not change this object's shape, size, geometry, material, texture pattern, reflections or position. Do not modify any other object, the background, lighting, shadows or camera angle. Everything else in the image must remain exactly as in the source image.";
const sceneUpload: ComfyImageDescriptor = {
	filename: 'scene (1).png',
	subfolder: '/cadbos/jobs/',
	type: 'input'
};
const finalOutput: ComfyImageDescriptor = {
	filename: 'color_00001_.png',
	subfolder: 'outputs',
	type: 'output'
};
const downloadedImage: ComfyDownloadedImage = {
	...finalOutput,
	bytes: new TextEncoder().encode('image').buffer,
	contentType: 'image/png'
};

function history(
	outputs: ComfyHistoryEntry['outputs'],
	status: ComfyHistoryEntry['status'] = { completed: true, status: 'success' }
): ComfyHistoryEntry {
	return { outputs, promptId: 'prompt-1', status };
}

function mockClient(): ComfyUiClient {
	return {
		cancelWorkflow: vi.fn(),
		downloadImage: vi.fn(),
		getHistory: vi.fn(),
		queueWorkflow: vi.fn(),
		uploadImage: vi.fn(),
		waitForCompletion: vi.fn()
	};
}

function request(targetObject = '  диван  ', color = '  NCS S 2050-R90B  ') {
	return {
		clientId: 'client-1',
		color,
		pollIntervalMs: 25,
		scene: {
			data: new Blob(['scene'], { type: 'image/png' }),
			filename: 'scene.png',
			subfolder: 'cadbos/jobs'
		},
		targetObject,
		timeoutMs: 2_000
	};
}

describe('runColorReplacement', () => {
	it('uploads the scene, applies both trimmed template arguments, and downloads only node 13', async () => {
		const client = mockClient();
		vi.mocked(client.uploadImage).mockResolvedValue(sceneUpload);
		vi.mocked(client.queueWorkflow).mockResolvedValue({ promptId: 'prompt-1', queueNumber: 0 });
		vi.mocked(client.waitForCompletion).mockResolvedValue(
			history({
				'12': { images: [{ filename: 'intermediate.png', subfolder: '', type: 'output' }] },
				'13': { images: [finalOutput] }
			})
		);
		vi.mocked(client.downloadImage).mockResolvedValue(downloadedImage);

		await expect(runColorReplacement(client, request())).resolves.toBe(downloadedImage);

		expect(client.uploadImage).toHaveBeenCalledTimes(1);
		expect(client.uploadImage).toHaveBeenCalledWith(
			{
				data: expect.any(Blob),
				filename: 'scene.png',
				subfolder: 'cadbos/jobs',
				type: 'input'
			},
			{ signal: undefined }
		);
		const queuedWorkflow = vi.mocked(client.queueWorkflow).mock.calls[0]?.[0];
		const expectedWorkflow = structuredClone(workflowTemplate) as ComfyWorkflow;
		expectedWorkflow['1'].inputs.image = 'cadbos/jobs/scene (1).png';
		expectedWorkflow['7'].inputs.prompt = originalPrompt
			.replace('[target object]', 'диван')
			.replace('[color]', 'NCS S 2050-R90B');
		expect(queuedWorkflow).toEqual(expectedWorkflow);
		expect(client.queueWorkflow).toHaveBeenCalledWith(expectedWorkflow, {
			clientId: 'client-1',
			signal: undefined
		});
		expect(workflowTemplate['1'].inputs.image).toBe(
			'31d4757b-8246-4c5c-8bd2-65f847ce0df4-scene.jpg'
		);
		expect(workflowTemplate['7'].inputs.prompt).toBe(originalPrompt);
		expect(client.waitForCompletion).toHaveBeenCalledWith('prompt-1', {
			pollIntervalMs: 25,
			signal: undefined,
			timeoutMs: 2_000
		});
		expect(client.downloadImage).toHaveBeenCalledTimes(1);
		expect(client.downloadImage).toHaveBeenCalledWith(finalOutput, { signal: undefined });
	});

	it('keeps the cloned workflow isolated across repeated runs', async () => {
		const client = mockClient();
		vi.mocked(client.uploadImage)
			.mockResolvedValueOnce(sceneUpload)
			.mockResolvedValueOnce({ ...sceneUpload, filename: 'second-scene.png', subfolder: '' });
		vi.mocked(client.queueWorkflow)
			.mockResolvedValueOnce({ promptId: 'prompt-1', queueNumber: 0 })
			.mockResolvedValueOnce({ promptId: 'prompt-2', queueNumber: 0 });
		vi.mocked(client.waitForCompletion)
			.mockResolvedValueOnce(history({ '13': { images: [finalOutput] } }))
			.mockResolvedValueOnce({
				...history({ '13': { images: [finalOutput] } }),
				promptId: 'prompt-2'
			});
		vi.mocked(client.downloadImage).mockResolvedValue(downloadedImage);

		await runColorReplacement(client, request('sofa', '#123456'));
		await runColorReplacement(client, request('armchair', 'warm ochre'));

		const firstWorkflow = vi.mocked(client.queueWorkflow).mock.calls[0]?.[0];
		const secondWorkflow = vi.mocked(client.queueWorkflow).mock.calls[1]?.[0];
		expect(firstWorkflow).not.toBe(secondWorkflow);
		expect(firstWorkflow?.['1'].inputs.image).toBe('cadbos/jobs/scene (1).png');
		expect(firstWorkflow?.['7'].inputs.prompt).toBe(
			originalPrompt.replace('[target object]', 'sofa').replace('[color]', '#123456')
		);
		expect(secondWorkflow?.['1'].inputs.image).toBe('second-scene.png');
		expect(secondWorkflow?.['7'].inputs.prompt).toBe(
			originalPrompt.replace('[target object]', 'armchair').replace('[color]', 'warm ochre')
		);
		expect(workflowTemplate['7'].inputs.prompt).toBe(originalPrompt);
	});

	it('fails when the completed workflow has no final node 13 image', async () => {
		const client = mockClient();
		vi.mocked(client.uploadImage).mockResolvedValue(sceneUpload);
		vi.mocked(client.queueWorkflow).mockResolvedValue({ promptId: 'prompt-1', queueNumber: 0 });
		vi.mocked(client.waitForCompletion).mockResolvedValue(
			history({
				'12': { images: [{ filename: 'intermediate.png', subfolder: '', type: 'output' }] }
			})
		);

		await expect(runColorReplacement(client, request())).rejects.toMatchObject({
			code: 'missing_output',
			operation: 'workflow'
		});
		expect(client.downloadImage).not.toHaveBeenCalled();
	});
});

describe('queueColorReplacement', () => {
	it.each([
		{ color: 'red', targetObject: '   ' },
		{ color: '   ', targetObject: 'sofa' }
	])('rejects empty template arguments before uploading', async ({ color, targetObject }) => {
		const client = mockClient();

		await expect(queueColorReplacement(client, request(targetObject, color))).rejects.toMatchObject(
			{
				code: 'invalid_request',
				operation: 'workflow'
			}
		);
		expect(client.uploadImage).not.toHaveBeenCalled();
	});

	it('rejects a missing scene image input in node 1', async () => {
		const client = mockClient();
		vi.mocked(client.uploadImage).mockResolvedValue(sceneUpload);
		const sceneNode = workflowTemplate['1'] as ComfyWorkflow[string];
		const image = sceneNode.inputs.image;
		delete sceneNode.inputs.image;

		try {
			await expect(queueColorReplacement(client, request())).rejects.toMatchObject({
				code: 'invalid_configuration',
				operation: 'workflow'
			});
			expect(client.queueWorkflow).not.toHaveBeenCalled();
		} finally {
			sceneNode.inputs.image = image;
		}
	});

	it('rejects an invalid scene image node', async () => {
		const client = mockClient();
		vi.mocked(client.uploadImage).mockResolvedValue(sceneUpload);
		const sceneNode = workflowTemplate['1'] as ComfyWorkflow[string];
		const classType = sceneNode.class_type;
		sceneNode.class_type = 'PreviewImage';

		try {
			await expect(queueColorReplacement(client, request())).rejects.toMatchObject({
				code: 'invalid_configuration',
				operation: 'workflow'
			});
			expect(client.queueWorkflow).not.toHaveBeenCalled();
		} finally {
			sceneNode.class_type = classType;
		}
	});

	it.each(['[target object]', '[color]'])('rejects a prompt missing %s', async (placeholder) => {
		const client = mockClient();
		vi.mocked(client.uploadImage).mockResolvedValue(sceneUpload);
		const promptNode = workflowTemplate['7'] as ComfyWorkflow[string];
		const prompt = promptNode.inputs.prompt;
		promptNode.inputs.prompt = originalPrompt.replace(placeholder, 'missing');

		try {
			await expect(queueColorReplacement(client, request())).rejects.toMatchObject({
				code: 'invalid_configuration',
				operation: 'workflow'
			});
			expect(client.queueWorkflow).not.toHaveBeenCalled();
		} finally {
			promptNode.inputs.prompt = prompt;
		}
	});

	it('rejects an invalid positive prompt node', async () => {
		const client = mockClient();
		vi.mocked(client.uploadImage).mockResolvedValue(sceneUpload);
		const promptNode = workflowTemplate['7'] as ComfyWorkflow[string];
		const classType = promptNode.class_type;
		promptNode.class_type = 'PrimitiveString';

		try {
			await expect(queueColorReplacement(client, request())).rejects.toMatchObject({
				code: 'invalid_configuration',
				operation: 'workflow'
			});
			expect(client.queueWorkflow).not.toHaveBeenCalled();
		} finally {
			promptNode.class_type = classType;
		}
	});

	it('rejects a missing positive prompt input', async () => {
		const client = mockClient();
		vi.mocked(client.uploadImage).mockResolvedValue(sceneUpload);
		const promptNode = workflowTemplate['7'] as ComfyWorkflow[string];
		const prompt = promptNode.inputs.prompt;
		delete promptNode.inputs.prompt;

		try {
			await expect(queueColorReplacement(client, request())).rejects.toMatchObject({
				code: 'invalid_configuration',
				operation: 'workflow'
			});
			expect(client.queueWorkflow).not.toHaveBeenCalled();
		} finally {
			promptNode.inputs.prompt = prompt;
		}
	});

	it('rejects an invalid final output node', async () => {
		const client = mockClient();
		vi.mocked(client.uploadImage).mockResolvedValue(sceneUpload);
		const outputNode = workflowTemplate['13'] as ComfyWorkflow[string];
		const classType = outputNode.class_type;
		outputNode.class_type = 'PreviewImage';

		try {
			await expect(queueColorReplacement(client, request())).rejects.toMatchObject({
				code: 'invalid_configuration',
				operation: 'workflow'
			});
			expect(client.queueWorkflow).not.toHaveBeenCalled();
		} finally {
			outputNode.class_type = classType;
		}
	});

	it('submits the cloned workflow without waiting for completion', async () => {
		const client = mockClient();
		vi.mocked(client.uploadImage).mockResolvedValue(sceneUpload);
		vi.mocked(client.queueWorkflow).mockResolvedValue({ promptId: 'prompt-1', queueNumber: 2 });

		await expect(queueColorReplacement(client, request())).resolves.toEqual({
			promptId: 'prompt-1',
			queueNumber: 2
		});
		expect(client.waitForCompletion).not.toHaveBeenCalled();
	});
});

describe('color replacement polling', () => {
	it.each([null, history({}, { completed: false, status: 'running' })])(
		'returns null while the workflow is pending',
		async (pendingHistory) => {
			const client = mockClient();
			vi.mocked(client.getHistory).mockResolvedValue(pendingHistory);

			await expect(getColorReplacementResult(client, 'prompt-1')).resolves.toBeNull();
			expect(client.downloadImage).not.toHaveBeenCalled();
		}
	);

	it('downloads only node 13 after a successful poll', async () => {
		const client = mockClient();
		vi.mocked(client.getHistory).mockResolvedValue(
			history({
				'12': { images: [{ filename: 'intermediate.png', subfolder: '', type: 'output' }] },
				'13': { images: [finalOutput] }
			})
		);
		vi.mocked(client.downloadImage).mockResolvedValue(downloadedImage);

		await expect(getColorReplacementResult(client, 'prompt-1')).resolves.toBe(downloadedImage);
		expect(client.downloadImage).toHaveBeenCalledTimes(1);
		expect(client.downloadImage).toHaveBeenCalledWith(finalOutput, { signal: undefined });
	});

	it('surfaces terminal execution failures without downloading', async () => {
		const client = mockClient();
		vi.mocked(client.getHistory).mockResolvedValue(
			history({}, { completed: true, status: 'error' })
		);

		await expect(getColorReplacementResult(client, 'prompt-1')).rejects.toMatchObject({
			code: 'execution_failed',
			operation: 'workflow'
		});
		expect(client.downloadImage).not.toHaveBeenCalled();
	});
});
