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

import { ADD_OBJECT_PRESETS } from '$lib/add-object-presets';
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

export type ModeHintTarget =
	| { mode: 'edit'; tool: Exclude<ToolId, 'add-object'> }
	| { mode: 'edit'; tool: 'add-object'; presetId: string }
	| { mode: 'styleTransfer' };

export type ModeHintFormatField = Extract<
	ModeHintField,
	'removeObject' | 'objectReplacement' | 'textureReplacement'
>;

export type ModeHint =
	| { kind: 'switch'; intent: EditIntent; target: ModeHintTarget; triggers: string[] }
	| { kind: 'format'; field: ModeHintFormatField; triggers: string[] };

interface IntentMatch {
	intent: EditIntent;
	triggers: RegExpExecArray[];
}

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

const NEGATION = new RegExp(
	`${WORD_START}(?:не|don'?t|do not|never|no need to)\\s+` +
		`(?:(?:нужно|надо|стоит|хочу|need to|want to)\\s+)?` +
		`(?:(?:ничего|никаких|anything)\\s+)?` +
		`(?!(?:было|будет|стало)${WORD_END})[\\p{L}']+`,
	'gu'
);

const ADD = words(
	'добав\\p{L}*',
	'постав\\p{L}*',
	'повес\\p{L}*',
	'повеш\\p{L}*',
	'подвес\\p{L}*',
	'полож\\p{L}*',
	'размест\\p{L}*',
	'встав\\p{L}*',
	'дорису\\p{L}*',
	'появ\\p{L}*',
	'нуж(?:ен|на|ны)',
	'пусть (?:будет|будут|стоит|стоят|висит|висят)',
	'чтобы (?:здесь |тут |там )?(?:был|была|было|были|стоял\\p{L}*|висел\\p{L}*)',
	'add\\p{L}*',
	'place',
	'put',
	'insert',
	'hang',
	'mount'
);

const REMOVE = words(
	'убер\\p{L}*',
	'убра\\p{L}*',
	'убир\\p{L}*',
	'удал\\p{L}*',
	'сотри',
	'стереть',
	'избав\\p{L}*',
	'вынес\\p{L}*',
	'вынеси',
	'выкин\\p{L}*',
	'выброс\\p{L}*',
	'спрячь',
	'спрятать',
	'очист\\p{L}*',
	'не (?:было|будет|стало)',
	'remov\\p{L}*',
	'delet\\p{L}*',
	'eras\\p{L}*',
	'get rid of',
	'take (?:out|away)',
	'declutter\\p{L}*',
	'clear (?:out|away)'
);

const REPLACE = words(
	'замен\\p{L}*',
	'поменя\\p{L}*',
	'смен\\p{L}*',
	'вместо',
	'на место',
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
	'перетян\\p{L}*',
	'repaint\\p{L}*',
	'recolou?r\\p{L}*',
	'reupholster\\p{L}*',
	'paint'
);

const SURFACE_PROPERTY =
	'(?:цвет|оттен\\p{L}*|текстур\\p{L}*|материал\\p{L}*|обивк\\p{L}*|отделк\\p{L}*|покрыти\\p{L}*|фактур\\p{L}*|colou?rs?|texture\\p{L}*|materials?|finish)';

const CHANGE_SURFACE = words(
	`(?:замен|поменя|смен|измен)\\p{L}*\\s+${SURFACE_PROPERTY}`,
	`change\\s+(?:the\\s+)?${SURFACE_PROPERTY}`
);

const MAKE = words('сдела\\p{L}*', 'make', 'turn');

const SURFACE_LOOK = words(
	'цвет(?:а|ом|е|у)?',
	'оттенк\\p{L}*',
	'(?:бел|черн|сер|син|голуб|зелен|красн|желт|оранжев|розов|фиолетов|бежев|коричнев|бирюзов|терракотов|графитов|молочн)(?:ый|ая|ое|ые|ым|ой|ую|ыми|ого)',
	'(?:деревянн|мраморн|бетонн|кирпичн|кожан|бархатн|льнян|каменн|металлическ|глянцев|матов)\\p{L}*',
	'под (?:дерев\\p{L}*|мрамор\\p{L}*|бетон\\p{L}*|кам\\p{L}*|кирпич\\p{L}*)',
	'colou?r',
	'white|black|gr[ae]y|blue|green|red|yellow|orange|pink|purple|beige|brown|teal|navy',
	'wooden|marble|concrete|brick|leather|velvet|linen|stone|metallic|glossy|matte'
);

const LIGHT = words(
	'освещ\\p{L}*',
	'подсвет\\p{L}*',
	'свет(?:а|у|ом|е)?',
	'включи(?:ть|те)?',
	'выключи(?:ть|те)?',
	'зажги(?:те)?',
	'зажечь',
	'погас\\p{L}*',
	'приглуш\\p{L}*',
	'закат\\p{L}*',
	'рассвет\\p{L}*',
	'сумер\\p{L}*',
	'полд(?:ень|ня|нем)',
	'пасмурн\\p{L}*',
	'ночн(?:ой|ая|ое|ые|ого|ую|ым|ом)',
	'вечерн(?:ий|яя|ее|ие|его|юю|им|ем)',
	'утренн(?:ий|яя|ее|ие|его|юю|им|ем)',
	'light(?:s|ing)?(?!\\s+(?:gr[ae]y|blue|green|brown|beige|pink|yellow|wood|oak|colou?r))',
	'illuminat\\p{L}*',
	'(?:turn|switch) (?:on|off)',
	'dim(?:med|mer)?',
	'brighten\\p{L}*',
	'sunset|sunrise|dusk|twilight|daylight|overcast|candlelight',
	'night(?:time)?',
	'evening|morning'
);

const BRIGHTNESS = words('светлее', 'темнее', 'ярче', 'мрачнее', 'brighter', 'darker');

const SCENE = words(
	'комнат\\p{L}*',
	'помещени\\p{L}*',
	'сцен\\p{L}*',
	'интерьер\\p{L}*',
	'room',
	'scene',
	'space',
	'interior',
	'гостин\\p{L}*',
	'спальн\\p{L}*',
	'кухн\\p{L}*',
	'ванн(?:ая|ой|ую|ые)',
	'детск(?:ая|ой|ую)',
	'кабинет\\p{L}*',
	'офис\\p{L}*',
	'living room',
	'bedroom',
	'kitchen',
	'bathroom',
	'office'
);

const STYLE = words(
	'стил(?:ь|я|е|ем|и|ю)',
	'стилистик\\p{L}*',
	'лофт\\p{L}*',
	'сканди\\p{L}*',
	'минимализм\\p{L}*',
	'прованс\\p{L}*',
	'хай-?тек\\p{L}*',
	'бохо',
	'джапанди',
	'неокласси\\p{L}*',
	'ар-?деко',
	'индустриальн\\p{L}*',
	'средиземноморск\\p{L}*',
	'марокканск\\p{L}*',
	'шале',
	'style\\p{L}*',
	'loft',
	'scandi(?:navian)?',
	'minimalis\\p{L}*',
	'provence',
	'hi-?tech|high-?tech',
	'boho',
	'japandi',
	'neoclassic\\p{L}*',
	'art deco',
	'mid-century',
	'industrial',
	'mediterranean'
);

const REFERENCE = words(
	'референс\\p{L}*',
	'образ(?:ец|ц\\p{L}+)',
	'(?:как|с) на (?:фото|картинк\\p{L}*|изображени\\p{L}*|снимк\\p{L}*)',
	'с (?:фото|картинк\\p{L}*|изображени\\p{L}*|снимк\\p{L}*)',
	'reference\\p{L}*',
	'(?:like|as) (?:in|on) the (?:photo|image|picture)',
	'from the (?:photo|image|picture)'
);

const ADDED_OBJECT_WORDS = 4;

const PLACEMENT = new RegExp(
	`[.,;!?\\n]|${WORD_START}(?:над|под|у|на|возле|рядом|около|за|между|перед|вдоль|above|over|on|near|by|next|under|behind|beside|along)${WORD_END}`,
	'u'
);

const ADD_OBJECT_PRESET_PATTERNS = ADD_OBJECT_PRESETS.map((preset) => ({
	id: preset.id,
	patterns: preset.keywords.map((keyword) => words(keyword))
}));

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

function lowerCaseKeepingLength(text: string): string {
	return text.replace(/[\s\S]/g, (char) => {
		const lower = char.toLowerCase();
		return lower.length === 1 ? lower : char;
	});
}

function normalize(text: string): string {
	return lowerCaseKeepingLength(text)
		.replaceAll('ё', 'е')
		.replace(NEGATION, (negated) => ' '.repeat(negated.length));
}

function matchAddObjectPreset(normalized: string): string | null {
	const verb = ADD.exec(normalized);
	if (verb === null) return null;
	const added = normalized
		.slice(verb.index + verb[0].length)
		.split(PLACEMENT)[0]
		.split(/\s+/u)
		.filter(Boolean)
		.slice(0, ADDED_OBJECT_WORDS)
		.join(' ');
	let best: { id: string; score: number } | null = null;
	for (const preset of ADD_OBJECT_PRESET_PATTERNS) {
		const score = preset.patterns.filter((pattern) => pattern.test(added)).length;
		if (score > 0 && (best === null || score > best.score)) best = { id: preset.id, score };
	}
	return best?.id ?? null;
}

function detectIntentMatches(normalized: string, ignores: readonly EditIntent[]): IntentMatch[] {
	const find = (intent: EditIntent, pattern: RegExp): RegExpExecArray | null =>
		ignores.includes(intent) ? null : pattern.exec(normalized);
	const remove = find('remove', REMOVE);
	const add = find('add', ADD);
	const replace = find('replace', REPLACE);
	const light = find('light', LIGHT) ?? (SCENE.test(normalized) ? find('light', BRIGHTNESS) : null);
	const surfaceChange = find('recolor', CHANGE_SURFACE) ?? find('recolor', RECOLOR);
	const make = SCENE.test(normalized) ? null : find('recolor', MAKE);
	const look = make === null ? null : SURFACE_LOOK.exec(normalized);
	const style = find('style', STYLE);
	const candidates: [EditIntent, RegExpExecArray[] | null][] = [
		['replace', remove && add && [remove, add]],
		['remove', remove && [remove]],
		['add', add && !replace && matchAddObjectPreset(normalized) !== null ? [add] : null],
		['light', light && [light]],
		['recolor', surfaceChange ? [surfaceChange] : make && look && [make, look]],
		['replace', replace && [replace]],
		['add', add && [add]],
		['style', style && [style]]
	];
	const matches: IntentMatch[] = [];
	for (const [intent, triggers] of candidates) {
		if (triggers !== null && !matches.some((match) => match.intent === intent)) {
			matches.push({ intent, triggers });
		}
	}
	return matches;
}

export function detectIntents(text: string, ignores: readonly EditIntent[] = []): EditIntent[] {
	return detectIntentMatches(normalize(text), ignores).map((match) => match.intent);
}

function triggerWords(text: string, triggers: RegExpExecArray[]): string[] {
	return triggers
		.toSorted((a, b) => a.index - b.index)
		.filter((trigger, i, sorted) => i === 0 || trigger.index !== sorted[i - 1].index)
		.map((trigger) => text.slice(trigger.index, trigger.index + trigger[0].length));
}

function intentTarget(intent: EditIntent, normalized: string): ModeHintTarget {
	const withReference = REFERENCE.test(normalized);
	switch (intent) {
		case 'add': {
			const presetId = matchAddObjectPreset(normalized);
			return presetId === null
				? { mode: 'edit', tool: 'freeform' }
				: { mode: 'edit', tool: 'add-object', presetId };
		}
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
	const normalized = normalize(text);
	const matches = detectIntentMatches(normalized, rule.ignores);
	if (matches.length === 0 || matches.some((match) => rule.accepts.includes(match.intent))) {
		return null;
	}
	const { intent, triggers: found } = matches[0];
	const triggers = triggerWords(text, found);
	if (rule.format?.intents.includes(intent)) {
		return { kind: 'format', field: rule.format.field, triggers };
	}
	const target = intentTarget(intent, normalized);
	if (sameTarget(rule.own, target)) return null;
	return { kind: 'switch', intent, target, triggers };
}

export function targetLabel(target: ModeHintTarget): TranslationKey {
	return target.mode === 'styleTransfer' ? 'mode.styleTransfer' : TOOL_LABELS[target.tool];
}
