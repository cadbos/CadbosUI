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
import workflowTemplate from '$lib/server/light-settings-workflow-api.json';
import type {
	ComfyDownloadedImage,
	ComfyHistoryEntry,
	ComfyImageDescriptor,
	ComfyUiClient,
	ComfyWorkflow
} from '$lib/server/comfyui/types';
import {
	getLightSettingsResult,
	queueLightSettings,
	runLightSettings
} from '$lib/server/comfyui/light-settings';

const sceneUpload: ComfyImageDescriptor = {
	filename: 'scene (1).png',
	subfolder: 'cadbos/jobs',
	type: 'input'
};
const finalOutput: ComfyImageDescriptor = {
	filename: 'lt-run_00001_.png',
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
		status: {
			completed: true,
			status: 'success',
			executionStartedAt: 1000,
			executionSucceededAt: 1500
		}
	};
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

function request(instruction = '  зажги бра над кроватью  ') {
	return {
		instruction,
		pollIntervalMs: 25,
		scene: {
			data: new Blob(['scene'], { type: 'image/png' }),
			filename: 'scene.png',
			subfolder: 'cadbos/jobs'
		},
		timeoutMs: 2_000
	};
}

describe('runLightSettings', () => {
	it('uploads the scene, clones the template, and downloads only node 17', async () => {
		const client = mockClient();
		vi.mocked(client.uploadImage).mockResolvedValueOnce(sceneUpload);
		vi.mocked(client.queueWorkflow).mockResolvedValue({ promptId: 'prompt-1', queueNumber: 0 });
		vi.mocked(client.waitForCompletion).mockResolvedValue(
			history({
				'17': { images: [finalOutput] },
				'29': { images: [{ filename: 'comparison.png', subfolder: '', type: 'output' }] }
			})
		);
		vi.mocked(client.downloadImage).mockResolvedValue(downloadedImage);

		const result = await runLightSettings(client, request());

		expect(result).toBe(downloadedImage);
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
		expectedWorkflow['19'].inputs.value = 'зажги бра над кроватью';
		expect(queuedWorkflow).toEqual(expectedWorkflow);
		expect(workflowTemplate['1'].inputs.image).toBe('s1_dark_chandelier_001.jpg');
		expect(workflowTemplate['19'].inputs.value).toBe('зажги люстру');
		expect(queuedWorkflow?.['17'].class_type).toBe('SaveImage');
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
			.mockResolvedValueOnce({ ...sceneUpload, filename: 'second-scene.png' });
		vi.mocked(client.queueWorkflow)
			.mockResolvedValueOnce({ promptId: 'prompt-1', queueNumber: 0 })
			.mockResolvedValueOnce({ promptId: 'prompt-2', queueNumber: 0 });
		vi.mocked(client.waitForCompletion)
			.mockResolvedValueOnce(history({ '17': { images: [finalOutput] } }))
			.mockResolvedValueOnce({
				...history({ '17': { images: [finalOutput] } }),
				promptId: 'prompt-2'
			});
		vi.mocked(client.downloadImage).mockResolvedValue(downloadedImage);

		await runLightSettings(client, request('выключи все светильники'));
		await runLightSettings(client, request('зажги торшер'));

		const firstWorkflow = vi.mocked(client.queueWorkflow).mock.calls[0]?.[0];
		const secondWorkflow = vi.mocked(client.queueWorkflow).mock.calls[1]?.[0];
		expect(firstWorkflow).not.toBe(secondWorkflow);
		expect(firstWorkflow?.['1'].inputs.image).toBe('cadbos/jobs/scene (1).png');
		expect(firstWorkflow?.['19'].inputs.value).toBe('выключи все светильники');
		expect(secondWorkflow?.['1'].inputs.image).toBe('cadbos/jobs/second-scene.png');
		expect(secondWorkflow?.['19'].inputs.value).toBe('зажги торшер');
	});

	it('fails when the completed workflow has no final node 17 image', async () => {
		const client = mockClient();
		vi.mocked(client.uploadImage).mockResolvedValueOnce(sceneUpload);
		vi.mocked(client.queueWorkflow).mockResolvedValue({ promptId: 'prompt-1', queueNumber: 0 });
		vi.mocked(client.waitForCompletion).mockResolvedValue(
			history({
				'29': { images: [{ filename: 'intermediate.png', subfolder: '', type: 'output' }] }
			})
		);

		await expect(runLightSettings(client, request())).rejects.toMatchObject({
			code: 'missing_output',
			operation: 'workflow'
		});
		expect(client.downloadImage).not.toHaveBeenCalled();
	});

	it('rejects an empty instruction before uploading', async () => {
		const client = mockClient();

		await expect(runLightSettings(client, request('   '))).rejects.toMatchObject({
			code: 'invalid_request',
			operation: 'workflow'
		});
		expect(client.uploadImage).not.toHaveBeenCalled();
	});
});

describe('light settings polling', () => {
	it('returns null while ComfyUI has no completed history entry', async () => {
		const client = mockClient();
		vi.mocked(client.getHistory).mockResolvedValue(null);

		await expect(getLightSettingsResult(client, 'prompt-1')).resolves.toBeNull();
		expect(client.downloadImage).not.toHaveBeenCalled();
	});

	it('downloads only the final output after a successful poll', async () => {
		const client = mockClient();
		vi.mocked(client.getHistory).mockResolvedValue(
			history({
				'17': { images: [finalOutput] },
				'29': { images: [{ filename: 'comparison.png', subfolder: '', type: 'output' }] }
			})
		);
		vi.mocked(client.downloadImage).mockResolvedValue(downloadedImage);

		await expect(getLightSettingsResult(client, 'prompt-1')).resolves.toEqual({
			completedAt: expect.any(Number),
			executionStartedAt: 1000,
			executionSucceededAt: 1500,
			downloadSec: expect.any(Number),
			image: downloadedImage
		});
		expect(client.downloadImage).toHaveBeenCalledWith(finalOutput, { signal: undefined });
	});

	it('surfaces terminal execution failures without downloading', async () => {
		const client = mockClient();
		vi.mocked(client.getHistory).mockResolvedValue({
			...history({}),
			status: {
				completed: true,
				status: 'error',
				executionStartedAt: null,
				executionSucceededAt: null
			}
		});

		await expect(getLightSettingsResult(client, 'prompt-1')).rejects.toMatchObject({
			code: 'execution_failed',
			operation: 'workflow'
		});
		expect(client.downloadImage).not.toHaveBeenCalled();
	});

	it('can submit without waiting for completion', async () => {
		const client = mockClient();
		vi.mocked(client.uploadImage).mockResolvedValueOnce(sceneUpload);
		vi.mocked(client.queueWorkflow).mockResolvedValue({ promptId: 'prompt-1', queueNumber: 2 });

		await expect(queueLightSettings(client, request())).resolves.toEqual({
			promptId: 'prompt-1',
			queueNumber: 2
		});
		expect(client.waitForCompletion).not.toHaveBeenCalled();
	});
});
