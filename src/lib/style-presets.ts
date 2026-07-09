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
import type { SceneType } from '$lib/state/request.svelte';

export type StylePresetCategory = 'photorealistic' | 'conceptual';

export interface StylePreset {
	id: string;
	sceneType: SceneType;
	category: StylePresetCategory;
	label: TranslationKey;
	src: string;
	mime: 'image/webp' | 'image/jpeg';
}

export const STYLE_PRESETS: StylePreset[] = [
	{
		id: 'concrete-spa-bathroom',
		sceneType: 'interior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.interior.photorealistic.concreteSpaBathroom',
		src: 'https://style-presets.cadbos.com/interior/photorealistic/concrete-spa-bathroom.webp',
		mime: 'image/webp'
	},
	{
		id: 'warm-wood-kitchen',
		sceneType: 'interior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.interior.photorealistic.warmWoodKitchen',
		src: 'https://style-presets.cadbos.com/interior/photorealistic/warm-wood-kitchen.webp',
		mime: 'image/webp'
	},
	{
		id: 'dark-matte-kitchen',
		sceneType: 'interior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.interior.photorealistic.darkMatteKitchen',
		src: 'https://style-presets.cadbos.com/interior/photorealistic/dark-matte-kitchen.webp',
		mime: 'image/webp'
	},
	{
		id: 'coastal-living-room',
		sceneType: 'interior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.interior.photorealistic.coastalLivingRoom',
		src: 'https://style-presets.cadbos.com/interior/photorealistic/coastal-living-room.webp',
		mime: 'image/webp'
	},
	{
		id: 'mid-century-living-room',
		sceneType: 'interior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.interior.photorealistic.midCenturyLivingRoom',
		src: 'https://style-presets.cadbos.com/interior/photorealistic/mid-century-living-room.webp',
		mime: 'image/webp'
	},
	{
		id: 'serene-beige-bedroom',
		sceneType: 'interior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.interior.photorealistic.sereneBeigeBedroom',
		src: 'https://style-presets.cadbos.com/interior/photorealistic/serene-beige-bedroom.webp',
		mime: 'image/webp'
	},
	{
		id: 'green-salon-interior',
		sceneType: 'interior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.interior.photorealistic.greenSalonInterior',
		src: 'https://style-presets.cadbos.com/interior/photorealistic/green-salon-interior.webp',
		mime: 'image/webp'
	},
	{
		id: 'industrial-concrete-kitchen',
		sceneType: 'interior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.interior.photorealistic.industrialConcreteKitchen',
		src: 'https://style-presets.cadbos.com/interior/photorealistic/industrial-concrete-kitchen.webp',
		mime: 'image/webp'
	},
	{
		id: 'retro-teal-bathroom',
		sceneType: 'interior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.interior.photorealistic.retroTealBathroom',
		src: 'https://style-presets.cadbos.com/interior/photorealistic/retro-teal-bathroom.webp',
		mime: 'image/webp'
	},
	{
		id: 'city-view-living-room',
		sceneType: 'interior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.interior.photorealistic.cityViewLivingRoom',
		src: 'https://style-presets.cadbos.com/interior/photorealistic/city-view-living-room.webp',
		mime: 'image/webp'
	},
	{
		id: 'blush-kids-bedroom',
		sceneType: 'interior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.interior.photorealistic.blushKidsBedroom',
		src: 'https://style-presets.cadbos.com/interior/photorealistic/blush-kids-bedroom.webp',
		mime: 'image/webp'
	},
	{
		id: 'botanical-sunroom-loft',
		sceneType: 'interior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.interior.photorealistic.botanicalSunroomLoft',
		src: 'https://style-presets.cadbos.com/interior/photorealistic/botanical-sunroom-loft.webp',
		mime: 'image/webp'
	},
	{
		id: 'skyline-boardroom',
		sceneType: 'interior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.interior.photorealistic.skylineBoardroom',
		src: 'https://style-presets.cadbos.com/interior/photorealistic/skyline-boardroom.webp',
		mime: 'image/webp'
	},
	{
		id: 'alpine-chalet-bedroom',
		sceneType: 'interior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.interior.photorealistic.alpineChaletBedroom',
		src: 'https://style-presets.cadbos.com/interior/photorealistic/alpine-chalet-bedroom.webp',
		mime: 'image/webp'
	},
	{
		id: 'marble-luxury-bedroom',
		sceneType: 'interior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.interior.photorealistic.marbleLuxuryBedroom',
		src: 'https://style-presets.cadbos.com/interior/photorealistic/marble-luxury-bedroom.webp',
		mime: 'image/webp'
	},
	{
		id: 'skylight-soaking-bathroom',
		sceneType: 'interior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.interior.photorealistic.skylightSoakingBathroom',
		src: 'https://style-presets.cadbos.com/interior/photorealistic/skylight-soaking-bathroom.webp',
		mime: 'image/webp'
	},
	{
		id: 'boutique-retail-space',
		sceneType: 'interior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.interior.photorealistic.boutiqueRetailSpace',
		src: 'https://style-presets.cadbos.com/interior/photorealistic/boutique-retail-space.webp',
		mime: 'image/webp'
	},
	{
		id: 'wood-slat-dining-nook',
		sceneType: 'interior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.interior.photorealistic.woodSlatDiningNook',
		src: 'https://style-presets.cadbos.com/interior/photorealistic/wood-slat-dining-nook.webp',
		mime: 'image/webp'
	},
	{
		id: 'gold-marble-bathroom',
		sceneType: 'interior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.interior.photorealistic.goldMarbleBathroom',
		src: 'https://style-presets.cadbos.com/interior/photorealistic/gold-marble-bathroom.webp',
		mime: 'image/webp'
	},
	{
		id: 'brick-loft-living-room',
		sceneType: 'interior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.interior.photorealistic.brickLoftLivingRoom',
		src: 'https://style-presets.cadbos.com/interior/photorealistic/brick-loft-living-room.webp',
		mime: 'image/webp'
	},
	{
		id: 'sunlit-brick-office',
		sceneType: 'interior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.interior.photorealistic.sunlitBrickOffice',
		src: 'https://style-presets.cadbos.com/interior/photorealistic/sunlit-brick-office.webp',
		mime: 'image/webp'
	},
	{
		id: 'japandi-dining-booths',
		sceneType: 'interior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.interior.photorealistic.japandiDiningBooths',
		src: 'https://style-presets.cadbos.com/interior/photorealistic/japandi-dining-booths.webp',
		mime: 'image/webp'
	},
	{
		id: 'mediterranean-seaside-loggia',
		sceneType: 'interior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.interior.photorealistic.mediterraneanSeasideLoggia',
		src: 'https://style-presets.cadbos.com/interior/photorealistic/mediterranean-seaside-loggia.webp',
		mime: 'image/webp'
	},
	{
		id: 'city-view-bedroom',
		sceneType: 'interior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.interior.photorealistic.cityViewBedroom',
		src: 'https://style-presets.cadbos.com/interior/photorealistic/city-view-bedroom.webp',
		mime: 'image/webp'
	},
	{
		id: 'minimalist-white-kitchen',
		sceneType: 'interior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.interior.photorealistic.minimalistWhiteKitchen',
		src: 'https://style-presets.cadbos.com/interior/photorealistic/minimalist-white-kitchen.webp',
		mime: 'image/webp'
	},
	{
		id: 'warm-gray-bathroom',
		sceneType: 'interior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.interior.photorealistic.warmGrayBathroom',
		src: 'https://style-presets.cadbos.com/interior/photorealistic/warm-gray-bathroom.webp',
		mime: 'image/webp'
	},
	{
		id: 'moroccan-lounge-nook',
		sceneType: 'interior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.interior.photorealistic.moroccanLoungeNook',
		src: 'https://style-presets.cadbos.com/interior/photorealistic/moroccan-lounge-nook.webp',
		mime: 'image/webp'
	},
	{
		id: 'scandinavian-bedroom',
		sceneType: 'interior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.interior.photorealistic.scandinavianBedroom',
		src: 'https://style-presets.cadbos.com/interior/photorealistic/scandinavian-bedroom.webp',
		mime: 'image/webp'
	},
	{
		id: 'spa-retreat-bathroom',
		sceneType: 'interior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.interior.photorealistic.spaRetreatBathroom',
		src: 'https://style-presets.cadbos.com/interior/photorealistic/spa-retreat-bathroom.webp',
		mime: 'image/webp'
	},
	{
		id: 'rustic-kitchen-nook',
		sceneType: 'interior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.interior.photorealistic.rusticKitchenNook',
		src: 'https://style-presets.cadbos.com/interior/photorealistic/rustic-kitchen-nook.webp',
		mime: 'image/webp'
	},
	{
		id: 'japanese-izakaya-interior',
		sceneType: 'interior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.interior.photorealistic.japaneseIzakayaInterior',
		src: 'https://style-presets.cadbos.com/interior/photorealistic/japanese-izakaya-interior.webp',
		mime: 'image/webp'
	},
	{
		id: 'tropical-outdoor-bathroom',
		sceneType: 'interior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.interior.photorealistic.tropicalOutdoorBathroom',
		src: 'https://style-presets.cadbos.com/interior/photorealistic/tropical-outdoor-bathroom.webp',
		mime: 'image/webp'
	},
	{
		id: 'pure-white-bathroom',
		sceneType: 'interior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.interior.photorealistic.pureWhiteBathroom',
		src: 'https://style-presets.cadbos.com/interior/photorealistic/pure-white-bathroom.webp',
		mime: 'image/webp'
	},
	{
		id: 'dark-luxury-marble-kitchen',
		sceneType: 'interior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.interior.photorealistic.darkLuxuryMarbleKitchen',
		src: 'https://style-presets.cadbos.com/interior/photorealistic/dark-luxury-marble-kitchen.webp',
		mime: 'image/webp'
	},
	{
		id: 'blush-glam-living-room',
		sceneType: 'interior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.interior.photorealistic.blushGlamLivingRoom',
		src: 'https://style-presets.cadbos.com/interior/photorealistic/blush-glam-living-room.webp',
		mime: 'image/webp'
	},
	{
		id: 'wabi-sabi-dining-room',
		sceneType: 'interior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.interior.photorealistic.wabiSabiDiningRoom',
		src: 'https://style-presets.cadbos.com/interior/photorealistic/wabi-sabi-dining-room.webp',
		mime: 'image/webp'
	},
	{
		id: 'retro-checkerboard-cafe',
		sceneType: 'interior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.interior.photorealistic.retroCheckerboardCafe',
		src: 'https://style-presets.cadbos.com/interior/photorealistic/retro-checkerboard-cafe.webp',
		mime: 'image/webp'
	},
	{
		id: 'eclectic-colorful-living-room',
		sceneType: 'interior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.interior.photorealistic.eclecticColorfulLivingRoom',
		src: 'https://style-presets.cadbos.com/interior/photorealistic/eclectic-colorful-living-room.webp',
		mime: 'image/webp'
	},
	{
		id: 'golden-hour-marble-kitchen',
		sceneType: 'interior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.interior.photorealistic.goldenHourMarbleKitchen',
		src: 'https://style-presets.cadbos.com/interior/photorealistic/golden-hour-marble-kitchen.webp',
		mime: 'image/webp'
	},
	{
		id: 'concrete-loft-green-velvet',
		sceneType: 'interior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.interior.photorealistic.concreteLoftGreenVelvet',
		src: 'https://style-presets.cadbos.com/interior/photorealistic/concrete-loft-green-velvet.webp',
		mime: 'image/webp'
	},
	{
		id: 'watercolor-v1',
		sceneType: 'interior',
		category: 'conceptual',
		label: 'styleTransfer.preset.interior.conceptual.watercolorV1',
		src: 'https://style-presets.cadbos.com/interior/conceptual/watercolor-v1.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'watercolor-v2',
		sceneType: 'interior',
		category: 'conceptual',
		label: 'styleTransfer.preset.interior.conceptual.watercolorV2',
		src: 'https://style-presets.cadbos.com/interior/conceptual/watercolor-v2.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'architectural-marker',
		sceneType: 'interior',
		category: 'conceptual',
		label: 'styleTransfer.preset.interior.conceptual.architecturalMarker',
		src: 'https://style-presets.cadbos.com/interior/conceptual/architectural-marker.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'marker-sketch',
		sceneType: 'interior',
		category: 'conceptual',
		label: 'styleTransfer.preset.interior.conceptual.markerSketch',
		src: 'https://style-presets.cadbos.com/interior/conceptual/marker-sketch.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'architectural-pen',
		sceneType: 'interior',
		category: 'conceptual',
		label: 'styleTransfer.preset.interior.conceptual.architecturalPen',
		src: 'https://style-presets.cadbos.com/interior/conceptual/architectural-pen.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'pencil-sketch',
		sceneType: 'interior',
		category: 'conceptual',
		label: 'styleTransfer.preset.interior.conceptual.pencilSketch',
		src: 'https://style-presets.cadbos.com/interior/conceptual/pencil-sketch.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'digital-painting',
		sceneType: 'interior',
		category: 'conceptual',
		label: 'styleTransfer.preset.interior.conceptual.digitalPainting',
		src: 'https://style-presets.cadbos.com/interior/conceptual/digital-painting.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'ink-wash',
		sceneType: 'interior',
		category: 'conceptual',
		label: 'styleTransfer.preset.interior.conceptual.inkWash',
		src: 'https://style-presets.cadbos.com/interior/conceptual/ink-wash.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'ukiyo-e',
		sceneType: 'interior',
		category: 'conceptual',
		label: 'styleTransfer.preset.interior.conceptual.ukiyoE',
		src: 'https://style-presets.cadbos.com/interior/conceptual/ukiyo-e.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'hand-painted-anime',
		sceneType: 'interior',
		category: 'conceptual',
		label: 'styleTransfer.preset.interior.conceptual.handPaintedAnime',
		src: 'https://style-presets.cadbos.com/interior/conceptual/hand-painted-anime.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'bauhaus',
		sceneType: 'interior',
		category: 'conceptual',
		label: 'styleTransfer.preset.interior.conceptual.bauhaus',
		src: 'https://style-presets.cadbos.com/interior/conceptual/bauhaus.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'xerox-collage',
		sceneType: 'interior',
		category: 'conceptual',
		label: 'styleTransfer.preset.interior.conceptual.xeroxCollage',
		src: 'https://style-presets.cadbos.com/interior/conceptual/xerox-collage.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'coloring-book',
		sceneType: 'interior',
		category: 'conceptual',
		label: 'styleTransfer.preset.interior.conceptual.coloringBook',
		src: 'https://style-presets.cadbos.com/interior/conceptual/coloring-book.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'risograph',
		sceneType: 'interior',
		category: 'conceptual',
		label: 'styleTransfer.preset.interior.conceptual.risograph',
		src: 'https://style-presets.cadbos.com/interior/conceptual/risograph.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'risograph-mono',
		sceneType: 'interior',
		category: 'conceptual',
		label: 'styleTransfer.preset.interior.conceptual.risographMono',
		src: 'https://style-presets.cadbos.com/interior/conceptual/risograph-mono.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'white-model',
		sceneType: 'interior',
		category: 'conceptual',
		label: 'styleTransfer.preset.interior.conceptual.whiteModel',
		src: 'https://style-presets.cadbos.com/interior/conceptual/white-model.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'editorial-cartoon',
		sceneType: 'interior',
		category: 'conceptual',
		label: 'styleTransfer.preset.interior.conceptual.editorialCartoon',
		src: 'https://style-presets.cadbos.com/interior/conceptual/editorial-cartoon.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'bw-cinematic',
		sceneType: 'interior',
		category: 'conceptual',
		label: 'styleTransfer.preset.interior.conceptual.bwCinematic',
		src: 'https://style-presets.cadbos.com/interior/conceptual/bw-cinematic.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'parallel-lines',
		sceneType: 'interior',
		category: 'conceptual',
		label: 'styleTransfer.preset.interior.conceptual.parallelLines',
		src: 'https://style-presets.cadbos.com/interior/conceptual/parallel-lines.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'travel-poster',
		sceneType: 'interior',
		category: 'conceptual',
		label: 'styleTransfer.preset.interior.conceptual.travelPoster',
		src: 'https://style-presets.cadbos.com/interior/conceptual/travel-poster.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'zen-ink',
		sceneType: 'interior',
		category: 'conceptual',
		label: 'styleTransfer.preset.interior.conceptual.zenInk',
		src: 'https://style-presets.cadbos.com/interior/conceptual/zen-ink.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'light-wash',
		sceneType: 'interior',
		category: 'conceptual',
		label: 'styleTransfer.preset.interior.conceptual.lightWash',
		src: 'https://style-presets.cadbos.com/interior/conceptual/light-wash.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'lofi-pixel',
		sceneType: 'interior',
		category: 'conceptual',
		label: 'styleTransfer.preset.interior.conceptual.lofiPixel',
		src: 'https://style-presets.cadbos.com/interior/conceptual/lofi-pixel.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'impasto-oil',
		sceneType: 'interior',
		category: 'conceptual',
		label: 'styleTransfer.preset.interior.conceptual.impastoOil',
		src: 'https://style-presets.cadbos.com/interior/conceptual/impasto-oil.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'neutral-technical',
		sceneType: 'interior',
		category: 'conceptual',
		label: 'styleTransfer.preset.interior.conceptual.neutralTechnical',
		src: 'https://style-presets.cadbos.com/interior/conceptual/neutral-technical.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'naive-crayon',
		sceneType: 'interior',
		category: 'conceptual',
		label: 'styleTransfer.preset.interior.conceptual.naiveCrayon',
		src: 'https://style-presets.cadbos.com/interior/conceptual/naive-crayon.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'blueprint',
		sceneType: 'interior',
		category: 'conceptual',
		label: 'styleTransfer.preset.interior.conceptual.blueprint',
		src: 'https://style-presets.cadbos.com/interior/conceptual/blueprint.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'brutalist',
		sceneType: 'interior',
		category: 'conceptual',
		label: 'styleTransfer.preset.interior.conceptual.brutalist',
		src: 'https://style-presets.cadbos.com/interior/conceptual/brutalist.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'concrete-cube-house',
		sceneType: 'exterior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.exterior.photorealistic.concreteCubeHouse',
		src: 'https://style-presets.cadbos.com/exterior/photorealistic/concrete-cube-house.webp',
		mime: 'image/webp'
	},
	{
		id: 'black-roof-farmhouse',
		sceneType: 'exterior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.exterior.photorealistic.blackRoofFarmhouse',
		src: 'https://style-presets.cadbos.com/exterior/photorealistic/black-roof-farmhouse.webp',
		mime: 'image/webp'
	},
	{
		id: 'red-brick-corner-building',
		sceneType: 'exterior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.exterior.photorealistic.redBrickCornerBuilding',
		src: 'https://style-presets.cadbos.com/exterior/photorealistic/red-brick-corner-building.webp',
		mime: 'image/webp'
	},
	{
		id: 'black-barn-in-snow',
		sceneType: 'exterior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.exterior.photorealistic.blackBarnInSnow',
		src: 'https://style-presets.cadbos.com/exterior/photorealistic/black-barn-in-snow.webp',
		mime: 'image/webp'
	},
	{
		id: 'cozy-wood-cabin',
		sceneType: 'exterior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.exterior.photorealistic.cozyWoodCabin',
		src: 'https://style-presets.cadbos.com/exterior/photorealistic/cozy-wood-cabin.webp',
		mime: 'image/webp'
	},
	{
		id: 'coastal-tile-roof-house',
		sceneType: 'exterior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.exterior.photorealistic.coastalTileRoofHouse',
		src: 'https://style-presets.cadbos.com/exterior/photorealistic/coastal-tile-roof-house.webp',
		mime: 'image/webp'
	},
	{
		id: 'concrete-house-at-dusk',
		sceneType: 'exterior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.exterior.photorealistic.concreteHouseAtDusk',
		src: 'https://style-presets.cadbos.com/exterior/photorealistic/concrete-house-at-dusk.webp',
		mime: 'image/webp'
	},
	{
		id: 'white-minimalist-villa',
		sceneType: 'exterior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.exterior.photorealistic.whiteMinimalistVilla',
		src: 'https://style-presets.cadbos.com/exterior/photorealistic/white-minimalist-villa.webp',
		mime: 'image/webp'
	},
	{
		id: 'curved-concrete-atrium',
		sceneType: 'exterior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.exterior.photorealistic.curvedConcreteAtrium',
		src: 'https://style-presets.cadbos.com/exterior/photorealistic/curved-concrete-atrium.webp',
		mime: 'image/webp'
	},
	{
		id: 'japanese-courtyard-house',
		sceneType: 'exterior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.exterior.photorealistic.japaneseCourtyardHouse',
		src: 'https://style-presets.cadbos.com/exterior/photorealistic/japanese-courtyard-house.webp',
		mime: 'image/webp'
	},
	{
		id: 'foggy-log-cabin',
		sceneType: 'exterior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.exterior.photorealistic.foggyLogCabin',
		src: 'https://style-presets.cadbos.com/exterior/photorealistic/foggy-log-cabin.webp',
		mime: 'image/webp'
	},
	{
		id: 'foggy-beach-house',
		sceneType: 'exterior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.exterior.photorealistic.foggyBeachHouse',
		src: 'https://style-presets.cadbos.com/exterior/photorealistic/foggy-beach-house.webp',
		mime: 'image/webp'
	},
	{
		id: 'desert-minimalist-house',
		sceneType: 'exterior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.exterior.photorealistic.desertMinimalistHouse',
		src: 'https://style-presets.cadbos.com/exterior/photorealistic/desert-minimalist-house.webp',
		mime: 'image/webp'
	},
	{
		id: 'mediterranean-white-villa',
		sceneType: 'exterior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.exterior.photorealistic.mediterraneanWhiteVilla',
		src: 'https://style-presets.cadbos.com/exterior/photorealistic/mediterranean-white-villa.webp',
		mime: 'image/webp'
	},
	{
		id: 'corporate-glass-courtyard',
		sceneType: 'exterior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.exterior.photorealistic.corporateGlassCourtyard',
		src: 'https://style-presets.cadbos.com/exterior/photorealistic/corporate-glass-courtyard.webp',
		mime: 'image/webp'
	},
	{
		id: 'craftsman-house-under-trees',
		sceneType: 'exterior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.exterior.photorealistic.craftsmanHouseUnderTrees',
		src: 'https://style-presets.cadbos.com/exterior/photorealistic/craftsman-house-under-trees.webp',
		mime: 'image/webp'
	},
	{
		id: 'desert-dusk-cactus-house',
		sceneType: 'exterior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.exterior.photorealistic.desertDuskCactusHouse',
		src: 'https://style-presets.cadbos.com/exterior/photorealistic/desert-dusk-cactus-house.webp',
		mime: 'image/webp'
	},
	{
		id: 'foggy-minimalist-beach-house',
		sceneType: 'exterior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.exterior.photorealistic.foggyMinimalistBeachHouse',
		src: 'https://style-presets.cadbos.com/exterior/photorealistic/foggy-minimalist-beach-house.webp',
		mime: 'image/webp'
	},
	{
		id: 'greek-blue-door-courtyard',
		sceneType: 'exterior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.exterior.photorealistic.greekBlueDoorCourtyard',
		src: 'https://style-presets.cadbos.com/exterior/photorealistic/greek-blue-door-courtyard.webp',
		mime: 'image/webp'
	},
	{
		id: 'southwest-desert-home',
		sceneType: 'exterior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.exterior.photorealistic.southwestDesertHome',
		src: 'https://style-presets.cadbos.com/exterior/photorealistic/southwest-desert-home.webp',
		mime: 'image/webp'
	},
	{
		id: 'snowy-black-barn',
		sceneType: 'exterior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.exterior.photorealistic.snowyBlackBarn',
		src: 'https://style-presets.cadbos.com/exterior/photorealistic/snowy-black-barn.webp',
		mime: 'image/webp'
	},
	{
		id: 'cliffside-sunset-house',
		sceneType: 'exterior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.exterior.photorealistic.cliffsideSunsetHouse',
		src: 'https://style-presets.cadbos.com/exterior/photorealistic/cliffside-sunset-house.webp',
		mime: 'image/webp'
	},
	{
		id: 'cliffside-infinity-villa',
		sceneType: 'exterior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.exterior.photorealistic.cliffsideInfinityVilla',
		src: 'https://style-presets.cadbos.com/exterior/photorealistic/cliffside-infinity-villa.webp',
		mime: 'image/webp'
	},
	{
		id: 'adobe-cactus-courtyard',
		sceneType: 'exterior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.exterior.photorealistic.adobeCactusCourtyard',
		src: 'https://style-presets.cadbos.com/exterior/photorealistic/adobe-cactus-courtyard.webp',
		mime: 'image/webp'
	},
	{
		id: 'stone-cottage-garden',
		sceneType: 'exterior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.exterior.photorealistic.stoneCottageGarden',
		src: 'https://style-presets.cadbos.com/exterior/photorealistic/stone-cottage-garden.webp',
		mime: 'image/webp'
	},
	{
		id: 'black-cabin-in-meadow',
		sceneType: 'exterior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.exterior.photorealistic.blackCabinInMeadow',
		src: 'https://style-presets.cadbos.com/exterior/photorealistic/black-cabin-in-meadow.webp',
		mime: 'image/webp'
	},
	{
		id: 'brick-townhouse-row',
		sceneType: 'exterior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.exterior.photorealistic.brickTownhouseRow',
		src: 'https://style-presets.cadbos.com/exterior/photorealistic/brick-townhouse-row.webp',
		mime: 'image/webp'
	},
	{
		id: 'thatched-beach-villa',
		sceneType: 'exterior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.exterior.photorealistic.thatchedBeachVilla',
		src: 'https://style-presets.cadbos.com/exterior/photorealistic/thatched-beach-villa.webp',
		mime: 'image/webp'
	},
	{
		id: 'tropical-pool-pavilion',
		sceneType: 'exterior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.exterior.photorealistic.tropicalPoolPavilion',
		src: 'https://style-presets.cadbos.com/exterior/photorealistic/tropical-pool-pavilion.webp',
		mime: 'image/webp'
	},
	{
		id: 'mediterranean-dusk-pool-villa',
		sceneType: 'exterior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.exterior.photorealistic.mediterraneanDuskPoolVilla',
		src: 'https://style-presets.cadbos.com/exterior/photorealistic/mediterranean-dusk-pool-villa.webp',
		mime: 'image/webp'
	},
	{
		id: 'snowy-angular-white-house',
		sceneType: 'exterior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.exterior.photorealistic.snowyAngularWhiteHouse',
		src: 'https://style-presets.cadbos.com/exterior/photorealistic/snowy-angular-white-house.webp',
		mime: 'image/webp'
	},
	{
		id: 'wood-cabin-at-dusk',
		sceneType: 'exterior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.exterior.photorealistic.woodCabinAtDusk',
		src: 'https://style-presets.cadbos.com/exterior/photorealistic/wood-cabin-at-dusk.webp',
		mime: 'image/webp'
	},
	{
		id: 'perforated-concrete-house',
		sceneType: 'exterior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.exterior.photorealistic.perforatedConcreteHouse',
		src: 'https://style-presets.cadbos.com/exterior/photorealistic/perforated-concrete-house.webp',
		mime: 'image/webp'
	},
	{
		id: 'cantilevered-mountainside-house',
		sceneType: 'exterior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.exterior.photorealistic.cantileveredMountainsideHouse',
		src: 'https://style-presets.cadbos.com/exterior/photorealistic/cantilevered-mountainside-house.webp',
		mime: 'image/webp'
	},
	{
		id: 'glass-gable-forest-house',
		sceneType: 'exterior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.exterior.photorealistic.glassGableForestHouse',
		src: 'https://style-presets.cadbos.com/exterior/photorealistic/glass-gable-forest-house.webp',
		mime: 'image/webp'
	},
	{
		id: 'sculptural-stone-tower',
		sceneType: 'exterior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.exterior.photorealistic.sculpturalStoneTower',
		src: 'https://style-presets.cadbos.com/exterior/photorealistic/sculptural-stone-tower.webp',
		mime: 'image/webp'
	},
	{
		id: 'futuristic-pod-houses',
		sceneType: 'exterior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.exterior.photorealistic.futuristicPodHouses',
		src: 'https://style-presets.cadbos.com/exterior/photorealistic/futuristic-pod-houses.webp',
		mime: 'image/webp'
	},
	{
		id: 'hillside-wood-cabin',
		sceneType: 'exterior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.exterior.photorealistic.hillsideWoodCabin',
		src: 'https://style-presets.cadbos.com/exterior/photorealistic/hillside-wood-cabin.webp',
		mime: 'image/webp'
	},
	{
		id: 'waterfront-glass-tower',
		sceneType: 'exterior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.exterior.photorealistic.waterfrontGlassTower',
		src: 'https://style-presets.cadbos.com/exterior/photorealistic/waterfront-glass-tower.webp',
		mime: 'image/webp'
	},
	{
		id: 'glass-cantilever-building',
		sceneType: 'exterior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.exterior.photorealistic.glassCantileverBuilding',
		src: 'https://style-presets.cadbos.com/exterior/photorealistic/glass-cantilever-building.webp',
		mime: 'image/webp'
	},
	{
		id: 'mediterranean-cafe-patio',
		sceneType: 'exterior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.exterior.photorealistic.mediterraneanCafePatio',
		src: 'https://style-presets.cadbos.com/exterior/photorealistic/mediterranean-cafe-patio.webp',
		mime: 'image/webp'
	},
	{
		id: 'futuristic-geometric-house',
		sceneType: 'exterior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.exterior.photorealistic.futuristicGeometricHouse',
		src: 'https://style-presets.cadbos.com/exterior/photorealistic/futuristic-geometric-house.webp',
		mime: 'image/webp'
	},
	{
		id: 'lakeside-a-frame-cabin',
		sceneType: 'exterior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.exterior.photorealistic.lakesideAFrameCabin',
		src: 'https://style-presets.cadbos.com/exterior/photorealistic/lakeside-a-frame-cabin.webp',
		mime: 'image/webp'
	},
	{
		id: 'autumn-colonial-house',
		sceneType: 'exterior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.exterior.photorealistic.autumnColonialHouse',
		src: 'https://style-presets.cadbos.com/exterior/photorealistic/autumn-colonial-house.webp',
		mime: 'image/webp'
	},
	{
		id: 'zen-rock-garden-courtyard',
		sceneType: 'exterior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.exterior.photorealistic.zenRockGardenCourtyard',
		src: 'https://style-presets.cadbos.com/exterior/photorealistic/zen-rock-garden-courtyard.webp',
		mime: 'image/webp'
	},
	{
		id: 'urban-modular-office',
		sceneType: 'exterior',
		category: 'photorealistic',
		label: 'styleTransfer.preset.exterior.photorealistic.urbanModularOffice',
		src: 'https://style-presets.cadbos.com/exterior/photorealistic/urban-modular-office.webp',
		mime: 'image/webp'
	},
	{
		id: 'watercolor-v1',
		sceneType: 'exterior',
		category: 'conceptual',
		label: 'styleTransfer.preset.exterior.conceptual.watercolorV1',
		src: 'https://style-presets.cadbos.com/exterior/conceptual/watercolor-v1.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'watercolor-v2',
		sceneType: 'exterior',
		category: 'conceptual',
		label: 'styleTransfer.preset.exterior.conceptual.watercolorV2',
		src: 'https://style-presets.cadbos.com/exterior/conceptual/watercolor-v2.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'architectural-marker',
		sceneType: 'exterior',
		category: 'conceptual',
		label: 'styleTransfer.preset.exterior.conceptual.architecturalMarker',
		src: 'https://style-presets.cadbos.com/exterior/conceptual/architectural-marker.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'marker-sketch',
		sceneType: 'exterior',
		category: 'conceptual',
		label: 'styleTransfer.preset.exterior.conceptual.markerSketch',
		src: 'https://style-presets.cadbos.com/exterior/conceptual/marker-sketch.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'architectural-pen',
		sceneType: 'exterior',
		category: 'conceptual',
		label: 'styleTransfer.preset.exterior.conceptual.architecturalPen',
		src: 'https://style-presets.cadbos.com/exterior/conceptual/architectural-pen.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'pencil-sketch',
		sceneType: 'exterior',
		category: 'conceptual',
		label: 'styleTransfer.preset.exterior.conceptual.pencilSketch',
		src: 'https://style-presets.cadbos.com/exterior/conceptual/pencil-sketch.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'digital-painting',
		sceneType: 'exterior',
		category: 'conceptual',
		label: 'styleTransfer.preset.exterior.conceptual.digitalPainting',
		src: 'https://style-presets.cadbos.com/exterior/conceptual/digital-painting.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'ink-wash',
		sceneType: 'exterior',
		category: 'conceptual',
		label: 'styleTransfer.preset.exterior.conceptual.inkWash',
		src: 'https://style-presets.cadbos.com/exterior/conceptual/ink-wash.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'ukiyo-e',
		sceneType: 'exterior',
		category: 'conceptual',
		label: 'styleTransfer.preset.exterior.conceptual.ukiyoE',
		src: 'https://style-presets.cadbos.com/exterior/conceptual/ukiyo-e.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'hand-painted-anime',
		sceneType: 'exterior',
		category: 'conceptual',
		label: 'styleTransfer.preset.exterior.conceptual.handPaintedAnime',
		src: 'https://style-presets.cadbos.com/exterior/conceptual/hand-painted-anime.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'bauhaus',
		sceneType: 'exterior',
		category: 'conceptual',
		label: 'styleTransfer.preset.exterior.conceptual.bauhaus',
		src: 'https://style-presets.cadbos.com/exterior/conceptual/bauhaus.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'xerox-collage',
		sceneType: 'exterior',
		category: 'conceptual',
		label: 'styleTransfer.preset.exterior.conceptual.xeroxCollage',
		src: 'https://style-presets.cadbos.com/exterior/conceptual/xerox-collage.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'coloring-book',
		sceneType: 'exterior',
		category: 'conceptual',
		label: 'styleTransfer.preset.exterior.conceptual.coloringBook',
		src: 'https://style-presets.cadbos.com/exterior/conceptual/coloring-book.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'risograph',
		sceneType: 'exterior',
		category: 'conceptual',
		label: 'styleTransfer.preset.exterior.conceptual.risograph',
		src: 'https://style-presets.cadbos.com/exterior/conceptual/risograph.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'risograph-mono',
		sceneType: 'exterior',
		category: 'conceptual',
		label: 'styleTransfer.preset.exterior.conceptual.risographMono',
		src: 'https://style-presets.cadbos.com/exterior/conceptual/risograph-mono.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'white-model',
		sceneType: 'exterior',
		category: 'conceptual',
		label: 'styleTransfer.preset.exterior.conceptual.whiteModel',
		src: 'https://style-presets.cadbos.com/exterior/conceptual/white-model.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'editorial-cartoon',
		sceneType: 'exterior',
		category: 'conceptual',
		label: 'styleTransfer.preset.exterior.conceptual.editorialCartoon',
		src: 'https://style-presets.cadbos.com/exterior/conceptual/editorial-cartoon.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'bw-cinematic',
		sceneType: 'exterior',
		category: 'conceptual',
		label: 'styleTransfer.preset.exterior.conceptual.bwCinematic',
		src: 'https://style-presets.cadbos.com/exterior/conceptual/bw-cinematic.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'parallel-lines',
		sceneType: 'exterior',
		category: 'conceptual',
		label: 'styleTransfer.preset.exterior.conceptual.parallelLines',
		src: 'https://style-presets.cadbos.com/exterior/conceptual/parallel-lines.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'travel-poster',
		sceneType: 'exterior',
		category: 'conceptual',
		label: 'styleTransfer.preset.exterior.conceptual.travelPoster',
		src: 'https://style-presets.cadbos.com/exterior/conceptual/travel-poster.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'zen-ink',
		sceneType: 'exterior',
		category: 'conceptual',
		label: 'styleTransfer.preset.exterior.conceptual.zenInk',
		src: 'https://style-presets.cadbos.com/exterior/conceptual/zen-ink.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'light-wash',
		sceneType: 'exterior',
		category: 'conceptual',
		label: 'styleTransfer.preset.exterior.conceptual.lightWash',
		src: 'https://style-presets.cadbos.com/exterior/conceptual/light-wash.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'lofi-pixel',
		sceneType: 'exterior',
		category: 'conceptual',
		label: 'styleTransfer.preset.exterior.conceptual.lofiPixel',
		src: 'https://style-presets.cadbos.com/exterior/conceptual/lofi-pixel.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'impasto-oil',
		sceneType: 'exterior',
		category: 'conceptual',
		label: 'styleTransfer.preset.exterior.conceptual.impastoOil',
		src: 'https://style-presets.cadbos.com/exterior/conceptual/impasto-oil.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'neutral-technical',
		sceneType: 'exterior',
		category: 'conceptual',
		label: 'styleTransfer.preset.exterior.conceptual.neutralTechnical',
		src: 'https://style-presets.cadbos.com/exterior/conceptual/neutral-technical.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'naive-crayon',
		sceneType: 'exterior',
		category: 'conceptual',
		label: 'styleTransfer.preset.exterior.conceptual.naiveCrayon',
		src: 'https://style-presets.cadbos.com/exterior/conceptual/naive-crayon.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'blueprint',
		sceneType: 'exterior',
		category: 'conceptual',
		label: 'styleTransfer.preset.exterior.conceptual.blueprint',
		src: 'https://style-presets.cadbos.com/exterior/conceptual/blueprint.jpg',
		mime: 'image/jpeg'
	},
	{
		id: 'brutalist',
		sceneType: 'exterior',
		category: 'conceptual',
		label: 'styleTransfer.preset.exterior.conceptual.brutalist',
		src: 'https://style-presets.cadbos.com/exterior/conceptual/brutalist.jpg',
		mime: 'image/jpeg'
	}
];

export function stylePresetsFor(
	sceneType: SceneType,
	category: StylePresetCategory
): StylePreset[] {
	return STYLE_PRESETS.filter(
		(preset) => preset.sceneType === sceneType && preset.category === category
	);
}
