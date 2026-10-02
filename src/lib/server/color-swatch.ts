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

import { REPAINT_COLOR_PATTERN } from '$lib/repaint-colors';

const SWATCH_SIZE = 256;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_COLOR_TYPE_RGB = 2;

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
	let crc = index;
	for (let bit = 0; bit < 8; bit += 1) {
		crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
	}
	return crc >>> 0;
});

function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
	const typed = new Uint8Array(4 + data.length);
	typed.set(new TextEncoder().encode(type), 0);
	typed.set(data, 4);
	const out = new Uint8Array(4 + typed.length + 4);
	const view = new DataView(out.buffer);
	view.setUint32(0, data.length);
	out.set(typed, 4);
	view.setUint32(4 + typed.length, crc32(typed));
	return out;
}

async function deflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
	const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

// A square, fully opaque PNG filled with one color — the "reference picture"
// the repaint workflow takes its target color from.
export async function colorSwatchPng(hex: string): Promise<Uint8Array<ArrayBuffer>> {
	if (!REPAINT_COLOR_PATTERN.test(hex)) throw new Error('Invalid swatch color');
	const rgb = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));

	const header = new Uint8Array(13);
	const headerView = new DataView(header.buffer);
	headerView.setUint32(0, SWATCH_SIZE);
	headerView.setUint32(4, SWATCH_SIZE);
	header[8] = 8;
	header[9] = PNG_COLOR_TYPE_RGB;

	const rowLength = 1 + SWATCH_SIZE * 3;
	const pixels = new Uint8Array(rowLength * SWATCH_SIZE);
	for (let row = 0; row < SWATCH_SIZE; row += 1) {
		for (let column = 0; column < SWATCH_SIZE; column += 1) {
			pixels.set(rgb, row * rowLength + 1 + column * 3);
		}
	}

	const parts = [
		new Uint8Array(PNG_SIGNATURE),
		chunk('IHDR', header),
		chunk('IDAT', await deflate(pixels)),
		chunk('IEND', new Uint8Array(0))
	];
	const png = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
	let offset = 0;
	for (const part of parts) {
		png.set(part, offset);
		offset += part.length;
	}
	return png;
}
