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

import type { LnbitsConfig } from '$lib/server/lnbits';

export function getLnbitsConfig(platform: App.Platform | undefined): LnbitsConfig {
	const baseUrl = platform?.env?.LNBITS_BASE_URL;
	const invoiceKey = platform?.env?.LNBITS_INVOICE_KEY;
	const webhookUrl = platform?.env?.PAYMENTS_WEBHOOK_URL;
	if (!baseUrl || !invoiceKey) throw new Error('LNbits is not configured');
	return { baseUrl, invoiceKey, ...(webhookUrl ? { webhookUrl } : {}) };
}
