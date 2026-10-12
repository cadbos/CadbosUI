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

type Rgb = [number, number, number];
type PaletteKey = 'wall' | 'floor' | 'sofa' | 'rug' | 'wood' | 'plant' | 'art';
type ColorKey = PaletteKey | Rgb;

interface Palette {
	wall: Rgb;
	floor: Rgb;
	sofa: Rgb;
	rug: Rgb;
	wood: Rgb;
	plant: Rgb;
	art: Rgb;
}

interface Box {
	x0: number;
	x1: number;
	z0: number;
	z1: number;
	y0: number;
	h: number;
	k: ColorKey;
}

interface Item {
	d: number;
	s: number;
	parts: Box[];
	alt?: Box[];
	sel?: [number, number, number, number];
	lamp?: 1;
	plant?: 1;
}

type HoverMode = 'cre' | 'edit' | 'mig';

const PALETTES: Palette[] = [
	{
		wall: [226, 226, 229],
		floor: [204, 204, 208],
		sofa: [184, 184, 190],
		rug: [214, 214, 218],
		wood: [190, 190, 196],
		plant: [170, 172, 176],
		art: [196, 196, 202]
	},
	{
		wall: [236, 232, 226],
		floor: [214, 190, 160],
		sofa: [58, 128, 92],
		rug: [232, 226, 214],
		wood: [205, 175, 135],
		plant: [92, 148, 104],
		art: [50, 58, 66]
	},
	{
		wall: [122, 124, 134],
		floor: [86, 82, 80],
		sofa: [214, 122, 58],
		rug: [58, 58, 68],
		wood: [52, 50, 54],
		plant: [62, 124, 92],
		art: [236, 176, 64]
	}
];

const LEAVES: ReadonlyArray<readonly [number, number, number, number]> = [
	[0, 1.15, 0, 0.5],
	[-0.25, 1.7, 0.1, 0.38],
	[0.25, 1.6, -0.12, 0.36],
	[0, 2.05, 0, 0.3]
];

const LOGO_PARTS: ReadonlyArray<{
	c: 'acc' | 'dk' | 'gy';
	p: ReadonlyArray<readonly [number, number]>;
	d: readonly [number, number];
}> = [
	{
		c: 'acc',
		p: [
			[228.5, 0],
			[0, 126],
			[0, 385],
			[229.5, 511.5],
			[228, 422],
			[83, 344.5],
			[83, 166.5],
			[228.5, 88.5]
		],
		d: [-1, 0]
	},
	{
		c: 'dk',
		p: [
			[282.5, 0],
			[512, 126.5],
			[428.5, 173.5],
			[427.5, 166],
			[282.5, 89]
		],
		d: [1, -1]
	},
	{
		c: 'gy',
		p: [
			[511, 127],
			[282.5, 253],
			[283, 511.5],
			[366.5, 465.5],
			[366, 295],
			[512, 215.5]
		],
		d: [0, 1]
	},
	{
		c: 'dk',
		p: [
			[367, 293],
			[437, 256.5],
			[512, 296.5],
			[511.5, 385.5],
			[366.5, 465],
			[366.5, 378],
			[427.5, 346],
			[427, 336],
			[366, 303]
		],
		d: [1, 0.5]
	}
];

function box(
	x0: number,
	x1: number,
	z0: number,
	z1: number,
	y0: number,
	h: number,
	k: ColorKey
): Box {
	return { x0, x1, z0, z1, y0, h, k };
}

const ITEMS: Item[] = [
	{ d: 0.3, s: 8, parts: [box(2.6, 6.2, 2.4, 6.2, 0, 0.05, 'rug')] },
	{
		d: 0.7,
		s: 5.1,
		parts: [
			box(0.4, 2.1, 2, 5.6, 0, 0.8, 'sofa'),
			box(0.9, 2.1, 2, 2.4, 0.8, 0.35, 'sofa'),
			box(0.4, 0.9, 2, 5.6, 0.8, 0.95, 'sofa'),
			box(0.9, 2.1, 5.2, 5.6, 0.8, 0.35, 'sofa'),
			box(1.2, 1.9, 2.5, 3.5, 0.8, 0.18, 'art')
		]
	},
	{
		d: 1.1,
		s: 4,
		parts: [
			box(1.8, 5.2, 0.15, 0.85, 0, 2.3, 'wood'),
			box(2.2, 2.8, 0.3, 0.7, 2.3, 0.45, 'sofa'),
			box(3.4, 3.9, 0.3, 0.7, 2.3, 0.3, 'art'),
			box(4.1, 4.5, 0.3, 0.7, 2.3, 0.55, 'rug')
		]
	},
	{
		d: 1.5,
		s: 8.1,
		parts: [
			box(3.5, 4.7, 3.6, 4.4, 0, 0.4, 'wood'),
			box(3.3, 4.9, 3.4, 4.6, 0.4, 0.12, 'wood'),
			box(4.1, 4.3, 3.9, 4.1, 0.52, 0.22, 'art')
		],
		alt: [
			box(3.7, 4.5, 3.7, 4.5, 0, 0.55, 'art'),
			box(3.45, 4.75, 3.45, 4.75, 0.55, 0.1, 'wood'),
			box(4, 4.2, 3.95, 4.15, 0.65, 0.32, 'plant')
		],
		sel: [3.2, 5, 3.3, 4.7]
	},
	{
		d: 1.9,
		s: 7.6,
		lamp: 1,
		parts: [
			box(0.7, 1.1, 6.5, 6.9, 0, 0.08, 'wood'),
			box(0.85, 0.95, 6.65, 6.75, 0.08, 2.15, 'wood'),
			box(0.55, 1.25, 6.35, 7.05, 2.2, 0.55, [255, 226, 150])
		],
		alt: [
			box(0.7, 1.1, 6.5, 6.9, 0, 0.08, 'wood'),
			box(0.85, 0.95, 6.65, 6.75, 0.08, 2.4, 'wood'),
			box(0.45, 1.35, 6.25, 7.15, 2.45, 0.4, [255, 226, 150])
		],
		sel: [0.4, 1.4, 6.2, 7.2]
	},
	{ d: 2.3, s: 7.8, plant: 1, parts: [box(6.5, 7.1, 0.7, 1.3, 0, 0.7, 'art')] }
];

function isHoverMode(value: string | undefined): value is HoverMode {
	return value === 'cre' || value === 'edit' || value === 'mig';
}

function isPaletteKey(key: ColorKey): key is PaletteKey {
	return !Array.isArray(key);
}

export function startHomeLanding(canvas: HTMLCanvasElement, clouds: HTMLElement): () => void {
	const context = canvas.getContext('2d');
	if (!context) return () => {};
	const ctx = context;

	const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
	const colorScheme = matchMedia('(prefers-color-scheme: dark)');
	const hoverTarget = { cre: 0, edit: 0, mig: 0 };
	let width = 0;
	let height = 0;
	let cell = 40;
	let originX = 0;
	let originY = 0;
	let narrow = false;
	let createMix = 0;
	let editMix = 0;
	let migrateMix = 0;
	let elapsed = 0;
	let sceneTime = 0;
	const paletteIndex = 0;
	const nextPaletteIndex = 1;
	let frameId = 0;
	const sweepStart = 4.2;
	const sweepDuration = 2.4;

	const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));
	const smooth = (value: number): number => {
		const t = clamp(value);
		return t * t * (3 - 2 * t);
	};
	const easeOutBack = (value: number): number => {
		const t = clamp(value);
		const c = 1.5;
		return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
	};
	const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
	const mixColor = (a: Rgb, b: Rgb, t: number): Rgb => [
		lerp(a[0], b[0], t),
		lerp(a[1], b[1], t),
		lerp(a[2], b[2], t)
	];

	function isDark(): boolean {
		const explicit = document.documentElement.dataset.theme;
		return explicit === 'dark' || (explicit !== 'light' && colorScheme.matches);
	}

	function rgb(color: Rgb, factor: number, alpha?: number, raw?: boolean): string {
		const dim = isDark() && !raw ? 0.6 : 1;
		const channel = (value: number): number => clamp(value * factor * dim, 0, 255) | 0;
		return `rgba(${channel(color[0])},${channel(color[1])},${channel(color[2])},${alpha ?? 1})`;
	}

	function project(x: number, y: number, z: number): [number, number] {
		const bob = reduced ? 0 : Math.sin(elapsed * 0.8) * 5;
		return [originX + (x - z) * 0.866 * cell, originY + (x + z) * 0.5 * cell - y * cell + bob];
	}

	function quad(
		points: ReadonlyArray<readonly [number, number, number]>,
		fill: string | null,
		stroke?: string,
		lineWidth?: number
	): void {
		ctx.beginPath();
		points.forEach((point, index) => {
			const projected = project(point[0], point[1], point[2]);
			if (index === 0) ctx.moveTo(projected[0], projected[1]);
			else ctx.lineTo(projected[0], projected[1]);
		});
		ctx.closePath();
		if (fill) {
			ctx.fillStyle = fill;
			ctx.fill();
		}
		if (stroke) {
			ctx.strokeStyle = stroke;
			ctx.lineWidth = lineWidth ?? 1;
			ctx.stroke();
		}
	}

	function sweepPosition(): number | null {
		const progress = (sceneTime - sweepStart) / sweepDuration;
		return progress < 0 || progress > 1.2 ? null : progress * 1.6 - 0.3;
	}

	function revealAt(u: number): number {
		const position = sweepPosition();
		if (position === null) return sceneTime < sweepStart ? 0 : 1;
		return smooth((position - u) / 0.3);
	}

	function colorAt(key: ColorKey, u: number): Rgb {
		if (!isPaletteKey(key)) return key;
		const mixed = mixColor(
			PALETTES[paletteIndex][key],
			PALETTES[nextPaletteIndex][key],
			revealAt(u)
		);
		return migrateMix > 0.001
			? mixColor(mixed, PALETTES[2][key], smooth(migrateMix * 1.7 - u * 0.7))
			: mixed;
	}

	function drawBox(part: Box, u: number, scale: number, alpha: number, lift: number): void {
		const color = colorAt(part.k, u);
		const raw = !isPaletteKey(part.k);
		const y0 = part.y0 * scale + lift;
		const y1 = y0 + part.h * scale;
		quad(
			[
				[part.x0, y1, part.z0],
				[part.x1, y1, part.z0],
				[part.x1, y1, part.z1],
				[part.x0, y1, part.z1]
			],
			rgb(color, 1.04, alpha, raw)
		);
		quad(
			[
				[part.x1, y0, part.z0],
				[part.x1, y0, part.z1],
				[part.x1, y1, part.z1],
				[part.x1, y1, part.z0]
			],
			rgb(color, 0.68, alpha, raw)
		);
		quad(
			[
				[part.x0, y0, part.z1],
				[part.x1, y0, part.z1],
				[part.x1, y1, part.z1],
				[part.x0, y1, part.z1]
			],
			rgb(color, 0.84, alpha, raw)
		);
	}

	function resize(): void {
		const dpr = Math.min(devicePixelRatio || 1, 2);
		width = canvas.clientWidth;
		height = canvas.clientHeight;
		canvas.width = width * dpr;
		canvas.height = height * dpr;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		narrow = width < 820;
		const roomScale = 1.2;
		cell =
			(narrow
				? Math.min((width * 0.9) / 14, (height * 0.34) / 12.5)
				: Math.min((width * 0.9) / 14, (height * 0.66) / 12.5)) * roomScale;
		originX = width / 2;
		originY = (narrow ? height * 0.27 : height * 0.46) - 2 * cell;
		if (reduced) draw(11);
	}

	function floorTiles(): void {
		for (let i = 0; i < 8; i += 1) {
			for (let j = 0; j < 8; j += 1) {
				const alpha = smooth((sceneTime - (i + j) * 0.05) / 0.7);
				if (alpha <= 0) continue;
				const color = colorAt('floor', (i + j + 1) / 16);
				const shade =
					((i + j) % 2 ? 0.96 : 1.02) +
					createMix * 0.16 * Math.max(0, Math.sin((i + j) * 0.7 - elapsed * 5));
				quad(
					[
						[i, 0, j],
						[i + 1, 0, j],
						[i + 1, 0, j + 1],
						[i, 0, j + 1]
					],
					rgb(color, shade, alpha),
					rgb([0, 0, 0], 1, 0.05 * alpha, true),
					0.6
				);
			}
		}
	}

	function walls(): void {
		for (let i = 0; i < 8; i += 1) {
			const scale = easeOutBack((sceneTime - 0.2 - i * 0.05) / 0.8);
			const alpha = clamp((sceneTime - 0.2 - i * 0.05) / 0.4);
			if (alpha <= 0) continue;
			const wallHeight = 4 * scale;
			quad(
				[
					[i, 0, 0],
					[i + 1, 0, 0],
					[i + 1, wallHeight, 0],
					[i, wallHeight, 0]
				],
				rgb(colorAt('wall', (i + 0.5) / 16), 0.94, alpha)
			);
			quad(
				[
					[0, 0, i],
					[0, 0, i + 1],
					[0, wallHeight, i + 1],
					[0, wallHeight, i]
				],
				rgb(colorAt('wall', (i + 0.5) / 16), 0.8, alpha)
			);
		}
		const windowScale = easeOutBack((sceneTime - 0.8) / 0.8);
		const windowAlpha = clamp((sceneTime - 0.8) / 0.5);
		if (windowAlpha > 0 && windowScale > 0) {
			const y0 = 1.2;
			const y1 = 3.2;
			const x0 = 5.2;
			const x1 = 7.4;
			quad(
				[
					[x0, y0, 0],
					[x1, y0, 0],
					[x1, y1, 0],
					[x0, y1, 0]
				],
				isDark() ? `rgba(110,150,200,${windowAlpha})` : `rgba(190,225,250,${windowAlpha})`
			);
			quad(
				[
					[x0, y0, 0],
					[x1, y0, 0],
					[x1, y1, 0],
					[x0, y1, 0]
				],
				null,
				rgb([255, 255, 255], 1, 0.8 * windowAlpha, true),
				2.5
			);
			const mid = (x0 + x1) / 2;
			ctx.strokeStyle = rgb([255, 255, 255], 1, 0.8 * windowAlpha, true);
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			let point = project(mid, y0, 0);
			ctx.moveTo(point[0], point[1]);
			point = project(mid, y1, 0);
			ctx.lineTo(point[0], point[1]);
			point = project(x0, 2.2, 0);
			ctx.moveTo(point[0], point[1]);
			point = project(x1, 2.2, 0);
			ctx.lineTo(point[0], point[1]);
			ctx.stroke();
		}
		const artAlpha = clamp((sceneTime - 2.6) / 0.6);
		if (artAlpha > 0) {
			quad(
				[
					[0, 1.9, 2.6],
					[0, 1.9, 5],
					[0, 3.2, 5],
					[0, 3.2, 2.6]
				],
				rgb(colorAt('art', 0.2), 1, artAlpha)
			);
		}
	}

	function sun(): void {
		const alpha = clamp((sceneTime - 2) / 1.2);
		if (alpha <= 0) return;
		const strength = (0.04 + 0.12 * revealAt(0.55)) * (1 + 0.25 * Math.sin(sceneTime * 1.3));
		quad(
			[
				[5.4, 0, 0.3],
				[7.6, 0, 0.3],
				[8, 0, 3.6],
				[6.2, 0, 3.6]
			],
			`rgba(255,238,190,${(isDark() ? strength * 0.8 : strength) * alpha})`
		);
	}

	function motes(): void {
		if (sceneTime < 2.4) return;
		for (let i = 0; i < 22; i += 1) {
			const seed = i * 0.6180339;
			const drift = (seed * 7.3) % 1;
			const life = (sceneTime * 0.05 + seed) % 1;
			const point = project(
				5.5 + drift * 2 + life * 0.9,
				2.2 * (1 - life) + 0.1 + Math.sin(sceneTime + i) * 0.08,
				0.3 + life * 3.3
			);
			ctx.fillStyle = `rgba(255,246,220,${(0.75 * Math.sin(Math.PI * life)).toFixed(3)})`;
			ctx.beginPath();
			ctx.arc(point[0], point[1], 1.2 + (i % 3) * 0.5, 0, 7);
			ctx.fill();
		}
	}

	function leafCircles(item: Item, u: number, scale: number, alpha: number, lift: number): void {
		const color = colorAt('plant', u);
		LEAVES.forEach((leaf, index) => {
			const leafScale = easeOutBack((sceneTime - item.d - 0.25 - index * 0.12) / 0.7);
			if (leafScale <= 0) return;
			const point = project(6.8 + leaf[0], leaf[1] * scale + lift, 1 + leaf[2]);
			const radius = leaf[3] * cell * 1.1 * leafScale;
			const gradient = ctx.createRadialGradient(
				point[0] - radius * 0.3,
				point[1] - radius * 0.4,
				radius * 0.1,
				point[0],
				point[1],
				radius
			);
			gradient.addColorStop(0, rgb(color, 1.25, alpha));
			gradient.addColorStop(1, rgb(color, 0.78, alpha));
			ctx.fillStyle = gradient;
			ctx.beginPath();
			ctx.arc(point[0], point[1], radius, 0, 7);
			ctx.fill();
		});
	}

	function scan(): void {
		const position = sweepPosition();
		if (position === null || position < 0 || position > 1) return;
		const cursor = position * 16;
		const start = Math.max(0, cursor - 8);
		const end = Math.min(8, cursor);
		if (start >= end) return;
		const accent: Rgb = isDark() ? [72, 163, 116] : [47, 111, 79];
		const from: [number, number, number] = [start, 0, cursor - start];
		const to: [number, number, number] = [end, 0, cursor - end];
		quad(
			[from, to, [to[0], 4, to[2]], [from[0], 4, from[2]]],
			`rgba(${accent[0]},${accent[1]},${accent[2]},.13)`
		);
		ctx.save();
		ctx.shadowColor = `rgba(${accent[0]},${accent[1]},${accent[2]},.9)`;
		ctx.shadowBlur = 18;
		ctx.strokeStyle = `rgba(${accent[0]},${accent[1]},${accent[2]},.95)`;
		ctx.lineWidth = 2;
		ctx.lineCap = 'round';
		const floorStart = project(from[0], 0, from[2]);
		const floorEnd = project(to[0], 0, to[2]);
		const topStart = project(from[0], 4, from[2]);
		const topEnd = project(to[0], 4, to[2]);
		ctx.beginPath();
		ctx.moveTo(floorStart[0], floorStart[1]);
		ctx.lineTo(floorEnd[0], floorEnd[1]);
		ctx.stroke();
		ctx.lineWidth = 1;
		ctx.globalAlpha = 0.5;
		ctx.beginPath();
		ctx.moveTo(topStart[0], topStart[1]);
		ctx.lineTo(topEnd[0], topEnd[1]);
		ctx.stroke();
		ctx.restore();
	}

	function sparks(): void {
		if (createMix < 0.02) return;
		const accent: Rgb = isDark() ? [72, 163, 116] : [47, 111, 79];
		for (let i = 0; i < 16; i += 1) {
			const seed = i * 0.618;
			const life = (elapsed * 0.45 + seed) % 1;
			const point = project(
				1 + ((seed * 5.3) % 1) * 6.5,
				0.3 + life * 3.2,
				1 + ((seed * 3.7) % 1) * 6.5
			);
			const radius = (2 + (i % 3) * 1.6) * Math.sin(Math.PI * life) * createMix * (cell / 40);
			ctx.fillStyle = `rgba(${accent[0]},${accent[1]},${accent[2]},${(0.9 * createMix).toFixed(2)})`;
			ctx.beginPath();
			ctx.moveTo(point[0], point[1] - radius * 2);
			ctx.quadraticCurveTo(point[0], point[1], point[0] + radius * 2, point[1]);
			ctx.quadraticCurveTo(point[0], point[1], point[0], point[1] + radius * 2);
			ctx.quadraticCurveTo(point[0], point[1], point[0] - radius * 2, point[1]);
			ctx.quadraticCurveTo(point[0], point[1], point[0], point[1] - radius * 2);
			ctx.fill();
		}
	}

	function shade(item: Item, scale: number, alpha: number): void {
		if (alpha <= 0.01) return;
		const fill = `rgba(20,18,30,${(0.2 * alpha).toFixed(3)})`;
		for (const part of item.parts) {
			if (part.h < 0.1) continue;
			const offset = Math.min(1.1, (part.y0 + part.h) * 0.32) * scale;
			quad(
				[
					[part.x0, 0, part.z0],
					[part.x1, 0, part.z0],
					[part.x1 + offset, 0, part.z0 + offset],
					[part.x1 + offset, 0, part.z1 + offset],
					[part.x0 + offset, 0, part.z1 + offset],
					[part.x0, 0, part.z1]
				],
				fill
			);
		}
	}

	function lampGlow(alpha: number): void {
		const point = project(0.9, 2.5, 6.7);
		const radius = cell * 2.2;
		const gradient = ctx.createRadialGradient(point[0], point[1], 0, point[0], point[1], radius);
		const strength =
			(0.32 + 0.06 * Math.sin(sceneTime * 2)) *
			alpha *
			(isDark() ? 1.5 : 1) *
			(0.25 + 0.75 * revealAt(0.47));
		gradient.addColorStop(0, `rgba(255,214,140,${strength})`);
		gradient.addColorStop(1, 'rgba(255,214,140,0)');
		ctx.fillStyle = gradient;
		ctx.beginPath();
		ctx.arc(point[0], point[1], radius, 0, 7);
		ctx.fill();
	}

	function logo(time: number): void {
		if (time > 4.4) return;
		const size = Math.min(width, height) * 0.3;
		const scale = size / 512;
		const centerX = width / 2;
		const centerY = originY + 2 * cell;
		const exit = smooth((time - 3) / 1.2);
		const breathe = 1 + 0.02 * Math.sin(time * 3) * smooth(time - 2) + exit * 0.25;
		const colors: Record<'acc' | 'dk' | 'gy', Rgb> = {
			acc: [47, 111, 79],
			dk: [49, 58, 65],
			gy: [156, 158, 157]
		};
		LOGO_PARTS.forEach((part, index) => {
			const grow = easeOutBack((time - 0.1 - index * 0.18) / 0.9);
			const alpha = clamp((time - index * 0.18) / 0.4) * (1 - exit);
			if (alpha <= 0) return;
			const offset = (1 - grow) * size * 0.9;
			const dx = part.d[0] * (offset + exit * size * 0.5);
			const dy = part.d[1] * (offset + exit * size * 0.5);
			ctx.beginPath();
			part.p.forEach((point, pointIndex) => {
				const x = centerX + (point[0] - 256) * breathe * scale + dx;
				const y = centerY + (point[1] - 256) * breathe * scale + dy;
				if (pointIndex === 0) ctx.moveTo(x, y);
				else ctx.lineTo(x, y);
			});
			ctx.closePath();
			ctx.fillStyle = rgb(colors[part.c], 1, alpha, true);
			ctx.fill();
		});
	}

	function draw(time: number): void {
		elapsed = time;
		sceneTime = time - 3.2;
		createMix += (hoverTarget.cre - createMix) * 0.08;
		editMix += (hoverTarget.edit - editMix) * 0.08;
		migrateMix += (hoverTarget.mig - migrateMix) * 0.045;
		ctx.clearRect(0, 0, width, height);
		ctx.globalAlpha = 1;
		const sweep = sweepPosition();
		floorTiles();
		walls();
		sun();
		const list = ITEMS.slice().sort((a, b) => a.s - b.s);
		for (const item of list) {
			const u = item.s / 16;
			const alpha = clamp((sceneTime - item.d) / 0.5);
			const scale = easeOutBack((sceneTime - item.d) / 0.9);
			if (alpha <= 0) continue;
			const revealed = revealAt(u);
			const editing = item.alt ? editMix : 0;
			const wave = 0.5 + 0.5 * Math.sin(elapsed * 3.2);
			const shown = revealed * (1 - editing * wave);
			const lift =
				Math.sin(revealed * Math.PI) * 0.25 * (sweep === null ? 0 : 1) + editing * 0.16 * wave;
			shade(item, scale, alpha * shown);
			if (item.sel && editing > 0.03) {
				const selection = item.sel;
				const accent: Rgb = isDark() ? [72, 163, 116] : [47, 111, 79];
				ctx.save();
				ctx.setLineDash([6, 5]);
				ctx.lineDashOffset = -elapsed * 24;
				quad(
					[
						[selection[0], 0, selection[2]],
						[selection[1], 0, selection[2]],
						[selection[1], 0, selection[3]],
						[selection[0], 0, selection[3]]
					],
					rgb(accent, 1, 0.1 * editing, true),
					rgb(accent, 1, editing, true),
					1.8
				);
				ctx.restore();
			}
			if (item.alt) {
				for (const part of item.parts) drawBox(part, u, scale, alpha * (1 - shown), lift);
				for (const part of item.alt) drawBox(part, u, scale, alpha * shown, lift);
			} else {
				for (const part of item.parts) drawBox(part, u, scale, alpha, lift);
			}
			if (item.lamp) lampGlow(alpha);
			if (item.plant) leafCircles(item, u, scale, alpha, lift);
		}
		motes();
		scan();
		sparks();
		logo(elapsed);
		ctx.globalAlpha = 1;
	}

	const resizeObserver = new ResizeObserver(() => resize());
	resizeObserver.observe(canvas);
	const cleanups: Array<() => void> = [() => resizeObserver.disconnect()];

	for (const element of clouds.querySelectorAll<HTMLElement>('.cloud')) {
		const mode = element.dataset.m;
		if (!isHoverMode(mode)) continue;
		const on = (): void => {
			hoverTarget[mode] = 1;
			if (reduced) draw(11);
		};
		const off = (): void => {
			hoverTarget[mode] = 0;
			if (reduced) draw(11);
		};
		element.addEventListener('pointerenter', on);
		element.addEventListener('pointerleave', off);
		element.addEventListener('focus', on);
		element.addEventListener('blur', off);
		cleanups.push(() => {
			element.removeEventListener('pointerenter', on);
			element.removeEventListener('pointerleave', off);
			element.removeEventListener('focus', on);
			element.removeEventListener('blur', off);
		});
	}

	const redrawIfReduced = (): void => {
		if (reduced) draw(11);
	};
	const themeObserver = new MutationObserver(redrawIfReduced);
	themeObserver.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ['data-theme']
	});
	colorScheme.addEventListener('change', redrawIfReduced);
	cleanups.push(() => {
		themeObserver.disconnect();
		colorScheme.removeEventListener('change', redrawIfReduced);
	});

	resize();
	if (!reduced) {
		const started = performance.now();
		const loop = (now: number): void => {
			draw((now - started) / 1000);
			frameId = requestAnimationFrame(loop);
		};
		frameId = requestAnimationFrame(loop);
		cleanups.push(() => cancelAnimationFrame(frameId));
	}

	return () => {
		for (const cleanup of cleanups) cleanup();
	};
}
