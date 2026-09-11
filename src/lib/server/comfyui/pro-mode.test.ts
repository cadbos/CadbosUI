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
import workflowTemplate from '$lib/server/pro-mode-workflow.json';
import type {
	ComfyDownloadedImage,
	ComfyHistoryEntry,
	ComfyImageDescriptor,
	ComfyUiClient,
	ComfyWorkflow
} from '$lib/server/comfyui/types';
import { getProModeResult, queueProMode, runProMode } from '$lib/server/comfyui/pro-mode';

const sceneUpload: ComfyImageDescriptor = {
	filename: 'scene (1).webp',
	subfolder: 'cadbos/jobs',
	type: 'input'
};
const referenceUpload: ComfyImageDescriptor = {
	filename: 'reference.webp',
	subfolder: '',
	type: 'input'
};
const finalOutput: ComfyImageDescriptor = {
	filename: 'pro-mode_00001_.png',
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
		cancelWorkflow: vi.fn(),
		downloadImage: vi.fn(),
		getHistory: vi.fn(),
		queueWorkflow: vi.fn(),
		uploadImage: vi.fn(),
		waitForCompletion: vi.fn()
	};
}

function request(prompt = '  замени диван на голубой  ') {
	return {
		pollIntervalMs: 25,
		prompt,
		speedVsQuality: 0.4,
		reference: {
			data: new Blob(['reference'], { type: 'image/webp' }),
			filename: 'reference.webp'
		},
		scene: {
			data: new Blob(['scene'], { type: 'image/webp' }),
			filename: 'scene.webp',
			subfolder: 'cadbos/jobs'
		},
		timeoutMs: 2_000
	};
}

describe('runProMode with a reference image', () => {
	it('uploads both inputs, clones the template, and downloads only node 17', async () => {
		const client = mockClient();
		vi.mocked(client.uploadImage)
			.mockResolvedValueOnce(sceneUpload)
			.mockResolvedValueOnce(referenceUpload);
		vi.mocked(client.queueWorkflow).mockResolvedValue({ promptId: 'prompt-1', queueNumber: 0 });
		vi.mocked(client.waitForCompletion).mockResolvedValue(
			history({ '17': { images: [finalOutput] } })
		);
		vi.mocked(client.downloadImage).mockResolvedValue(downloadedImage);

		const result = await runProMode(client, request());

		expect(result).toBe(downloadedImage);
		expect(client.uploadImage).toHaveBeenCalledTimes(2);
		const queuedWorkflow = vi.mocked(client.queueWorkflow).mock.calls[0]?.[0];
		const expectedWorkflow = structuredClone(workflowTemplate) as ComfyWorkflow;
		expectedWorkflow['1'].inputs.image = 'cadbos/jobs/scene (1).webp';
		expectedWorkflow['2'].inputs.image = 'reference.webp';
		expectedWorkflow['142:21'].inputs.prompt = 'замени диван на голубой';
		expectedWorkflow['151'].inputs.value = 0.4;
		expect(queuedWorkflow).toEqual(expectedWorkflow);
		expect(queuedWorkflow?.['11'].inputs.image2).toEqual(['4', 0]);
		expect(client.downloadImage).toHaveBeenCalledWith(finalOutput, { signal: undefined });
	});

	it('rejects an empty prompt before uploading', async () => {
		const client = mockClient();

		await expect(runProMode(client, request('   '))).rejects.toMatchObject({
			code: 'invalid_request',
			operation: 'workflow'
		});
		expect(client.uploadImage).not.toHaveBeenCalled();
	});
});

describe('runProMode without a reference image', () => {
	function requestWithoutReference(prompt = 'sofa') {
		const full = request(prompt);
		return {
			pollIntervalMs: full.pollIntervalMs,
			prompt: full.prompt,
			speedVsQuality: full.speedVsQuality,
			scene: full.scene,
			timeoutMs: full.timeoutMs
		};
	}

	it('drops the reference nodes and rewrites the prompt template', async () => {
		const client = mockClient();
		vi.mocked(client.uploadImage).mockResolvedValueOnce(sceneUpload);
		vi.mocked(client.queueWorkflow).mockResolvedValue({ promptId: 'prompt-1', queueNumber: 0 });
		vi.mocked(client.waitForCompletion).mockResolvedValue(
			history({ '17': { images: [finalOutput] } })
		);
		vi.mocked(client.downloadImage).mockResolvedValue(downloadedImage);

		await runProMode(client, requestWithoutReference());

		// Only the scene is uploaded — no second uploadImage call for a reference.
		expect(client.uploadImage).toHaveBeenCalledTimes(1);
		const queuedWorkflow = vi.mocked(client.queueWorkflow).mock.calls[0]?.[0];
		expect(queuedWorkflow?.['2']).toBeUndefined();
		expect(queuedWorkflow?.['4']).toBeUndefined();
		expect(queuedWorkflow?.['11'].inputs.image2).toBeUndefined();
		expect(queuedWorkflow?.['11'].inputs.image1).toEqual(
			(workflowTemplate as unknown as ComfyWorkflow)['11'].inputs.image1
		);
		expect(queuedWorkflow?.['23'].inputs.value).not.toContain('Picture 2');
		expect(queuedWorkflow?.['23'].inputs.value).toContain('{prompt}');
		expect(queuedWorkflow?.['28'].inputs.image2).toEqual(['36', 0]);
		expect(queuedWorkflow?.['28'].inputs.image3).toBeUndefined();
	});
});

describe('pro mode polling', () => {
	it('returns null while ComfyUI has no completed history entry', async () => {
		const client = mockClient();
		vi.mocked(client.getHistory).mockResolvedValue(null);

		await expect(getProModeResult(client, 'prompt-1')).resolves.toBeNull();
		expect(client.downloadImage).not.toHaveBeenCalled();
	});

	it('surfaces terminal execution failures without downloading', async () => {
		const client = mockClient();
		vi.mocked(client.getHistory).mockResolvedValue({
			...history({}),
			status: { completed: true, status: 'error' }
		});

		await expect(getProModeResult(client, 'prompt-1')).rejects.toMatchObject({
			code: 'execution_failed',
			operation: 'workflow'
		});
		expect(client.downloadImage).not.toHaveBeenCalled();
	});

	it('can submit without waiting for completion', async () => {
		const client = mockClient();
		vi.mocked(client.uploadImage)
			.mockResolvedValueOnce(sceneUpload)
			.mockResolvedValueOnce(referenceUpload);
		vi.mocked(client.queueWorkflow).mockResolvedValue({ promptId: 'prompt-1', queueNumber: 2 });

		await expect(queueProMode(client, request())).resolves.toEqual({
			promptId: 'prompt-1',
			queueNumber: 2
		});
		expect(client.waitForCompletion).not.toHaveBeenCalled();
	});
});
