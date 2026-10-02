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

import { crc32, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { colorSwatchPng } from '$lib/server/color-swatch';

interface PngChunk {
	type: string;
	data: Uint8Array;
	crc: number;
	computedCrc: number;
}

function readChunks(png: Uint8Array): PngChunk[] {
	const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
	const chunks: PngChunk[] = [];
	let offset = 8;
	while (offset < png.length) {
		const length = view.getUint32(offset);
		const typed = png.subarray(offset + 4, offset + 8 + length);
		chunks.push({
			type: new TextDecoder().decode(typed.subarray(0, 4)),
			data: typed.subarray(4),
			crc: view.getUint32(offset + 8 + length),
			computedCrc: crc32(typed)
		});
		offset += 12 + length;
	}
	return chunks;
}

describe('colorSwatchPng', () => {
	it('encodes a valid, fully opaque RGB PNG filled with the requested color', async () => {
		const png = await colorSwatchPng('#a3b19b');

		expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		const chunks = readChunks(png);
		expect(chunks.map((chunk) => chunk.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
		for (const chunk of chunks) expect(chunk.crc).toBe(chunk.computedCrc);

		const header = new DataView(chunks[0].data.buffer, chunks[0].data.byteOffset, 13);
		const width = header.getUint32(0);
		const height = header.getUint32(4);
		expect([width, height]).toEqual([256, 256]);
		expect([...chunks[0].data.subarray(8)]).toEqual([8, 2, 0, 0, 0]);

		const pixels = inflateSync(chunks[1].data);
		const rowLength = 1 + width * 3;
		expect(pixels.length).toBe(rowLength * height);
		for (let row = 0; row < height; row += 1) {
			expect(pixels[row * rowLength]).toBe(0);
			for (let column = 0; column < width; column += 1) {
				const at = row * rowLength + 1 + column * 3;
				expect([pixels[at], pixels[at + 1], pixels[at + 2]]).toEqual([0xa3, 0xb1, 0x9b]);
			}
		}
	});

	it('rejects anything but a lowercase #rrggbb color', async () => {
		await expect(colorSwatchPng('#A3B19B')).rejects.toThrow('Invalid swatch color');
		await expect(colorSwatchPng('a3b19b')).rejects.toThrow('Invalid swatch color');
		await expect(colorSwatchPng('#abc')).rejects.toThrow('Invalid swatch color');
	});
});
