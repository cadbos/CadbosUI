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
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/auth/repository';
import { touchRateLimit } from '$lib/server/auth/rate-limit';
import { reconcileDeposit } from '$lib/server/deposit-reconciliation';
import { getLnbitsConfig } from '$lib/server/payment-config';
import { getDepositByCheckingId, getDepositByPaymentHash } from '$lib/server/payments';

const WEBHOOK_RATE_LIMIT = { windowMs: 60_000, max: 120 } as const;
const webhookSchema = z
	.looseObject({
		checking_id: z.string().min(1).optional(),
		payment_hash: z
			.string()
			.regex(/^[0-9a-f]{64}$/i)
			.optional()
	})
	.refine((value) => value.checking_id !== undefined || value.payment_hash !== undefined);

export const POST: RequestHandler = async ({ request, platform, getClientAddress }) => {
	const db = getDb(platform);
	if (
		await touchRateLimit(db, `lnbits-webhook:${getClientAddress()}`, Date.now(), WEBHOOK_RATE_LIMIT)
	) {
		return new Response(null, { status: 429 });
	}
	const parsed = webhookSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return json({ accepted: true }, { status: 202 });

	const deposit = parsed.data.checking_id
		? await getDepositByCheckingId(db, parsed.data.checking_id)
		: await getDepositByPaymentHash(db, parsed.data.payment_hash ?? '');
	if (!deposit) return json({ accepted: true }, { status: 202 });

	try {
		await reconcileDeposit(db, deposit, getLnbitsConfig(platform));
	} catch (error) {
		console.error('LNbits webhook reconciliation failed:', {
			errorName: error instanceof Error ? error.name : 'Error'
		});
	}
	return json({ accepted: true }, { status: 202 });
};
