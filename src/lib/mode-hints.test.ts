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

import { ADD_OBJECT_PRESETS } from '$lib/add-object-presets';
import { en } from '$lib/i18n/locales/en';
import { ru } from '$lib/i18n/locales/ru';
import { LIGHT_SETTINGS_PRESETS } from '$lib/light-settings-presets';
import { INTENT_CORPUS } from '$lib/mode-hints-corpus';
import {
	detectIntents,
	modeHintFor,
	targetLabel,
	type ModeHint,
	type ModeHintField
} from '$lib/mode-hints';

const freeform = { mode: 'edit', tool: 'freeform' } as const;
const removeObject = { mode: 'edit', tool: 'remove-object' } as const;
const lightSettings = { mode: 'edit', tool: 'light-settings' } as const;
const objectReplacement = { mode: 'edit', tool: 'object-replacement' } as const;
const textureReplacement = { mode: 'edit', tool: 'texture-replacement' } as const;
const styleTransfer = { mode: 'styleTransfer' } as const;
const addObject = { mode: 'edit', tool: 'add-object' } as const;

const cases: [ModeHintField, string, ModeHint | null][] = [
	['render', 'Современная гостиная, вечернее освещение', null],
	['render', 'Добавь растения и светлые стены', null],
	['render', 'Интерьер в стиле лофт', null],
	[
		'render',
		'Удали диван у окна',
		{ kind: 'switch', intent: 'remove', target: removeObject, triggers: ['Удали'] }
	],
	[
		'render',
		'Замени кресло на пуф',
		{ kind: 'switch', intent: 'replace', target: freeform, triggers: ['Замени'] }
	],
	[
		'render',
		'Сделай диван белым',
		{ kind: 'switch', intent: 'recolor', target: freeform, triggers: ['Сделай', 'белым'] }
	],
	[
		'render',
		'Перекрась стены в белый',
		{ kind: 'switch', intent: 'recolor', target: freeform, triggers: ['Перекрась'] }
	],

	['styleTransfer', 'Больше тёплых оттенков, мягкий свет', null],
	[
		'styleTransfer',
		'Добавь картину над диваном',
		{
			kind: 'switch',
			intent: 'add',
			target: { ...addObject, presetId: 'wall-art' },
			triggers: ['Добавь']
		}
	],
	[
		'styleTransfer',
		'Добавь пуф у дивана',
		{ kind: 'switch', intent: 'add', target: freeform, triggers: ['Добавь'] }
	],
	[
		'styleTransfer',
		'Убери старый диван и поставь новый',
		{ kind: 'switch', intent: 'replace', target: freeform, triggers: ['Убери', 'поставь'] }
	],
	[
		'styleTransfer',
		'Убери ковёр',
		{ kind: 'switch', intent: 'remove', target: removeObject, triggers: ['Убери'] }
	],

	['freeform', 'Замени диван на кожаное кресло', null],
	['freeform', 'Добавь торшер у дивана', null],
	['freeform', 'Сделай стены цвета слоновой кости', null],
	['freeform', 'Убери старый диван и поставь новый', null],
	[
		'freeform',
		'Убери стул у окна',
		{ kind: 'switch', intent: 'remove', target: removeObject, triggers: ['Убери'] }
	],
	[
		'freeform',
		'Remove the chair',
		{ kind: 'switch', intent: 'remove', target: removeObject, triggers: ['Remove'] }
	],
	[
		'freeform',
		'Добавь тёплый свет над картиной',
		{ kind: 'switch', intent: 'light', target: lightSettings, triggers: ['свет'] }
	],
	[
		'freeform',
		'Замени диван на кресло с референса',
		{ kind: 'switch', intent: 'replace', target: objectReplacement, triggers: ['Замени'] }
	],
	[
		'freeform',
		'Перекрась обивку как на образце',
		{ kind: 'switch', intent: 'recolor', target: textureReplacement, triggers: ['Перекрась'] }
	],
	[
		'freeform',
		'Сделай всё в стиле сканди',
		{ kind: 'switch', intent: 'style', target: styleTransfer, triggers: ['стиле'] }
	],

	['removeObject', 'старый диван', null],
	['removeObject', 'торшер в скандинавском стиле', null],
	[
		'removeObject',
		'удали старый диван',
		{ kind: 'format', field: 'removeObject', triggers: ['удали'] }
	],
	[
		'removeObject',
		'добавь вазу на стол',
		{ kind: 'switch', intent: 'add', target: freeform, triggers: ['добавь'] }
	],
	[
		'removeObject',
		'замени стул на кресло',
		{ kind: 'switch', intent: 'replace', target: freeform, triggers: ['замени'] }
	],

	['lightSettings', 'добавь тёплый акцентный свет над картиной', null],
	['lightSettings', 'add a warm accent light above the painting', null],
	['lightSettings', 'выключи все светильники', null],
	['lightSettings', 'убери холодный свет', null],
	[
		'lightSettings',
		'добавь растение в угол',
		{
			kind: 'switch',
			intent: 'add',
			target: { ...addObject, presetId: 'houseplant' },
			triggers: ['добавь']
		}
	],
	[
		'lightSettings',
		'добавь пуф в угол',
		{ kind: 'switch', intent: 'add', target: freeform, triggers: ['добавь'] }
	],

	['objectReplacement', 'серый диван у окна', null],
	['objectReplacement', 'light gray sofa by the window', null],
	['objectReplacement', 'кресло в стиле модерн', null],
	[
		'objectReplacement',
		'добавь стол у окна',
		{ kind: 'switch', intent: 'add', target: freeform, triggers: ['добавь'] }
	],
	[
		'objectReplacement',
		'add a table by the window',
		{ kind: 'switch', intent: 'add', target: freeform, triggers: ['add'] }
	],
	[
		'objectReplacement',
		'замени диван на кресло',
		{ kind: 'format', field: 'objectReplacement', triggers: ['замени'] }
	],
	[
		'objectReplacement',
		'кресло вместо дивана',
		{ kind: 'format', field: 'objectReplacement', triggers: ['вместо'] }
	],
	[
		'objectReplacement',
		'убери лампу',
		{ kind: 'switch', intent: 'remove', target: removeObject, triggers: ['убери'] }
	],

	['textureReplacement', 'обивка дивана', null],
	['textureReplacement', 'светлый ламинат', null],
	[
		'textureReplacement',
		'перекрась обивку дивана',
		{ kind: 'format', field: 'textureReplacement', triggers: ['перекрась'] }
	],
	[
		'textureReplacement',
		'поменяй цвет стен',
		{ kind: 'format', field: 'textureReplacement', triggers: ['поменяй цвет'] }
	],
	[
		'textureReplacement',
		'добавь ковёр',
		{ kind: 'switch', intent: 'add', target: freeform, triggers: ['добавь'] }
	],
	[
		'textureReplacement',
		'убери пятно с дивана',
		{ kind: 'switch', intent: 'remove', target: removeObject, triggers: ['убери'] }
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
		expect(modeHintFor('render', 'Не убирай ковёр, но УДАЛИ стул')).toEqual({
			kind: 'switch',
			intent: 'remove',
			target: removeObject,
			triggers: ['УДАЛИ']
		});
	});

	it('does not treat words that merely contain a stem as an action', () => {
		expect(modeHintFor('freeform', 'добавь стол, включая стулья')).toBeNull();
		expect(modeHintFor('lightSettings', 'add a bench above the painting')).toEqual({
			kind: 'switch',
			intent: 'add',
			target: freeform,
			triggers: ['add']
		});
	});
});

describe('intent corpus', () => {
	it.each(INTENT_CORPUS)('%s → %s', (text, expected) => {
		expect(detectIntents(text)[0] ?? null).toBe(expected);
	});
});

describe('product phrases', () => {
	it.each(LIGHT_SETTINGS_PRESETS.flatMap((preset) => [ru[preset.phrase], en[preset.phrase]]))(
		'light preset phrase is a lighting request: %s',
		(phrase) => {
			expect(detectIntents(phrase)).toContain('light');
			expect(modeHintFor('lightSettings', phrase)).toBeNull();
		}
	);

	it.each(
		ADD_OBJECT_PRESETS.flatMap((preset) => [
			[preset.id, `добавь ${ru[preset.label].toLowerCase()}`],
			[preset.id, `add ${en[preset.label].toLowerCase()}`]
		])
	)('add-object preset %s is suggested for "%s"', (presetId, text) => {
		expect(modeHintFor('freeform', text)).toEqual({
			kind: 'switch',
			intent: 'add',
			target: { ...addObject, presetId },
			triggers: [text.split(' ')[0]]
		});
	});
});

describe('targetLabel', () => {
	it('names the destination tool or mode', () => {
		expect(targetLabel(freeform)).toBe('edit.tool.freeform');
		expect(targetLabel(textureReplacement)).toBe('mode.textureReplacement');
		expect(targetLabel(styleTransfer)).toBe('mode.styleTransfer');
		expect(targetLabel({ ...addObject, presetId: 'mirror' })).toBe('edit.tool.addObject');
	});
});
