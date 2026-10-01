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

-- Administrators, replacing the ADMIN_PUBKEYS environment variable. A row
-- here grants its user access to the admin-only usage views (/usage and
-- /api/usage*). Rows reference `users`, so an account must have logged in at
-- least once before it can be made an administrator. There is no self-service
-- path — rows are managed by hand.
--
-- Admin workflow (wrangler d1 execute DB --remote --command "..."), with the
-- pubkey as 64-character lowercase hex (convert an npub first):
--   -- grant (inserts nothing if the pubkey has never logged in)
--   INSERT INTO admins (user_id) SELECT id FROM users WHERE pubkey = '<pubkey>';
--
--   -- revoke
--   DELETE FROM admins WHERE user_id = (SELECT id FROM users WHERE pubkey = '<pubkey>');
--
--   -- list
--   SELECT u.pubkey FROM admins a JOIN users u ON u.id = a.user_id;
CREATE TABLE admins (
	user_id TEXT PRIMARY KEY NOT NULL REFERENCES users (id),
	created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
