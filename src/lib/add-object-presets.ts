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
		Icon: Lamp
	},
	{
		id: 'recessed-lights',
		label: 'edit.addObject.recessedLights.label',
		prompt: 'edit.addObject.recessedLights.prompt',
		Icon: Lightbulb
	},
	{
		id: 'cove-lighting',
		label: 'edit.addObject.coveLighting.label',
		prompt: 'edit.addObject.coveLighting.prompt',
		Icon: Sparkles
	},
	{
		id: 'people',
		label: 'edit.addObject.people.label',
		prompt: 'edit.addObject.people.prompt',
		Icon: Users
	},
	{
		id: 'people-motion',
		label: 'edit.addObject.peopleMotion.label',
		prompt: 'edit.addObject.peopleMotion.prompt',
		Icon: Users
	},
	{
		id: 'houseplant',
		label: 'edit.addObject.houseplant.label',
		prompt: 'edit.addObject.houseplant.prompt',
		Icon: Sprout
	},
	{
		id: 'wall-art',
		label: 'edit.addObject.wallArt.label',
		prompt: 'edit.addObject.wallArt.prompt',
		Icon: Frame
	},
	{
		id: 'bookshelf',
		label: 'edit.addObject.bookshelf.label',
		prompt: 'edit.addObject.bookshelf.prompt',
		Icon: Library
	},
	{
		id: 'mirror',
		label: 'edit.addObject.mirror.label',
		prompt: 'edit.addObject.mirror.prompt',
		Icon: MirrorRectangular
	}
];
