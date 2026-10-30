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

import { CreditCard, Wallet } from '@lucide/svelte';
import { t, type TranslationKey } from '$lib/i18n/index.svelte';

interface ProcessorLabelKeys {
	name: TranslationKey;
	description: TranslationKey;
	icon: typeof CreditCard;
}

const labels: Record<string, ProcessorLabelKeys> = {
	robokassa: {
		name: 'topUp.processor.robokassa.name',
		description: 'topUp.processor.robokassa.description',
		icon: CreditCard
	}
};

export interface ProcessorLabel {
	name: string;
	description: string | null;
	icon: typeof CreditCard;
}

export function processorLabel(id: string): ProcessorLabel {
	const keys = labels[id];
	return keys
		? { name: t(keys.name), description: t(keys.description), icon: keys.icon }
		: { name: id, description: null, icon: Wallet };
}
