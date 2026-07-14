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

// Disables access to DOM typings like `HTMLElement` which are not available
// inside a service worker and instantiates the correct globals.
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

// Deliberately minimal: no fetch handler, no offline caching. This worker
// exists only so the app satisfies PWA installability (a registered service
// worker + a valid manifest.webmanifest) and has a scope, so links opened
// while the installed PWA is running are handled by SvelteKit's own routing
// instead of escaping to the browser. All navigation still goes through the
// network — nothing here intercepts `fetch`.
const worker = self as unknown as ServiceWorkerGlobalScope;

worker.addEventListener('install', () => {
	worker.skipWaiting();
});

worker.addEventListener('activate', (event) => {
	event.waitUntil(worker.clients.claim());
});
