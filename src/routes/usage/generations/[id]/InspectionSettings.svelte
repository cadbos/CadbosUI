<!--
Copyright (c) 2026 Cadbos company. All rights reserved.

SPDX-License-Identifier: LicenseRef-Cadbos-BSL-1.1

Cadbos Interior Design AI is licensed under the Business Source License 1.1.
Access is limited to automated analysis tools for analysis of this repository.
This code is not open for contribution or usage except under a separate written
agreement with Cadbos company.

Commercial use in Interior Design & AEC Generative AI Services is prohibited
before the Change Date. See LICENSE for complete terms.
-->

<script lang="ts">
	import type { AdminGenerationDetailResponse, ImageInput } from '$lib/api/contract';
	import { t, type TranslationKey } from '$lib/i18n/index.svelte';
	import { LIGHT_SETTINGS_PRESETS } from '$lib/light-settings-presets';
	import { PHOTO_ADJUSTMENT_GROUPS } from '$lib/photo-adjustments';
	import { STYLE_PRESETS } from '$lib/style-presets';
	import InspectionImage from './InspectionImage.svelte';

	let { detail }: { detail: AdminGenerationDetailResponse } = $props();
	const snapshot = $derived(detail.formSnapshot);
	const region = $derived(
		detail.kind === 'repaint'
			? snapshot?.repaintRegion
			: detail.kind === 'object-replacement'
				? snapshot?.objectReplacementRegion
				: null
	);
	const references = $derived.by(() => {
		const items: { label: string; image: ImageInput }[] = [];
		if (detail.kind === 'style-transfer' && snapshot?.styleReferenceImage)
			items.push({ label: t('adminGeneration.reference'), image: snapshot.styleReferenceImage });
		if (detail.kind === 'object-replacement' && snapshot?.objectReferenceImage)
			items.push({ label: t('adminGeneration.reference'), image: snapshot.objectReferenceImage });
		if (detail.kind === 'texture-replacement' && snapshot?.textureReferenceImage)
			items.push({ label: t('adminGeneration.reference'), image: snapshot.textureReferenceImage });
		if (detail.kind === 'texture-replacement' && snapshot?.textureMaskImage)
			items.push({ label: t('textureReplacement.maskImage'), image: snapshot.textureMaskImage });
		return items;
	});
	const hasSnapshotReference = $derived(
		references.some((item) => item.label === t('adminGeneration.reference'))
	);
	function inputUrl(image: ImageInput): string | null {
		if ('mediaKey' in image)
			return detail.media.find((access) => access.key === image.mediaKey)?.url ?? null;
		return STYLE_PRESETS.find((preset) => preset.id === image.stylePresetId)?.src ?? null;
	}
	function presetLabel(image: ImageInput): string | null {
		if ('mediaKey' in image) return null;
		const preset = STYLE_PRESETS.find((candidate) => candidate.id === image.stylePresetId);
		return preset ? t(preset.label) : image.stylePresetId;
	}
	const rows = $derived.by(() => {
		if (!snapshot) return [];
		const percentNumber = new Intl.NumberFormat('en-US', {
			useGrouping: false,
			maximumFractionDigits: 12
		});
		const items: { label: string; value: string; numeric?: boolean }[] = [
			{
				label: t('render.sceneType.label'),
				value: t(
					snapshot.sceneType === 'interior'
						? 'render.sceneType.interior'
						: 'render.sceneType.exterior'
				)
			},
			{ label: t('render.outputFormat'), value: snapshot.outputFormat.toUpperCase() }
		];
		const add = (label: TranslationKey, value: string, numeric = false): void => {
			items.push({ label: t(label), value: value || t('adminGeneration.none'), numeric });
		};
		if (detail.kind === 'render') {
			add(
				'render.autoEnhance.label',
				t(snapshot.autoEnhance ? 'adminGeneration.yes' : 'adminGeneration.no')
			);
			if (snapshot.promptOverride !== null)
				add('adminGeneration.promptOverride', snapshot.promptOverride);
			for (const fragment of [...snapshot.promptFragments].sort((a, b) => a.order - b.order))
				items.push({
					label: fragment.label || t('adminGeneration.promptFragments'),
					value: fragment.text || t('adminGeneration.none')
				});
		} else if (detail.kind === 'edit') {
			if (snapshot.editOperationType === 'add-object')
				add('edit.addObject.customLabel', snapshot.addObjectInstruction);
			else if (snapshot.editOperationType === 'remove-object')
				add('edit.removeObject.label', snapshot.removeObjectText);
			else add('edit.instruction', snapshot.editPrompt);
		} else if (detail.kind === 'style-transfer') {
			add('styleTransfer.guidance', snapshot.styleTransferPrompt);
			add(
				'styleTransfer.strength',
				`${percentNumber.format(snapshot.styleTransferStrength * 100)}%`,
				true
			);
			add('styleTransfer.negativePrompt', snapshot.styleNegativePrompt);
		} else if (detail.kind === 'object-replacement') {
			add('objectReplacement.objectLabel', snapshot.objectReplacementObject);
			add(
				'objectReplacement.scale',
				`${percentNumber.format(snapshot.objectReplacementScale * 100)}%`,
				true
			);
		} else if (detail.kind === 'texture-replacement') {
			add(
				'textureReplacement.maskImage',
				t(snapshot.textureReplacementMasked ? 'adminGeneration.yes' : 'adminGeneration.no')
			);
			if (!snapshot.textureReplacementMasked)
				add('textureReplacement.surfaceLabel', snapshot.textureReplacementSurface);
		} else if (detail.kind === 'light-settings') {
			add(
				'lightSettings.moodSectionLabel',
				snapshot.lightSettingsPresetIds
					.map((id) => {
						const preset = LIGHT_SETTINGS_PRESETS.find((candidate) => candidate.id === id);
						return preset ? t(preset.label) : id;
					})
					.join(', ')
			);
			add('lightSettings.customLabel', snapshot.lightSettingsInstruction);
		} else if (detail.kind === 'repaint') {
			add('repaint.targetLabel', snapshot.repaintTarget);
			add('repaint.colorLabel', snapshot.repaintColor);
		}
		if (region)
			add(
				'adminGeneration.regionCoordinates',
				[region.x, region.y, region.width, region.height]
					.map((value) => `${percentNumber.format(value * 100)}%`)
					.join(', '),
				true
			);
		if (
			(detail.kind === 'photo-processing' || detail.kind === 'upscale') &&
			snapshot.photoAdjustments
		) {
			for (const group of PHOTO_ADJUSTMENT_GROUPS)
				for (const key of group.keys)
					add(`photoProcessing.adjustment.${key}`, String(snapshot.photoAdjustments[key]), true);
		}
		return items;
	});
</script>

<section class="settings" aria-labelledby="inspection-settings-title">
	<h2 id="inspection-settings-title">{t('adminGeneration.settings')}</h2>
	{#if snapshot}
		<dl>
			{#each rows as row, index (index)}
				<div class={{ numeric: row.numeric }}>
					<dt>{row.label}</dt>
					<dd>{row.value}</dd>
				</div>
			{/each}
		</dl>
	{:else}
		<p>{t('adminGeneration.settingsUnavailable')}</p>
	{/if}
</section>

<section class="inputs" aria-labelledby="inspection-inputs-title">
	<h2 id="inspection-inputs-title">{t('adminGeneration.inputs')}</h2>
	<figure>
		<figcaption>{t('usage.generations.column.source')}</figcaption>
		<InspectionImage
			src={detail.source?.url ?? null}
			alt={t('usage.generations.column.source')}
			{region}
		/>
	</figure>
	{#each references as reference, index (index)}
		<figure>
			<figcaption>{reference.label}</figcaption>
			{#if presetLabel(reference.image)}<p>{presetLabel(reference.image)}</p>{/if}
			<InspectionImage src={inputUrl(reference.image)} alt={reference.label} />
		</figure>
	{/each}
	{#if detail.hasReference && !hasSnapshotReference}
		<figure>
			<figcaption>{t('adminGeneration.reference')}</figcaption>
			<InspectionImage src={detail.reference?.url ?? null} alt={t('adminGeneration.reference')} />
		</figure>
	{/if}
</section>

<style>
	.settings,
	.inputs {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	h2 {
		margin: 0;
		font-size: 1rem;
		font-weight: 700;
	}
	dl {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		margin: 0;
	}
	dt,
	figcaption {
		color: var(--color-muted);
		font-size: 0.8125rem;
		font-weight: 650;
	}
	dd {
		margin: 0.25rem 0 0;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		font-size: 0.9375rem;
	}
	.numeric {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	figure {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	p {
		margin: 0;
		color: var(--color-muted);
		overflow-wrap: anywhere;
	}
</style>
