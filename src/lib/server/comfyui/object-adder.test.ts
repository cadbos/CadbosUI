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
import workflowTemplate from '$lib/server/obj-adder-v1.json';
import type {
	ComfyDownloadedImage,
	ComfyHistoryEntry,
	ComfyImageDescriptor,
	ComfyUiClient,
	ComfyWorkflow
} from '$lib/server/comfyui/types';
import {
	getObjectAdderResult,
	queueObjectAdder,
	runObjectAdder
} from '$lib/server/comfyui/object-adder';

const sceneUpload: ComfyImageDescriptor = {
	filename: 'scene (1).png',
	subfolder: 'cadbos/jobs',
	type: 'input'
};
const compositeUpload: ComfyImageDescriptor = {
	filename: 'composite.png',
	subfolder: '',
	type: 'input'
};
const finalOutput: ComfyImageDescriptor = {
	filename: 'obj-add_00001_.png',
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

function request(prompt = '  компьютерный стул  ') {
	return {
		composite: {
			data: new Blob(['composite'], { type: 'image/png' }),
			filename: 'composite.png'
		},
		pollIntervalMs: 25,
		prompt,
		scene: {
			data: new Blob(['scene'], { type: 'image/png' }),
			filename: 'scene.png',
			subfolder: 'cadbos/jobs'
		},
		timeoutMs: 2_000
	};
}

describe('runObjectAdder', () => {
	it('uploads both inputs, clones the template, and downloads only node 105', async () => {
		const client = mockClient();
		vi.mocked(client.uploadImage)
			.mockResolvedValueOnce(sceneUpload)
			.mockResolvedValueOnce(compositeUpload);
		vi.mocked(client.queueWorkflow).mockResolvedValue({ promptId: 'prompt-1', queueNumber: 0 });
		vi.mocked(client.waitForCompletion).mockResolvedValue(
			history({
				'105': { images: [finalOutput] },
				'29': { images: [{ filename: 'comparison.png', subfolder: '', type: 'output' }] }
			})
		);
		vi.mocked(client.downloadImage).mockResolvedValue(downloadedImage);

		const result = await runObjectAdder(client, request());

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
				filename: 'composite.png',
				subfolder: undefined,
				type: 'input'
			},
			{ signal: undefined }
		);
		const queuedWorkflow = vi.mocked(client.queueWorkflow).mock.calls[0]?.[0];
		// Randomized on every call (see randomNoiseSeed's own comment) — assert
		// it moved off the template's fixed default, then pin the expected
		// workflow to whatever value actually got drawn for the rest of the
		// equality check below.
		const queuedSeed = queuedWorkflow?.['93'].inputs.noise_seed;
		expect(typeof queuedSeed).toBe('number');
		expect(queuedSeed).not.toBe(workflowTemplate['93'].inputs.noise_seed);
		expect(queuedSeed as number).toBeGreaterThanOrEqual(0);
		expect(queuedSeed as number).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
		const expectedWorkflow = structuredClone(workflowTemplate) as ComfyWorkflow;
		expectedWorkflow['100'].inputs.image = 'cadbos/jobs/scene (1).png';
		expectedWorkflow['103'].inputs.image = 'composite.png';
		expectedWorkflow['109'].inputs.value = '  компьютерный стул  ';
		expectedWorkflow['93'].inputs.noise_seed = queuedSeed;
		expect(queuedWorkflow).toEqual(expectedWorkflow);
		expect(workflowTemplate['100'].inputs.image).toBe('room.jpg');
		expect(workflowTemplate['103'].inputs.image).toBe('Frame 4(8).jpg');
		expect(workflowTemplate['109'].inputs.value).toBe(
			'Compute chair standing in front of a pink chair'
		);
		expect(queuedWorkflow?.['105']).toEqual({
			inputs: { filename_prefix: 'obj-add', images: ['93', 5] },
			class_type: 'SaveImage',
			_meta: { title: 'Save Image' }
		});
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
			.mockResolvedValueOnce(compositeUpload)
			.mockResolvedValueOnce({ ...sceneUpload, filename: 'second-scene.png' })
			.mockResolvedValueOnce({ ...compositeUpload, filename: 'second-composite.png' });
		vi.mocked(client.queueWorkflow)
			.mockResolvedValueOnce({ promptId: 'prompt-1', queueNumber: 0 })
			.mockResolvedValueOnce({ promptId: 'prompt-2', queueNumber: 0 });
		vi.mocked(client.waitForCompletion)
			.mockResolvedValueOnce(history({ '105': { images: [finalOutput] } }))
			.mockResolvedValueOnce({
				...history({ '105': { images: [finalOutput] } }),
				promptId: 'prompt-2'
			});
		vi.mocked(client.downloadImage).mockResolvedValue(downloadedImage);

		await runObjectAdder(client, request('sofa'));
		await runObjectAdder(client, request('armchair'));

		const firstWorkflow = vi.mocked(client.queueWorkflow).mock.calls[0]?.[0];
		const secondWorkflow = vi.mocked(client.queueWorkflow).mock.calls[1]?.[0];
		expect(firstWorkflow).not.toBe(secondWorkflow);
		expect(firstWorkflow?.['100'].inputs.image).toBe('cadbos/jobs/scene (1).png');
		expect(firstWorkflow?.['109'].inputs.value).toBe('sofa');
		expect(secondWorkflow?.['100'].inputs.image).toBe('cadbos/jobs/second-scene.png');
		expect(secondWorkflow?.['103'].inputs.image).toBe('second-composite.png');
		expect(secondWorkflow?.['109'].inputs.value).toBe('armchair');
		// A "regenerate with the same inputs" retry (ObjectAdderPanel) sends the
		// exact same scene/composite/prompt on the second call — only a fresh
		// seed keeps that from being a deterministic no-op re-run.
		expect(firstWorkflow?.['93'].inputs.noise_seed).not.toBe(
			secondWorkflow?.['93'].inputs.noise_seed
		);
	});

	it('fails when the completed workflow has no final node 105 image', async () => {
		const client = mockClient();
		vi.mocked(client.uploadImage)
			.mockResolvedValueOnce(sceneUpload)
			.mockResolvedValueOnce(compositeUpload);
		vi.mocked(client.queueWorkflow).mockResolvedValue({ promptId: 'prompt-1', queueNumber: 0 });
		vi.mocked(client.waitForCompletion).mockResolvedValue(
			history({
				'29': { images: [{ filename: 'intermediate.png', subfolder: '', type: 'output' }] }
			})
		);

		await expect(runObjectAdder(client, request())).rejects.toMatchObject({
			code: 'missing_output',
			operation: 'workflow'
		});
		expect(client.downloadImage).not.toHaveBeenCalled();
	});

	it('accepts an empty prompt since the prompt node is optional', async () => {
		const client = mockClient();
		vi.mocked(client.uploadImage)
			.mockResolvedValueOnce(sceneUpload)
			.mockResolvedValueOnce(compositeUpload);
		vi.mocked(client.queueWorkflow).mockResolvedValue({ promptId: 'prompt-1', queueNumber: 0 });
		vi.mocked(client.waitForCompletion).mockResolvedValue(
			history({ '105': { images: [finalOutput] } })
		);
		vi.mocked(client.downloadImage).mockResolvedValue(downloadedImage);

		await expect(runObjectAdder(client, request(''))).resolves.toBe(downloadedImage);
		const queuedWorkflow = vi.mocked(client.queueWorkflow).mock.calls[0]?.[0];
		expect(queuedWorkflow?.['109'].inputs.value).toBe('');
	});
});

describe('object adder polling', () => {
	it('returns null while ComfyUI has no completed history entry', async () => {
		const client = mockClient();
		vi.mocked(client.getHistory).mockResolvedValue(null);

		await expect(getObjectAdderResult(client, 'prompt-1')).resolves.toBeNull();
		expect(client.downloadImage).not.toHaveBeenCalled();
	});

	it('downloads only the final output after a successful poll', async () => {
		const client = mockClient();
		vi.mocked(client.getHistory).mockResolvedValue(
			history({
				'105': { images: [finalOutput] },
				'29': { images: [{ filename: 'comparison.png', subfolder: '', type: 'output' }] }
			})
		);
		vi.mocked(client.downloadImage).mockResolvedValue(downloadedImage);

		await expect(getObjectAdderResult(client, 'prompt-1')).resolves.toBe(downloadedImage);
		expect(client.downloadImage).toHaveBeenCalledWith(finalOutput, { signal: undefined });
	});

	it('surfaces terminal execution failures without downloading', async () => {
		const client = mockClient();
		vi.mocked(client.getHistory).mockResolvedValue({
			...history({}),
			status: { completed: true, status: 'error' }
		});

		await expect(getObjectAdderResult(client, 'prompt-1')).rejects.toMatchObject({
			code: 'execution_failed',
			operation: 'workflow'
		});
		expect(client.downloadImage).not.toHaveBeenCalled();
	});

	it('can submit without waiting for completion', async () => {
		const client = mockClient();
		vi.mocked(client.uploadImage)
			.mockResolvedValueOnce(sceneUpload)
			.mockResolvedValueOnce(compositeUpload);
		vi.mocked(client.queueWorkflow).mockResolvedValue({ promptId: 'prompt-1', queueNumber: 2 });

		await expect(queueObjectAdder(client, request())).resolves.toEqual({
			promptId: 'prompt-1',
			queueNumber: 2
		});
		expect(client.waitForCompletion).not.toHaveBeenCalled();
	});
});
