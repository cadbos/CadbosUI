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

// Interior-design terms archAI misreads in Russian or even in plain English
// (issue #260). An entry applies when the prompt contains every `stems` entry
// and none of `excludes`; stems are lowercase with ё written as е so they also
// match inflected forms ("ёлкой", "елки"). Keys are phrases, not lone words:
// "ёлка" alone stays a Christmas tree. English wording describes what the
// render should show, since archAI draws some bare names wrong (travertine
// becomes marble).

export interface PromptGlossaryEntry {
	term: string;
	stems: readonly string[];
	excludes?: readonly string[];
	english: string;
}

const HERRINGBONE = 'herringbone parquet, rectangular planks with square ends laid in a zigzag';
const CHEVRON = 'chevron parquet, planks with angled ends meeting in a continuous V point';

export const PROMPT_GLOSSARY: readonly PromptGlossaryEntry[] = [
	{ term: 'английская ёлка', stems: ['английск', 'елк'], english: HERRINGBONE },
	{ term: 'французская ёлка', stems: ['французск', 'елк'], english: CHEVRON },
	{ term: 'венгерская ёлка', stems: ['венгерск', 'елк'], english: CHEVRON },
	{ term: 'шеврон', stems: ['шеврон'], english: CHEVRON },
	{
		term: 'паркет ёлкой',
		stems: ['паркет', 'елк'],
		excludes: ['английск', 'французск', 'венгерск'],
		english: HERRINGBONE
	},
	{
		term: 'паркет ёлочкой',
		stems: ['паркет', 'елочк'],
		excludes: ['французск', 'венгерск'],
		english: HERRINGBONE
	},
	{
		term: 'паркет Версаль',
		stems: ['паркет', 'версал'],
		english: 'Versailles parquet panels on the floor only'
	},
	{ term: 'буазери', stems: ['буазери'], english: 'boiserie, carved wooden wall panelling' },
	{
		term: 'микроцемент',
		stems: ['микроцемент'],
		english: 'microcement, seamless smooth mineral plaster'
	},
	{
		term: 'терраццо',
		stems: ['терраццо'],
		english: 'terrazzo, polished floor with multicoloured stone chips set in cement'
	},
	{
		term: 'травертин',
		stems: ['травертин'],
		english: 'beige travertine stone with a porous pitted texture and matte finish'
	},
	{ term: 'грейдж', stems: ['грейдж'], english: 'greige, a warm grey-beige colour' },
	{ term: 'рейки', stems: ['рейк'], english: 'wooden slat wall panel' },
	{ term: 'молдинги', stems: ['молдинг'], english: 'decorative wall mouldings' },
	{ term: 'лепнина', stems: ['лепнин'], english: 'ornate plaster cornice and ceiling rose' },
	{
		term: 'теневой плинтус',
		stems: ['теневой', 'плинтус'],
		english: 'flush shadow gap skirting board'
	},
	{ term: 'ковролин', stems: ['ковролин'], english: 'wall-to-wall carpet' },
	{
		term: 'джапанди',
		stems: ['джапанди'],
		english: 'Japandi style: light oak, muted neutral colours, low minimal furniture'
	},
	{ term: 'честерфилд', stems: ['честерфилд'], english: 'Chesterfield' },
	{ term: 'торшер', stems: ['торшер'], english: 'floor lamp' },
	{ term: 'пуф', stems: ['пуф'], english: 'pouf' }
];

function normalized(text: string): string {
	return text.toLowerCase().replaceAll('ё', 'е');
}

export function matchPromptGlossary(prompt: string): PromptGlossaryEntry[] {
	const text = normalized(prompt);
	return PROMPT_GLOSSARY.filter(
		(entry) =>
			entry.stems.every((stem) => text.includes(stem)) &&
			!(entry.excludes ?? []).some((stem) => text.includes(stem))
	);
}
