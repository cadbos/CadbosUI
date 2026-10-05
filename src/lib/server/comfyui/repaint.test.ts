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
import workflowTemplate from '$lib/server/repaint-workflow-api.json';
import type {
	ComfyDownloadedImage,
	ComfyHistoryEntry,
	ComfyImageDescriptor,
	ComfyUiClient,
	ComfyWorkflow
} from '$lib/server/comfyui/types';
import { getRepaintResult, queueRepaint } from '$lib/server/comfyui/repaint';

const sceneUpload: ComfyImageDescriptor = {
	filename: 'scene (1).png',
	subfolder: 'cadbos/jobs',
	type: 'input'
};
const swatchUpload: ComfyImageDescriptor = {
	filename: 'swatch.png',
	subfolder: '',
	type: 'input'
};
const finalOutput: ComfyImageDescriptor = {
	filename: 'Flux2_repaint_00001_.png',
	subfolder: '',
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

function request(target = '  стены за диваном  ') {
	return {
		target,
		scene: {
			data: new Blob(['scene'], { type: 'image/png' }),
			filename: 'scene.png',
			subfolder: 'cadbos/jobs'
		},
		swatch: {
			data: new Blob(['swatch'], { type: 'image/png' }),
			filename: 'swatch.png'
		}
	};
}

describe('queueRepaint', () => {
	it('uploads the scene and the swatch, then fills a fresh copy of the template', async () => {
		const client = mockClient();
		vi.mocked(client.uploadImage)
			.mockResolvedValueOnce(sceneUpload)
			.mockResolvedValueOnce(swatchUpload);
		vi.mocked(client.queueWorkflow).mockResolvedValue({ promptId: 'prompt-1', queueNumber: 2 });

		await expect(queueRepaint(client, request())).resolves.toEqual({
			promptId: 'prompt-1',
			queueNumber: 2
		});

		expect(vi.mocked(client.uploadImage).mock.calls).toEqual([
			[
				{ data: expect.any(Blob), filename: 'scene.png', subfolder: 'cadbos/jobs', type: 'input' },
				{ signal: undefined }
			],
			[
				{ data: expect.any(Blob), filename: 'swatch.png', subfolder: undefined, type: 'input' },
				{ signal: undefined }
			]
		]);
		const queuedWorkflow = vi.mocked(client.queueWorkflow).mock.calls[0]?.[0];
		const expectedWorkflow = structuredClone(workflowTemplate) as ComfyWorkflow;
		expectedWorkflow['42'].inputs.image = 'cadbos/jobs/scene (1).png';
		expectedWorkflow['46'].inputs.image = 'swatch.png';
		expectedWorkflow['101'].inputs.value = 'стены за диваном';
		expect(queuedWorkflow).toEqual(expectedWorkflow);
		expect(workflowTemplate['101'].inputs.value).toBe('');
		expect(client.waitForCompletion).not.toHaveBeenCalled();
	});

	it('wires the scene as picture 1 and the swatch as picture 2', () => {
		expect(workflowTemplate['210'].inputs.image).toEqual(['42', 0]);
		expect(workflowTemplate['214'].inputs.image).toEqual(['210', 0]);
		expect(workflowTemplate['213'].inputs.text).toEqual(['102:150', 0]);
		expect(workflowTemplate['220'].inputs.image).toEqual(['210', 0]);
		expect(workflowTemplate['62:45'].inputs.image).toEqual(['220', 1]);
		expect(workflowTemplate['221'].inputs.inpainted_image).toEqual(['62:8', 0]);
		expect(workflowTemplate['222'].inputs.destination).toEqual(['42', 0]);
		expect(workflowTemplate['222'].inputs.source).toEqual(['221', 0]);
		expect(workflowTemplate['62:41'].inputs.image).toEqual(['46', 0]);
		expect(workflowTemplate['62:66'].inputs.image).toEqual(['62:45', 0]);
		expect(workflowTemplate['102:152'].inputs.string_b).toEqual(['101', 0]);
		expect(workflowTemplate['105'].inputs.replace).toEqual(['102:150', 0]);
		expect(workflowTemplate['62:6'].inputs.text).toEqual(['105', 0]);
		expect(workflowTemplate['100'].class_type).toBe('SaveImage');
		expect(workflowTemplate['100'].inputs.images).toEqual(['222', 0]);
		expect(workflowTemplate['217'].inputs.mask).toEqual(['216', 0]);
		expect(workflowTemplate['218'].class_type).toBe('PreviewAny');
		expect(workflowTemplate['218'].inputs.source).toEqual(['217', 0]);
	});

	it('defaults the region to the whole scene', () => {
		expect(
			[200, 201, 202, 203].map((id) => workflowTemplate[String(id) as '200'].inputs.value)
		).toEqual([0, 0, 1, 1]);
	});

	it('confines the repaint to the region when one is given', async () => {
		const client = mockClient();
		vi.mocked(client.uploadImage)
			.mockResolvedValueOnce(sceneUpload)
			.mockResolvedValueOnce(swatchUpload);
		vi.mocked(client.queueWorkflow).mockResolvedValue({ promptId: 'prompt-1', queueNumber: 2 });

		await queueRepaint(client, {
			...request(),
			region: { x: 0.68, y: 0.61, width: 0.14, height: 0.23 }
		});

		const queuedWorkflow = vi.mocked(client.queueWorkflow).mock.calls[0]?.[0];
		expect(['200', '201', '202', '203'].map((id) => queuedWorkflow?.[id]?.inputs.value)).toEqual([
			0.68, 0.61, 0.14, 0.23
		]);
		expect(workflowTemplate['200'].inputs.value).toBe(0);
	});

	it('rejects an empty target before uploading', async () => {
		const client = mockClient();

		await expect(queueRepaint(client, request('   '))).rejects.toMatchObject({
			code: 'invalid_request',
			operation: 'workflow'
		});
		expect(client.uploadImage).not.toHaveBeenCalled();
	});
});

describe('repaint polling', () => {
	it('returns null while ComfyUI has no completed history entry', async () => {
		const client = mockClient();
		vi.mocked(client.getHistory).mockResolvedValue(null);

		await expect(getRepaintResult(client, 'prompt-1')).resolves.toBeNull();
		expect(client.downloadImage).not.toHaveBeenCalled();
	});

	it('downloads only the final output', async () => {
		const client = mockClient();
		vi.mocked(client.getHistory).mockResolvedValue(
			history({
				'100': { images: [finalOutput] },
				'103': { images: [{ filename: 'preview.png', subfolder: '', type: 'temp' }] }
			})
		);
		vi.mocked(client.downloadImage).mockResolvedValue(downloadedImage);

		await expect(getRepaintResult(client, 'prompt-1')).resolves.toEqual({
			completedAt: expect.any(Number),
			executionStartedAt: 1000,
			executionSucceededAt: 1500,
			downloadSec: expect.any(Number),
			image: downloadedImage
		});
		expect(client.downloadImage).toHaveBeenCalledTimes(1);
		expect(client.downloadImage).toHaveBeenCalledWith(finalOutput, { signal: undefined });
	});

	it('reports a target the segmenter could not find, without downloading', async () => {
		const client = mockClient();
		vi.mocked(client.getHistory).mockResolvedValue(
			history({ '100': { images: [finalOutput] }, '218': { text: ['1'] } })
		);

		await expect(getRepaintResult(client, 'prompt-1')).rejects.toMatchObject({
			code: 'target_not_found',
			operation: 'workflow'
		});
		expect(client.downloadImage).not.toHaveBeenCalled();
	});

	it('repaints when the segmenter found the target', async () => {
		const client = mockClient();
		vi.mocked(client.getHistory).mockResolvedValue(
			history({ '100': { images: [finalOutput] }, '218': { text: ['0'] } })
		);
		vi.mocked(client.downloadImage).mockResolvedValue(downloadedImage);

		await expect(getRepaintResult(client, 'prompt-1')).resolves.toMatchObject({
			image: downloadedImage
		});
	});

	it('fails when the completed workflow has no final image', async () => {
		const client = mockClient();
		vi.mocked(client.getHistory).mockResolvedValue(history({}));

		await expect(getRepaintResult(client, 'prompt-1')).rejects.toMatchObject({
			code: 'missing_output',
			operation: 'workflow'
		});
		expect(client.downloadImage).not.toHaveBeenCalled();
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

		await expect(getRepaintResult(client, 'prompt-1')).rejects.toMatchObject({
			code: 'execution_failed',
			operation: 'workflow'
		});
		expect(client.downloadImage).not.toHaveBeenCalled();
	});
});
