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

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { apiError, invoiceActionRequestSchema, invoiceIdSchema, parseBody } from '$lib/server/api';
import { invoiceApi } from '$lib/server/invoice-api';
import { checkoutInvoice } from '$lib/server/invoices';

export const POST: RequestHandler = (event) =>
	invoiceApi(event, 'checkout', async (db, userId) => {
		if (!invoiceIdSchema.safeParse(event.params.id).success) {
			return apiError(400, 'invalid_request', 'Invalid invoice ID');
		}
		const parsed = await parseBody(event.request, invoiceActionRequestSchema);
		if (!parsed.ok) return parsed.response;
		return json(await checkoutInvoice(db, event.platform, userId, event.params.id));
	});
