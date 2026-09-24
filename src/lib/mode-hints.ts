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

import type { TranslationKey } from '$lib/i18n/index.svelte';
import type { ToolId } from '$lib/state/url-state';

export type EditIntent = 'add' | 'remove' | 'replace' | 'recolor' | 'light' | 'style';

export type ModeHintField =
	| 'render'
	| 'styleTransfer'
	| 'freeform'
	| 'removeObject'
	| 'lightSettings'
	| 'objectReplacement'
	| 'textureReplacement';

export type ModeHintTarget = { mode: 'edit'; tool: ToolId } | { mode: 'styleTransfer' };

export type ModeHintFormatField = Extract<
	ModeHintField,
	'removeObject' | 'objectReplacement' | 'textureReplacement'
>;

export type ModeHint =
	| { kind: 'switch'; intent: EditIntent; target: ModeHintTarget }
	| { kind: 'format'; field: ModeHintFormatField };

interface FieldRule {
	own: ModeHintTarget | null;
	accepts: readonly EditIntent[];
	format: { field: ModeHintFormatField; intents: readonly EditIntent[] } | null;
	ignores: readonly EditIntent[];
}

const WORD_START = '(?<![\\p{L}\\p{N}])';
const WORD_END = '(?![\\p{L}\\p{N}])';

function words(...alternatives: string[]): RegExp {
	return new RegExp(`${WORD_START}(?:${alternatives.join('|')})${WORD_END}`, 'u');
}

const NEGATION = new RegExp(`${WORD_START}(?:не|don'?t|do not|never)\\s+[\\p{L}']+`, 'gu');

const ADD = words(
	'добав\\p{L}*',
	'постав\\p{L}*',
	'повес\\p{L}*',
	'повеш\\p{L}*',
	'полож\\p{L}*',
	'размест\\p{L}*',
	'встав\\p{L}*',
	'дорису\\p{L}*',
	'add\\p{L}*',
	'place',
	'put',
	'insert',
	'hang'
);

const REMOVE = words(
	'убер\\p{L}*',
	'убра\\p{L}*',
	'убир\\p{L}*',
	'удал\\p{L}*',
	'сотри',
	'стереть',
	'избав\\p{L}*',
	'remov\\p{L}*',
	'delet\\p{L}*',
	'eras\\p{L}*',
	'get rid of',
	'take (?:out|away)'
);

const REPLACE = words(
	'замен\\p{L}*',
	'поменя\\p{L}*',
	'смен\\p{L}*',
	'вместо',
	'replac\\p{L}*',
	'swap\\p{L}*',
	'instead of',
	'in place of',
	'change'
);

const RECOLOR = words(
	'перекрас\\p{L}*',
	'покрас\\p{L}*',
	'окрас\\p{L}*',
	'раскрас\\p{L}*',
	'repaint\\p{L}*',
	'recolou?r\\p{L}*',
	'paint'
);

const SURFACE_PROPERTY =
	'(?:цвет|оттен\\p{L}*|текстур\\p{L}*|материал\\p{L}*|обивк\\p{L}*|отделк\\p{L}*|покрыти\\p{L}*|фактур\\p{L}*|colou?rs?|texture\\p{L}*|materials?|finish)';

const CHANGE_SURFACE = words(
	`(?:замен|поменя|смен|измен)\\p{L}*\\s+${SURFACE_PROPERTY}`,
	`change\\s+(?:the\\s+)?${SURFACE_PROPERTY}`
);

const MAKE_SURFACE = new RegExp(
	`${words('сдела\\p{L}*', 'make').source}.*${words('цвет(?:а|ом|е|у)?', 'оттенк\\p{L}*', 'colou?r').source}`,
	'u'
);

const LIGHT = words(
	'освещ\\p{L}*',
	'свет(?:а|у|ом|е)?',
	'включи(?:ть|те)?',
	'выключи(?:ть|те)?',
	'light(?:s|ing)?(?!\\s+(?:gr[ae]y|blue|green|brown|beige|pink|yellow|wood|oak|colou?r))',
	'illuminat\\p{L}*',
	'(?:turn|switch) (?:on|off)'
);

const STYLE = words('стил(?:ь|я|е|ем|и|ю)', 'стилистик\\p{L}*', 'style\\p{L}*');

const REFERENCE = words(
	'референс\\p{L}*',
	'образ(?:ец|ц\\p{L}+)',
	'(?:как|с) на (?:фото|картинк\\p{L}*|изображени\\p{L}*|снимк\\p{L}*)',
	'с (?:фото|картинк\\p{L}*|изображени\\p{L}*|снимк\\p{L}*)',
	'reference\\p{L}*',
	'(?:like|as) (?:in|on) the (?:photo|image|picture)',
	'from the (?:photo|image|picture)'
);

const NOUN_FIELD_IGNORES: readonly EditIntent[] = ['light', 'style'];

const FIELD_RULES: Record<ModeHintField, FieldRule> = {
	render: { own: null, accepts: ['add', 'light', 'style'], format: null, ignores: [] },
	styleTransfer: {
		own: { mode: 'styleTransfer' },
		accepts: ['light', 'recolor', 'style'],
		format: null,
		ignores: []
	},
	freeform: { own: { mode: 'edit', tool: 'freeform' }, accepts: [], format: null, ignores: [] },
	removeObject: {
		own: { mode: 'edit', tool: 'remove-object' },
		accepts: [],
		format: { field: 'removeObject', intents: ['remove'] },
		ignores: NOUN_FIELD_IGNORES
	},
	lightSettings: {
		own: { mode: 'edit', tool: 'light-settings' },
		accepts: ['light'],
		format: null,
		ignores: []
	},
	objectReplacement: {
		own: { mode: 'edit', tool: 'object-replacement' },
		accepts: [],
		format: { field: 'objectReplacement', intents: ['replace'] },
		ignores: NOUN_FIELD_IGNORES
	},
	textureReplacement: {
		own: { mode: 'edit', tool: 'texture-replacement' },
		accepts: [],
		format: { field: 'textureReplacement', intents: ['replace', 'recolor'] },
		ignores: NOUN_FIELD_IGNORES
	}
};

const TOOL_LABELS: Record<ToolId, TranslationKey> = {
	freeform: 'edit.tool.freeform',
	'add-object': 'edit.tool.addObject',
	'remove-object': 'edit.tool.removeObject',
	'light-settings': 'edit.tool.lightSettings',
	'object-replacement': 'mode.objectReplacement',
	'texture-replacement': 'mode.textureReplacement'
};

function normalize(text: string): string {
	return text.toLowerCase().replaceAll('ё', 'е').replace(NEGATION, ' ');
}

function detectIntents(text: string, ignores: readonly EditIntent[]): EditIntent[] {
	const normalized = normalize(text);
	const has = (intent: EditIntent, pattern: RegExp): boolean =>
		!ignores.includes(intent) && pattern.test(normalized);
	const removes = has('remove', REMOVE);
	const adds = has('add', ADD);
	const candidates: [EditIntent, boolean][] = [
		['replace', removes && adds],
		['remove', removes],
		['light', has('light', LIGHT)],
		[
			'recolor',
			has('recolor', CHANGE_SURFACE) || has('recolor', MAKE_SURFACE) || has('recolor', RECOLOR)
		],
		['replace', has('replace', REPLACE)],
		['add', adds],
		['style', has('style', STYLE)]
	];
	return candidates.filter(([, matched]) => matched).map(([intent]) => intent);
}

function intentTarget(intent: EditIntent, withReference: boolean): ModeHintTarget {
	switch (intent) {
		case 'add':
			return { mode: 'edit', tool: 'freeform' };
		case 'remove':
			return { mode: 'edit', tool: 'remove-object' };
		case 'replace':
			return { mode: 'edit', tool: withReference ? 'object-replacement' : 'freeform' };
		case 'recolor':
			return { mode: 'edit', tool: withReference ? 'texture-replacement' : 'freeform' };
		case 'light':
			return { mode: 'edit', tool: 'light-settings' };
		case 'style':
			return { mode: 'styleTransfer' };
	}
}

function sameTarget(a: ModeHintTarget | null, b: ModeHintTarget): boolean {
	if (a === null || a.mode !== b.mode) return false;
	return a.mode === 'styleTransfer' || (b.mode === 'edit' && a.tool === b.tool);
}

export function modeHintFor(field: ModeHintField, text: string): ModeHint | null {
	const rule = FIELD_RULES[field];
	const intents = detectIntents(text, rule.ignores);
	if (intents.length === 0 || intents.some((intent) => rule.accepts.includes(intent))) return null;
	const intent = intents[0];
	if (rule.format?.intents.includes(intent)) return { kind: 'format', field: rule.format.field };
	const target = intentTarget(intent, REFERENCE.test(normalize(text)));
	if (sameTarget(rule.own, target)) return null;
	return { kind: 'switch', intent, target };
}

export function targetLabel(target: ModeHintTarget): TranslationKey {
	return target.mode === 'styleTransfer' ? 'mode.styleTransfer' : TOOL_LABELS[target.tool];
}
