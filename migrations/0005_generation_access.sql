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

-- Turns `credits` (0004) from "a couple of metered test accounts, everyone
-- else unlimited" into the access-control gate for generation: from this
-- point on, an account can render/edit only if it has a row here, and
-- `enabled` lets the admin revoke that access without losing the balance or
-- spend history. There is no self-service sign-up path — rows are inserted
-- by hand.
--
-- Admin workflow (wrangler d1 execute DB --remote --command "..."):
--   -- the user must have logged in at least once so a `users` row exists
--   SELECT id, pubkey FROM users;
--
--   -- grant access with a chosen limit (units match archAI's own cost/balance)
--   INSERT INTO credits (user_id, balance, updated_at, enabled)
--   VALUES ('<user_id>', 12, unixepoch() * 1000, 1);
--
--   -- revoke access without losing balance/history
--   UPDATE credits SET enabled = 0 WHERE user_id = '<user_id>';
--
--   -- re-grant, or change the remaining limit
--   UPDATE credits SET enabled = 1, balance = 12 WHERE user_id = '<user_id>';
ALTER TABLE credits ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
