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

import {
	Frame,
	Lamp,
	Library,
	Lightbulb,
	MirrorRectangular,
	Sparkles,
	Sprout,
	Users
} from '@lucide/svelte';
import type { TranslationKey } from '$lib/i18n/index.svelte';

type LucideIcon = typeof Lamp;

export interface AddObjectPreset {
	id: string;
	label: TranslationKey;
	prompt: TranslationKey;
	keywords: readonly string[];
	Icon: LucideIcon;
}

// Shared with RequestState (see request.svelte.ts) so the selected preset id
// can live in the single source-of-truth store instead of as component-local
// state that a remount would silently drop.
export const ADD_OBJECT_PRESETS: AddObjectPreset[] = [
	{
		id: 'led-strip',
		label: 'edit.addObject.ledStrip.label',
		prompt: 'edit.addObject.ledStrip.prompt',
		keywords: ['светодиодн\\p{L}*', 'лент\\p{L}*', 'led', 'strips?'],
		Icon: Lamp
	},
	{
		id: 'recessed-lights',
		label: 'edit.addObject.recessedLights.label',
		prompt: 'edit.addObject.recessedLights.prompt',
		keywords: ['точечн\\p{L}*', 'встроенн\\p{L}*', 'recessed', 'downlights?'],
		Icon: Lightbulb
	},
	{
		id: 'cove-lighting',
		label: 'edit.addObject.coveLighting.label',
		prompt: 'edit.addObject.coveLighting.prompt',
		keywords: ['подсветк\\p{L}* потолк\\p{L}*', 'потолочн\\p{L}* подсветк\\p{L}*', 'cove'],
		Icon: Sparkles
	},
	{
		id: 'people',
		label: 'edit.addObject.people.label',
		prompt: 'edit.addObject.people.prompt',
		keywords: ['люд\\p{L}*', 'человек\\p{L}*', 'people', 'persons?'],
		Icon: Users
	},
	{
		id: 'people-motion',
		label: 'edit.addObject.peopleMotion.label',
		prompt: 'edit.addObject.peopleMotion.prompt',
		keywords: [
			'люд\\p{L}*',
			'человек\\p{L}*',
			'движени\\p{L}*',
			'идущ\\p{L}*',
			'гуляющ\\p{L}*',
			'people',
			'persons?',
			'motion',
			'walking',
			'moving'
		],
		Icon: Users
	},
	{
		id: 'houseplant',
		label: 'edit.addObject.houseplant.label',
		prompt: 'edit.addObject.houseplant.prompt',
		keywords: [
			'растени\\p{L}*',
			'цвет(?:ы|ок|ов|ами|ком)',
			'фикус\\p{L}*',
			'монстер\\p{L}*',
			'пальм\\p{L}*',
			'зелен(?:ь|и)',
			'(?:house)?plants?',
			'flowers?',
			'greenery'
		],
		Icon: Sprout
	},
	{
		id: 'wall-art',
		label: 'edit.addObject.wallArt.label',
		prompt: 'edit.addObject.wallArt.prompt',
		keywords: [
			'картин\\p{L}*',
			'постер\\p{L}*',
			'принт\\p{L}*',
			'репродукци\\p{L}*',
			'art(?:work)?',
			'paintings?',
			'posters?',
			'prints?',
			'pictures?'
		],
		Icon: Frame
	},
	{
		id: 'bookshelf',
		label: 'edit.addObject.bookshelf.label',
		prompt: 'edit.addObject.bookshelf.prompt',
		keywords: [
			'книжн\\p{L}*',
			'полк\\p{L}*',
			'стеллаж\\p{L}*',
			'bookshel(?:f|ves)',
			'bookcases?',
			'shel(?:f|ves)'
		],
		Icon: Library
	},
	{
		id: 'mirror',
		label: 'edit.addObject.mirror.label',
		prompt: 'edit.addObject.mirror.prompt',
		keywords: ['зеркал\\p{L}*', 'mirrors?'],
		Icon: MirrorRectangular
	}
];
