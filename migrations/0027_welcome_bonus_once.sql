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

-- The welcome bonus is a single ledger credit with reason 'welcome-bonus'. Its
-- presence is what hides the request button, so a second one for the same
-- account must be rejected rather than silently double-funding it.
CREATE UNIQUE INDEX ledger_entries_welcome_bonus_once
ON ledger_entries (user_id) WHERE reason = 'welcome-bonus';
