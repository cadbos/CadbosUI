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

INSERT INTO users (id, pubkey, first_name, last_name, created_at)
VALUES ('paid-flow-user', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'Ada', 'Lovelace', 1000);

INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent)
VALUES ('paid-flow-session', 'paid-flow-user', 1000, 4102444800000, 'Playwright');

INSERT INTO ledger_accounts (id, asset, user_id, created_at)
VALUES ('app-credit:paid-flow-user', 'app_credit', 'paid-flow-user', 1000);

INSERT INTO ledger_transactions (id, occurred_at)
VALUES ('opening:app-credit:paid-flow-user', 1000);

INSERT INTO ledger_entries (transaction_id, account_id, amount)
VALUES ('opening:app-credit:paid-flow-user', 'app-credit:paid-flow-user', 2000);

INSERT INTO ledger_openings (account_id, transaction_id)
VALUES ('app-credit:paid-flow-user', 'opening:app-credit:paid-flow-user');

UPDATE ledger_transactions
SET finalized = 1
WHERE id = 'opening:app-credit:paid-flow-user';

INSERT INTO generation_access (user_id, enabled)
VALUES ('paid-flow-user', 1);
