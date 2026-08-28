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
	CloudRain,
	CloudSun,
	Cloudy,
	Contrast,
	Flame,
	Lamp,
	LampCeiling,
	LampDesk,
	LampFloor,
	LampWallUp,
	Lightbulb,
	LightbulbOff,
	Moon,
	MoonStar,
	PartyPopper,
	Sparkles,
	Stars,
	Sun,
	Sunrise
} from '@lucide/svelte';
import type { TranslationKey } from '$lib/i18n/index.svelte';

export type LightSettingsPresetGroup = 'mood' | 'fixture';
type LucideIcon = typeof Lamp;

export interface LightSettingsPreset {
	id: string;
	group: LightSettingsPresetGroup;
	label: TranslationKey;
	phrase: TranslationKey;
	Icon: LucideIcon;
}

// Ambient scene-lighting instructions — reworded from the former Atmosphere
// tool's presets into imperative phrases the light-settings workflow's
// translator/prompt template can act on directly.
const MOOD_PRESETS: LightSettingsPreset[] = [
	{
		id: 'midday',
		group: 'mood',
		label: 'lightSettings.preset.midday.label',
		phrase: 'lightSettings.preset.midday.phrase',
		Icon: Sun
	},
	{
		id: 'golden-hour',
		group: 'mood',
		label: 'lightSettings.preset.goldenHour.label',
		phrase: 'lightSettings.preset.goldenHour.phrase',
		Icon: Sunrise
	},
	{
		id: 'blue-hour',
		group: 'mood',
		label: 'lightSettings.preset.blueHour.label',
		phrase: 'lightSettings.preset.blueHour.phrase',
		Icon: MoonStar
	},
	{
		id: 'overcast',
		group: 'mood',
		label: 'lightSettings.preset.overcast.label',
		phrase: 'lightSettings.preset.overcast.phrase',
		Icon: Cloudy
	},
	{
		id: 'warm-light',
		group: 'mood',
		label: 'lightSettings.preset.warmLight.label',
		phrase: 'lightSettings.preset.warmLight.phrase',
		Icon: Lamp
	},
	{
		id: 'dim',
		group: 'mood',
		label: 'lightSettings.preset.dim.label',
		phrase: 'lightSettings.preset.dim.phrase',
		Icon: Moon
	},
	{
		id: 'night',
		group: 'mood',
		label: 'lightSettings.preset.night.label',
		phrase: 'lightSettings.preset.night.phrase',
		Icon: Stars
	},
	{
		id: 'early-morning',
		group: 'mood',
		label: 'lightSettings.preset.earlyMorning.label',
		phrase: 'lightSettings.preset.earlyMorning.phrase',
		Icon: CloudSun
	},
	{
		id: 'rainy',
		group: 'mood',
		label: 'lightSettings.preset.rainy.label',
		phrase: 'lightSettings.preset.rainy.phrase',
		Icon: CloudRain
	},
	{
		id: 'dramatic',
		group: 'mood',
		label: 'lightSettings.preset.dramatic.label',
		phrase: 'lightSettings.preset.dramatic.phrase',
		Icon: Contrast
	},
	{
		id: 'candlelight',
		group: 'mood',
		label: 'lightSettings.preset.candlelight.label',
		phrase: 'lightSettings.preset.candlelight.phrase',
		Icon: Flame
	},
	{
		id: 'festive',
		group: 'mood',
		label: 'lightSettings.preset.festive.label',
		phrase: 'lightSettings.preset.festive.phrase',
		Icon: PartyPopper
	}
];

// Per-fixture on/off instructions, matching the workflow's own example
// instructions ("зажги люстру", "выключи бра над кроватью", "выключи все
// светильники"). Each fixture gets its own on/off preset pair rather than a
// single tri-state toggle — a plain multi-select list is what the user asked
// for, and it keeps this catalog (and the toggle logic) simple.
interface FixtureDefinition {
	id: string;
	name: TranslationKey;
	labelOn: TranslationKey;
	labelOff: TranslationKey;
	phraseOn: TranslationKey;
	phraseOff: TranslationKey;
	Icon: LucideIcon;
}

const FIXTURES: FixtureDefinition[] = [
	{
		id: 'chandelier',
		name: 'lightSettings.fixture.chandelier',
		labelOn: 'lightSettings.preset.chandelierOn.label',
		labelOff: 'lightSettings.preset.chandelierOff.label',
		phraseOn: 'lightSettings.preset.chandelierOn.phrase',
		phraseOff: 'lightSettings.preset.chandelierOff.phrase',
		Icon: LampCeiling
	},
	{
		id: 'sconce',
		name: 'lightSettings.fixture.sconce',
		labelOn: 'lightSettings.preset.sconceOn.label',
		labelOff: 'lightSettings.preset.sconceOff.label',
		phraseOn: 'lightSettings.preset.sconceOn.phrase',
		phraseOff: 'lightSettings.preset.sconceOff.phrase',
		Icon: LampWallUp
	},
	{
		id: 'floor-lamp',
		name: 'lightSettings.fixture.floorLamp',
		labelOn: 'lightSettings.preset.floorLampOn.label',
		labelOff: 'lightSettings.preset.floorLampOff.label',
		phraseOn: 'lightSettings.preset.floorLampOn.phrase',
		phraseOff: 'lightSettings.preset.floorLampOff.phrase',
		Icon: LampFloor
	},
	{
		id: 'table-lamp',
		name: 'lightSettings.fixture.tableLamp',
		labelOn: 'lightSettings.preset.tableLampOn.label',
		labelOff: 'lightSettings.preset.tableLampOff.label',
		phraseOn: 'lightSettings.preset.tableLampOn.phrase',
		phraseOff: 'lightSettings.preset.tableLampOff.phrase',
		Icon: LampDesk
	},
	{
		id: 'spotlights',
		name: 'lightSettings.fixture.spotlights',
		labelOn: 'lightSettings.preset.spotlightsOn.label',
		labelOff: 'lightSettings.preset.spotlightsOff.label',
		phraseOn: 'lightSettings.preset.spotlightsOn.phrase',
		phraseOff: 'lightSettings.preset.spotlightsOff.phrase',
		Icon: Lightbulb
	},
	{
		id: 'string-lights',
		name: 'lightSettings.fixture.stringLights',
		labelOn: 'lightSettings.preset.stringLightsOn.label',
		labelOff: 'lightSettings.preset.stringLightsOff.label',
		phraseOn: 'lightSettings.preset.stringLightsOn.phrase',
		phraseOff: 'lightSettings.preset.stringLightsOff.phrase',
		Icon: Sparkles
	},
	{
		id: 'all-lights',
		name: 'lightSettings.fixture.allLights',
		labelOn: 'lightSettings.preset.allLightsOn.label',
		labelOff: 'lightSettings.preset.allLightsOff.label',
		phraseOn: 'lightSettings.preset.allLightsOn.phrase',
		phraseOff: 'lightSettings.preset.allLightsOff.phrase',
		Icon: LightbulbOff
	}
];

const FIXTURE_PRESETS: LightSettingsPreset[] = FIXTURES.flatMap((fixture) => [
	{
		id: `${fixture.id}-on`,
		group: 'fixture' as const,
		label: fixture.labelOn,
		phrase: fixture.phraseOn,
		Icon: fixture.Icon
	},
	{
		id: `${fixture.id}-off`,
		group: 'fixture' as const,
		label: fixture.labelOff,
		phrase: fixture.phraseOff,
		Icon: fixture.Icon
	}
]);

export const LIGHT_SETTINGS_PRESETS: LightSettingsPreset[] = [...MOOD_PRESETS, ...FIXTURE_PRESETS];

export function lightSettingsPresetsFor(group: LightSettingsPresetGroup): LightSettingsPreset[] {
	return LIGHT_SETTINGS_PRESETS.filter((preset) => preset.group === group);
}

// One compact row per fixture (icon + name + on/off toggle) instead of two
// separate preset buttons — the on/off pair collapses into a single row's
// two-state control, driven by RequestState.setLightSettingsFixtureState().
export interface LightSettingsFixture {
	id: string;
	name: TranslationKey;
	onId: string;
	offId: string;
	Icon: LucideIcon;
}

export const LIGHT_SETTINGS_FIXTURES: LightSettingsFixture[] = FIXTURES.map((fixture) => ({
	id: fixture.id,
	name: fixture.name,
	onId: `${fixture.id}-on`,
	offId: `${fixture.id}-off`,
	Icon: fixture.Icon
}));
