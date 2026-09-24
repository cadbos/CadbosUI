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

import { describe, expect, it } from 'vitest';

import { modeHintFor, targetLabel, type ModeHint, type ModeHintField } from '$lib/mode-hints';

const freeform = { mode: 'edit', tool: 'freeform' } as const;
const removeObject = { mode: 'edit', tool: 'remove-object' } as const;
const lightSettings = { mode: 'edit', tool: 'light-settings' } as const;
const objectReplacement = { mode: 'edit', tool: 'object-replacement' } as const;
const textureReplacement = { mode: 'edit', tool: 'texture-replacement' } as const;
const styleTransfer = { mode: 'styleTransfer' } as const;

const cases: [ModeHintField, string, ModeHint | null][] = [
	['render', 'Современная гостиная, вечернее освещение', null],
	['render', 'Добавь растения и светлые стены', null],
	['render', 'Интерьер в стиле лофт', null],
	['render', 'Удали диван у окна', { kind: 'switch', intent: 'remove', target: removeObject }],
	['render', 'Замени кресло на пуф', { kind: 'switch', intent: 'replace', target: freeform }],
	['render', 'Перекрась стены в белый', { kind: 'switch', intent: 'recolor', target: freeform }],

	['styleTransfer', 'Больше тёплых оттенков, мягкий свет', null],
	[
		'styleTransfer',
		'Добавь картину над диваном',
		{ kind: 'switch', intent: 'add', target: freeform }
	],
	['styleTransfer', 'Убери ковёр', { kind: 'switch', intent: 'remove', target: removeObject }],

	['freeform', 'Замени диван на кожаное кресло', null],
	['freeform', 'Добавь торшер у дивана', null],
	['freeform', 'Сделай стены цвета слоновой кости', null],
	['freeform', 'Убери старый диван и поставь новый', null],
	['freeform', 'Убери стул у окна', { kind: 'switch', intent: 'remove', target: removeObject }],
	['freeform', 'Remove the chair', { kind: 'switch', intent: 'remove', target: removeObject }],
	[
		'freeform',
		'Добавь тёплый свет над картиной',
		{ kind: 'switch', intent: 'light', target: lightSettings }
	],
	[
		'freeform',
		'Замени диван на кресло с референса',
		{ kind: 'switch', intent: 'replace', target: objectReplacement }
	],
	[
		'freeform',
		'Перекрась обивку как на образце',
		{ kind: 'switch', intent: 'recolor', target: textureReplacement }
	],
	[
		'freeform',
		'Сделай всё в стиле сканди',
		{ kind: 'switch', intent: 'style', target: styleTransfer }
	],

	['removeObject', 'старый диван', null],
	['removeObject', 'торшер в скандинавском стиле', null],
	['removeObject', 'удали старый диван', { kind: 'format', field: 'removeObject' }],
	['removeObject', 'добавь вазу на стол', { kind: 'switch', intent: 'add', target: freeform }],
	[
		'removeObject',
		'замени стул на кресло',
		{ kind: 'switch', intent: 'replace', target: freeform }
	],

	['lightSettings', 'добавь тёплый акцентный свет над картиной', null],
	['lightSettings', 'add a warm accent light above the painting', null],
	['lightSettings', 'выключи все светильники', null],
	['lightSettings', 'убери холодный свет', null],
	['lightSettings', 'добавь растение в угол', { kind: 'switch', intent: 'add', target: freeform }],

	['objectReplacement', 'серый диван у окна', null],
	['objectReplacement', 'light gray sofa by the window', null],
	['objectReplacement', 'кресло в стиле модерн', null],
	['objectReplacement', 'добавь стол у окна', { kind: 'switch', intent: 'add', target: freeform }],
	[
		'objectReplacement',
		'add a table by the window',
		{ kind: 'switch', intent: 'add', target: freeform }
	],
	['objectReplacement', 'замени диван на кресло', { kind: 'format', field: 'objectReplacement' }],
	['objectReplacement', 'кресло вместо дивана', { kind: 'format', field: 'objectReplacement' }],
	['objectReplacement', 'убери лампу', { kind: 'switch', intent: 'remove', target: removeObject }],

	['textureReplacement', 'обивка дивана', null],
	['textureReplacement', 'светлый ламинат', null],
	[
		'textureReplacement',
		'перекрась обивку дивана',
		{ kind: 'format', field: 'textureReplacement' }
	],
	['textureReplacement', 'поменяй цвет стен', { kind: 'format', field: 'textureReplacement' }],
	['textureReplacement', 'добавь ковёр', { kind: 'switch', intent: 'add', target: freeform }],
	[
		'textureReplacement',
		'убери пятно с дивана',
		{ kind: 'switch', intent: 'remove', target: removeObject }
	]
];

describe('modeHintFor', () => {
	it.each(cases)('%s: %s', (field, text, expected) => {
		expect(modeHintFor(field, text)).toEqual(expected);
	});

	it('returns nothing for an empty field', () => {
		expect(modeHintFor('objectReplacement', '   ')).toBeNull();
	});

	it('ignores negated actions', () => {
		expect(modeHintFor('objectReplacement', 'диван, ничего не добавляй')).toBeNull();
		expect(modeHintFor('freeform', 'не убирай ковёр, перекрась стены')).toBeNull();
	});

	it('does not treat words that merely contain a stem as an action', () => {
		expect(modeHintFor('freeform', 'добавь стол, включая стулья')).toBeNull();
		expect(modeHintFor('lightSettings', 'add a painting above the sofa')).toEqual({
			kind: 'switch',
			intent: 'add',
			target: freeform
		});
	});
});

describe('targetLabel', () => {
	it('names the destination tool or mode', () => {
		expect(targetLabel(freeform)).toBe('edit.tool.freeform');
		expect(targetLabel(textureReplacement)).toBe('mode.textureReplacement');
		expect(targetLabel(styleTransfer)).toBe('mode.styleTransfer');
	});
});
