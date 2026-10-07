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
	import {
		FolderKanban,
		GalleryHorizontalEnd,
		Images,
		Layers,
		Palette,
		Pencil,
		Share2,
		Sparkles
	} from '@lucide/svelte';
	import { afterNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { PathnameWithSearchOrHash } from '$app/types';
	import { page } from '$app/state';
	import { t, type TranslationKey } from '$lib/i18n/index.svelte';
	import FloatingToolsPanel from '$lib/components/FloatingToolsPanel.svelte';
	import GenerateButton from '$lib/components/GenerateButton.svelte';
	import { toolsPanel } from '$lib/state/tools-panel.svelte';
	import ImageUpload from '$lib/components/ImageUpload.svelte';
	import RenderResult from '$lib/components/RenderResult.svelte';
	import EditPanel from '$lib/components/EditPanel.svelte';
	import MaskEditor from '$lib/components/MaskEditor.svelte';
	import PromptViews from '$lib/components/PromptViews.svelte';
	import ScenesDrawer from '$lib/components/ScenesDrawer.svelte';
	import ShareProjectDialog from '$lib/components/ShareProjectDialog.svelte';
	import StyleTransferPanel from '$lib/components/StyleTransferPanel.svelte';
	import WorkspaceTabBar from '$lib/components/WorkspaceTabBar.svelte';
	import SessionTabBar from '$lib/components/SessionTabBar.svelte';
	import {
		creditErrorKey,
		extractApiErrorCode,
		renderResultFromResponse,
		request,
		RequestImageUploadError,
		type GenerationAnchor,
		type RequestState,
		type SceneType
	} from '$lib/state/request.svelte';
	import { auth } from '$lib/state/auth.svelte';
	import { generatedImages } from '$lib/state/generated-images.svelte';
	import { generationOverlay } from '$lib/state/generation-overlay.svelte';
	import type { OutputFormat } from '$lib/state/request.svelte';
	import { fetchGeneratedImageDetail } from '$lib/state/generation-restore';
	import { fetchProjectDetail } from '$lib/state/project-detail.svelte';
	import {
		initializeGenerationPreview,
		initializeSessionState,
		restorePersistedTabs,
		SCRATCH_TAB_ID,
		workspaceTabs,
		type OpenProjectParams
	} from '$lib/state/workspace-tabs.svelte';
	import {
		applyShareParams,
		buildShareUrl,
		buildWorkspaceUrl,
		generationAnchorFromSearch,
		projectSessionFromSearch,
		renderOrigin,
		routeIdToMode,
		slugToTool,
		subTabFromSearch,
		withProjectSession,
		type Mode
	} from '$lib/state/url-state';
	import { createTabController, logBoundaryError } from '$lib/utils';

	const modes = [
		{ id: 'render', label: 'mode.render', description: 'render.panelDescription', icon: Sparkles },
		{ id: 'edit', label: 'mode.edit', description: 'edit.panelDescription', icon: Pencil },
		{
			id: 'styleTransfer',
			label: 'mode.styleTransfer',
			description: 'styleTransfer.panelDescription',
			icon: Palette
		}
	] satisfies {
		id: Mode;
		label: TranslationKey;
		description: TranslationKey;
		icon: typeof Sparkles;
	}[];

	const sceneTypes: { id: SceneType; label: TranslationKey }[] = [
		{ id: 'interior', label: 'render.sceneType.interior' },
		{ id: 'exterior', label: 'render.sceneType.exterior' }
	];

	let submitting = $state(false);
	let submitError = $state<string | null>(null);
	let modeTabs = $state<(HTMLElement | null)[]>([]);
	let sceneTypeTabs = $state<HTMLElement[]>([]);
	let scenesOpen = $state(false);
	let scenesTrigger: HTMLButtonElement | null = null;
	let shareOpen = $state(false);
	let shareTrigger: HTMLButtonElement | null = null;

	// The URL is the source of truth for which mode is open — not local $state —
	// so a shared link or a page reload always opens on the right tab. Null on
	// the workspace root: nothing is selected until the user picks a mode.
	const mode = $derived(routeIdToMode(page.route.id));

	const modeTabController = createTabController({
		itemCount: () => modes.length,
		getActiveIndex: () => modes.findIndex((m) => m.id === mode),
		setActiveIndex: (index) => {
			// No sub-tab passed: switching modes has no "current" sub-tab to carry
			// over from a different mode, so each mode opens on its own default.
			// Pushes a history entry (unlike the sub-tab/settings navigations
			// below) so Back/Forward actually steps through Create/Edit/Style
			// transfer/Object replacement, matching what a dedicated URL per mode implies.
			// buildWorkspaceUrl carries project/session/generation over explicitly
			// (see its own doc comment) instead of navigating to the bare
			// buildShareUrl() result first and letting the debounced URL-sync
			// effect below patch them back in a moment later.
			return goto(
				resolve(buildWorkspaceUrl(modes[index].id, request) as PathnameWithSearchOrHash, {}),
				{
					replaceState: false,
					keepFocus: true,
					noScroll: true
				}
			).catch((error: unknown) => logBoundaryError('workspace.modeNavigation', error));
		},
		focusTab: (index) => modeTabs[index]?.focus()
	});

	const sceneTypeTabController = createTabController({
		itemCount: () => sceneTypes.length,
		getActiveIndex: () => sceneTypes.findIndex((s) => s.id === request.sceneType),
		setActiveIndex: (index) => {
			request.setSceneType(sceneTypes[index].id);
		},
		focusTab: (index) => sceneTypeTabs[index]?.focus()
	});

	const isAuthenticated = $derived(auth.status === 'authenticated');
	// Only shown once a real project tab is open — the scratch tab itself is
	// never rendered (see WorkspaceTabBar.svelte), so without one the strip
	// would be empty.
	const showWorkspaceTabs = $derived(workspaceTabs.tabs.some((tab) => tab.id !== SCRATCH_TAB_ID));
	// The scratch tab never has sessions (see workspace-tabs.svelte.ts), and a
	// just-opened project tab always carries at least one — so this is really
	// just "is a real project the active tab", spelled out defensively.
	const showSessionTabs = $derived(
		workspaceTabs.activeTabId !== SCRATCH_TAB_ID && workspaceTabs.activeSessionTabs.length > 0
	);
	// Only reserves canvas space while the floating tools panel is both open
	// and still sitting at its untouched default corner — the moment the user
	// drags it elsewhere or collapses it, the canvas reclaims the full width
	// rather than keeping a permanent gap for a panel that's no longer there.
	const toolsPanelAtDefaultCorner = $derived(toolsPanel.open && toolsPanel.position === null);
	const validation = $derived(request.validate());
	const canGenerate = $derived(validation.valid && !submitting && request.status !== 'rendering');

	const activeEditTool = $derived(slugToTool(page.url.searchParams.get('tool') ?? undefined));

	// While drawing a texture-replacement mask, the canvas shows the mask
	// editor's own drawing surface instead of the plain upload/result — so the
	// user paints directly on the image they're already looking at, not a
	// duplicate copy inside the panel. `activeEditTool`/`request.textureReplacementMasked`
	// are enough to derive this without any prop-drilling through EditPanel.
	const showMaskOnCanvas = $derived(
		mode === 'edit' &&
			activeEditTool === 'texture-replacement' &&
			request.textureReplacementMasked &&
			!request.textureReplacementResultReady
	);
	const maskEditorLocked = $derived(
		request.textureMaskUploading || request.activeTextureReplacementJobId !== undefined
	);

	$effect(() => {
		if (auth.canLoadGeneratedImages) void generatedImages.load();
		else generatedImages.clear();
	});

	// The mask editor needs a real, stable server URL (not a local blob:
	// preview) to draw on — see resolveWorkingImageKey().
	// Entering masked mode resolves the deferred main-photo upload eagerly
	// instead of waiting for the texture-replacement submit itself.
	$effect(() => {
		if (showMaskOnCanvas) {
			request
				.resolveWorkingImageKey()
				.catch((error: unknown) => logBoundaryError('workspace.maskEditorSourceUpload', error));
		}
	});

	function openScenes(): void {
		scenesOpen = true;
		void generatedImages.loadFilterOptions();
	}

	function closeScenes(): void {
		scenesOpen = false;
		requestAnimationFrame(() => scenesTrigger?.focus());
	}

	function closeShare(): void {
		shareOpen = false;
		requestAnimationFrame(() => shareTrigger?.focus());
	}

	// True once the request store has been hydrated from the URL at least once
	// (see afterNavigate below). Gates the write-sync effect so it can't fire —
	// and overwrite the shared link's query string with defaults — before that
	// initial hydration has run.
	let hydrated = $state(false);

	// Where the address bar's own project/session/generation target stands:
	// 'loading' while it's still being fetched, 'failed' when that fetch hit a
	// connection problem rather than a dead link (see fetchProjectDetail). The
	// URL-sync effect below stays paused in both: until the target is on
	// screen, the workspace still holds whatever was open before — the blank
	// scratch tab, on a reload or a duplicated browser tab — and syncing that
	// would overwrite the very link that's still being opened.
	let urlTargetStatus = $state<'idle' | 'loading' | 'failed'>('idle');
	// What Retry re-runs after a 'failed' target.
	let retryUrlTarget: (() => Promise<void>) | null = null;

	// Bumped at the start of every URL-target resolution so a slower one from
	// an earlier navigation can't clobber a faster later one — same guard
	// shape as request.svelte.ts's #projectSessionEpoch.
	let urlTargetEpoch = 0;

	// Resolves a project/session pair carried in the URL (see url-state.ts's
	// projectSessionFromSearch) into the workspace tab to open for it — the
	// same fetch-then-initialize continueSession (projects/[id]/+page.svelte)
	// does on a click, just triggered by a deep link instead. A
	// `?generation=` anchor reopens that exact result — or, with
	// `step=before`, the image it was made from, one undo away — form
	// included, rather than the session's latest state; one that's gone or belongs to another
	// session degrades to the session itself, and an unowned, archived or
	// just wrong project/session resolves to null, leaving the workspace on
	// whatever it already had open. The URL's own form fields (prompt, tool
	// settings, a still-polling job) are layered on last, so the opened tab
	// shows exactly what the link describes.
	async function resolveUrlTarget(
		searchParams: URLSearchParams
	): Promise<OpenProjectParams | null> {
		const target = projectSessionFromSearch(searchParams);
		if (!target) return null;
		const urlMode = mode;
		const sceneParam = page.params.scene;
		const applyUrlFields = (state: RequestState): void => {
			if (urlMode !== null) applyShareParams(urlMode, sceneParam, searchParams, state);
		};

		const anchor = generationAnchorFromSearch(searchParams);
		const generation = anchor ? await fetchGeneratedImageDetail(anchor.generationId) : null;
		if (
			generation?.session?.projectId === target.projectId &&
			generation.session.sessionId === target.sessionId
		) {
			const { session } = generation;
			return {
				projectId: session.projectId,
				projectTitle: session.projectTitle,
				sessionId: session.sessionId,
				sessionTitle: session.sessionTitle.trim() === '' ? null : session.sessionTitle,
				initialize: (state) => {
					initializeGenerationPreview(state, generation);
					// The image this generation was made from is the step right
					// before it in the history just seeded — one undo away.
					if (anchor?.step === 'before') state.undoLastEdit();
					applyUrlFields(state);
				}
			};
		}

		const project = await fetchProjectDetail(target.projectId);
		if (!project) return null;
		const session = project.sessions.find((candidate) => candidate.id === target.sessionId);
		if (!session) return null;
		return {
			projectId: project.id,
			projectTitle: project.title,
			sessionId: session.id,
			sessionTitle: session.title.trim() === '' ? null : session.title,
			initialize: (state) => {
				initializeSessionState(state, project.id, session);
				applyUrlFields(state);
			}
		};
	}

	// Runs one URL-target resolution under urlTargetStatus, opening its result
	// only if no later navigation has started a resolution of its own since.
	async function trackUrlTarget(load: () => Promise<OpenProjectParams | null>): Promise<void> {
		urlTargetEpoch += 1;
		const epoch = urlTargetEpoch;
		urlTargetStatus = 'loading';
		retryUrlTarget = null;
		try {
			const params = await load();
			if (epoch !== urlTargetEpoch) return;
			if (params) workspaceTabs.openProject(params);
			urlTargetStatus = 'idle';
		} catch (error) {
			logBoundaryError('workspace.urlTarget', error);
			if (epoch !== urlTargetEpoch) return;
			urlTargetStatus = 'failed';
			retryUrlTarget = () => trackUrlTarget(load);
		}
	}

	// Drops any in-flight or failed resolution — the URL no longer points at
	// it, so neither its result nor its error belongs on screen any more.
	function settleUrlTarget(): void {
		urlTargetEpoch += 1;
		urlTargetStatus = 'idle';
		retryUrlTarget = null;
	}

	// Applies the URL's project/session (if present and not already what's on
	// screen) on top of whatever's currently open — for every popstate/link
	// navigation after the initial load, so a pasted/bookmarked link always
	// wins over whatever was already open. Still re-applies when only the
	// generation anchor changed (e.g. Back to an earlier result within the
	// same project/session), not just when the project/session pair did.
	function sameGenerationAnchor(
		a: GenerationAnchor | null | undefined,
		b: GenerationAnchor | null | undefined
	): boolean {
		return a?.generationId === b?.generationId && a?.step === b?.step;
	}

	function applyUrlTarget(searchParams: URLSearchParams): Promise<void> {
		const target = projectSessionFromSearch(searchParams);
		const alreadyShown =
			target !== null &&
			target.projectId === workspaceTabs.activeTabId &&
			target.sessionId === workspaceTabs.activeTab.activeSessionTabId &&
			sameGenerationAnchor(generationAnchorFromSearch(searchParams), request.generationAnchor);
		if (!target || alreadyShown) {
			settleUrlTarget();
			return Promise.resolve();
		}
		return trackUrlTarget(() => resolveUrlTarget(searchParams));
	}

	// The initial hard load — a reload, an opened link, a duplicated browser
	// tab. Restores every previously open tab (restorePersistedTabs is
	// idempotent and already kicked off by the root layout's own onMount, so
	// this just awaits that same result — see there for why restoration
	// can't wait for Workspace.svelte specifically to mount) while fetching
	// the URL's own target in parallel, then opens that target on top: a
	// shared link wins over whatever was locally open before, while the rest
	// of the restored tabs stay open in the background. Always re-opens the
	// target even when the restored tabs already made it active — a restored
	// tab only carries the session's latest state, not the exact result and
	// form fields the URL describes.
	function hydrateWorkspaceTabs(searchParams: URLSearchParams): Promise<void> {
		if (!projectSessionFromSearch(searchParams)) return restorePersistedTabs();
		return trackUrlTarget(async () => {
			// Restoring the other tabs is a side job here: its failure is logged
			// but must not discard (or, through its cached promise, keep failing
			// every retry of) the target the address bar actually points at.
			const [, params] = await Promise.all([
				restorePersistedTabs().catch((error: unknown) =>
					logBoundaryError('workspace.restorePersistedTabs', error)
				),
				resolveUrlTarget(searchParams)
			]);
			return params;
		});
	}

	function retryOpeningUrlTarget(): void {
		retryUrlTarget?.().catch((error: unknown) =>
			logBoundaryError('workspace.retryUrlTarget', error)
		);
	}

	// afterNavigate also runs once when this component mounts (type 'enter'), so
	// it covers both the initial load of a shared link and later browser
	// back/forward or external-link navigation. It only ever fires client-side,
	// after hydration has already reconciled against the server-rendered HTML —
	// unlike a synchronous call in the component body, applying URL state here
	// can't cause a hydration mismatch. 'goto' is deliberately excluded: that's
	// the type of the navigations *we* trigger below and in the tab controllers,
	// where `request` is already the source of truth and re-parsing the URL
	// would be redundant.
	afterNavigate(({ type }) => {
		if ((type === 'enter' || type === 'popstate' || type === 'link') && mode !== null) {
			applyShareParams(mode, page.params.scene, page.url.searchParams, request);
		}
		if (type === 'enter') {
			// Only a genuine hard load restores the full tab set — an in-app
			// 'popstate'/'link' navigation means workspaceTabs already has
			// everything it should (see hydrateWorkspaceTabs's own comment).
			hydrateWorkspaceTabs(page.url.searchParams).catch((error: unknown) =>
				logBoundaryError('workspace.hydrateWorkspaceTabs', error)
			);
		} else if (type === 'popstate' || type === 'link') {
			applyUrlTarget(page.url.searchParams).catch((error: unknown) =>
				logBoundaryError('workspace.applyUrlTarget', error)
			);
		}
		hydrated = true;
	});

	// Keeps the URL in sync with the current mode/request so the address bar is
	// always a shareable link for what's on screen. Debounced so typing in a
	// prompt fragment doesn't rewrite the URL on every keystroke.
	//
	// The synchronous `buildShareUrl(mode, request)` call below (result
	// discarded) exists purely so this effect *tracks* mode/request as
	// dependencies and re-schedules the timer whenever they change — that's
	// what makes the debounce reactive at all. The URL actually used to
	// navigate is rebuilt fresh *inside* the timeout instead of reusing that
	// value, for two reasons: the sub-tab (view/tool/reference) has no backing
	// store field, so it can only be read off the current query string (a
	// plain DOM read, not a reactive `page` read, so it can't turn this effect
	// into a feedback loop with the `goto()` call below); and reusing a value
	// computed up front would go stale if the user changes the sub-tab (e.g.
	// clicks the Graph tab) while a request-field debounce from a moment
	// earlier is still pending — the timer would then fire with the *old*
	// sub-tab and clobber the switch by navigating back to it.
	//
	// activeProjectId/activeSessionId are read synchronously too (alongside
	// the buildShareUrl call above), for the same dependency-tracking reason:
	// switching workspace tabs is a workspaceTabs mutation that buildShareUrl
	// itself never reads (see its own doc comment), so without reading them
	// here directly, switching tabs wouldn't re-schedule this effect at all.
	// On the root there is no mode to serialize — buildShareUrl is skipped so
	// this effect cannot invent /create — but those same reads still run, so
	// a project restored after a reload (or still open after the logo link
	// lands on /) is written as /?project=&session=&generation= once it is
	// on screen.
	// generationAnchor rides along the same way, so the `?generation=`
	// anchor (see request.svelte.ts) always names what's on screen — a stored
	// generation, or with `step=before` the image one was made from — moving
	// with every new generation, edit, undo and redo, so a reload or a
	// duplicated browser tab reopens that exact step.
	//
	// Paused while the URL's own target is still loading or has failed (see
	// urlTargetStatus): the workspace doesn't show that target yet, so
	// syncing would replace the link being opened with whatever is on screen
	// in the meantime.
	$effect(() => {
		if (!hydrated || urlTargetStatus !== 'idle') return;
		const activeMode = mode;
		const activeProjectId =
			workspaceTabs.activeTabId !== SCRATCH_TAB_ID ? workspaceTabs.activeTabId : undefined;
		const activeSessionId = workspaceTabs.activeTab.activeSessionTabId ?? undefined;
		const generationAnchor = request.generationAnchor;
		if (activeMode !== null) buildShareUrl(activeMode, request);
		const timer = setTimeout(() => {
			const currentSearch = new URLSearchParams(window.location.search);
			const base =
				activeMode === null
					? '/'
					: buildShareUrl(activeMode, request, subTabFromSearch(activeMode, currentSearch));
			const url = withProjectSession(base, activeProjectId, activeSessionId, generationAnchor);
			if (`${window.location.pathname}${window.location.search}` !== url) {
				goto(resolve(url as PathnameWithSearchOrHash, {}), {
					replaceState: true,
					keepFocus: true,
					noScroll: true
				}).catch((error: unknown) => logBoundaryError('workspace.urlSync', error));
			}
		}, 400);
		return () => clearTimeout(timer);
	});

	// ensureProjectSession() (request.svelte.ts) can lazily create a real
	// project+session while the scratch tab is live (the first generation from
	// a never-visited project), but only ever updates `request` — nothing
	// tells workspaceTabs, so the URL-sync effect above keeps treating the
	// live tab as scratch and never writes the new ids into the address bar.
	// Promotes the scratch tab into a real project tab the moment that
	// happens; a no-op once it already has (see adoptScratchSession).
	$effect(() => {
		if (workspaceTabs.activeTabId === SCRATCH_TAB_ID && request.projectId && request.sessionId) {
			workspaceTabs.adoptScratchSession(
				request.projectId,
				t('workspace.tabs.untitled'),
				request.sessionId,
				null
			);
		}
	});

	// Keeps the active mode/tool in lockstep with whichever render undo/redo
	// (RenderResult.svelte's toolbar) is currently showing. Each step's
	// restored form fields only make sense under the mode/tool that actually
	// produced it (request.svelte.ts's RequestFormSnapshot) — without this,
	// stepping back to a freeform edit while still looking at, say, the Add
	// object tab would show that tab's leftover fields as if they belonged to
	// the freeform step. Tracks only the render's own id, not mode/
	// activeEditTool themselves — switching tabs by hand must never be
	// mistaken for "the step changed" and snapped back.
	let lastSyncedRenderId: string | undefined;
	$effect(() => {
		if (!hydrated) return;
		const renderId = request.currentRender?.id;
		if (renderId === lastSyncedRenderId) return;
		lastSyncedRenderId = renderId;
		const origin = renderOrigin(request.currentRender);
		if (!origin) return;
		if (origin.mode === mode && (origin.mode !== 'edit' || origin.tool === activeEditTool)) {
			return;
		}
		goto(
			resolve(
				buildWorkspaceUrl(
					origin.mode,
					request,
					origin.tool ? { tool: origin.tool } : {}
				) as PathnameWithSearchOrHash,
				{}
			),
			{
				replaceState: true,
				keepFocus: true,
				noScroll: true
			}
		).catch((error: unknown) => logBoundaryError('workspace.renderOriginSync', error));
	});

	async function generate(): Promise<void> {
		if (!canGenerate) return;
		submitting = true;
		submitError = null;
		request.setStatus('rendering');
		// Captured before the upload/fetch below (both async) so the settings
		// attached to this render are what was actually submitted — not
		// whatever the user has since typed, if they kept editing the form
		// while this request was still in flight.
		const formSnapshot = request.captureFormSnapshot();
		const overlayId = generationOverlay.start('generationOverlay.render');
		try {
			const body = await request.toRenderRequest();
			if (!body) {
				request.setStatus('idle');
				return;
			}
			const endpoint = request.sceneType === 'exterior' ? '/api/render/exterior' : '/api/render';
			const response = await fetch(endpoint, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!response.ok) {
				throw new Error(await extractApiErrorCode(response, 'render_failed'));
			}
			const result = await response.json();
			request.setCurrentRender(
				renderResultFromResponse(result, { sourceMode: 'render', formSnapshot })
			);
			request.setStatus('idle');
			void auth.refreshCredit();
			if (auth.canLoadGeneratedImages) void generatedImages.load();
		} catch (err) {
			request.setStatus('error');
			submitError = t(renderErrorKey(err));
		} finally {
			submitting = false;
			generationOverlay.stop(overlayId);
		}
	}

	function renderErrorKey(err: unknown): TranslationKey {
		if (err instanceof RequestImageUploadError) return 'upload.errorUpload';
		return creditErrorKey(
			{
				failed: 'render.failed',
				insufficientCredit: 'render.insufficientCredit',
				generationRestricted: 'render.generationRestricted'
			},
			err
		);
	}

	// The floating tools panels (position: fixed, siblings deep inside
	// .workspace-main) anchor their default corner just below this header —
	// but "below" only means something if they know how tall it actually is.
	// The tab bar row toggling on/off changes that height, so it's measured
	// live and published as a CSS var (--workspace-header-bottom, read by
	// FloatingToolsPanel.svelte) rather than assuming a fixed size.
	//
	// getBoundingClientRect().bottom alone is viewport-relative — it shrinks
	// as the page scrolls, which would drag a *fixed*-position panel up the
	// screen on every scroll instead of leaving it where a floating panel
	// belongs. Adding scrollY back converts it to the header's stable
	// document-relative position, so the published value stays correct
	// regardless of scroll offset at the moment a resize is observed (e.g.
	// the tab bar appearing while the page happens to be scrolled).
	let workspaceHeaderBottom = $state<number | null>(null);

	function modeTabsLabelWidth(node: HTMLElement): number {
		const iconsOnly = node.classList.contains('icons-only');
		if (iconsOnly) node.classList.remove('icons-only');
		try {
			const buttons = [...node.querySelectorAll('button')];
			let widest = 0;
			for (const button of buttons) {
				const style = getComputedStyle(button);
				const padding =
					Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
				const gap = Number.parseFloat(style.columnGap);
				const icon = button.querySelector('svg');
				const label = button.querySelector('.mode-label');
				const iconWidth = icon instanceof SVGElement ? icon.getBoundingClientRect().width : 0;
				const labelWidth = label instanceof HTMLElement ? label.scrollWidth : 0;
				const buttonWidth =
					iconWidth +
					(labelWidth > 0 && Number.isFinite(gap) ? gap : 0) +
					labelWidth +
					(Number.isFinite(padding) ? padding : 0);
				widest = Math.max(widest, buttonWidth);
			}
			const style = getComputedStyle(node);
			const gap = Number.parseFloat(style.columnGap);
			const padding = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
			return (
				widest * buttons.length +
				(Number.isFinite(gap) ? gap : 0) * Math.max(0, buttons.length - 1) +
				(Number.isFinite(padding) ? padding : 0)
			);
		} finally {
			if (iconsOnly) node.classList.add('icons-only');
		}
	}

	function fitModeLabels(node: HTMLElement): () => void {
		let alive = true;
		const update = (): void => {
			if (!alive || node.clientWidth === 0) return;
			const needed = modeTabsLabelWidth(node);
			node.classList.toggle('icons-only', node.clientWidth < needed);
		};
		update();
		const observer = new ResizeObserver(update);
		observer.observe(node);
		const panel = node.closest('.floating-tools-panel');
		if (panel) observer.observe(panel);
		void document.fonts.ready.then(update);
		return () => {
			alive = false;
			observer.disconnect();
		};
	}

	function measureWorkspaceHeader(node: HTMLElement): () => void {
		const update = () => {
			workspaceHeaderBottom = node.getBoundingClientRect().bottom + window.scrollY;
		};
		update();
		const observer = new ResizeObserver(update);
		observer.observe(node);
		return () => observer.disconnect();
	}
</script>

{#snippet modeSwitcher()}
	<div
		class="mode-tabs"
		role="tablist"
		aria-label={t('mode.switcher.label')}
		{@attach fitModeLabels}
	>
		{#each modes as modeOption, index (modeOption.id)}
			<button
				{@attach (node) => {
					modeTabs[index] = node as HTMLElement;
					return () => {
						if (modeTabs[index] === node) modeTabs[index] = null;
					};
				}}
				type="button"
				role="tab"
				id={`mode-tab-${modeOption.id}`}
				aria-selected={mode === modeOption.id}
				aria-controls={`mode-panel-${modeOption.id}`}
				aria-label={t(modeOption.label)}
				title={t(modeOption.label)}
				tabindex={mode === modeOption.id || (mode === null && index === 0) ? 0 : -1}
				class:active={mode === modeOption.id}
				onclick={() => modeTabController.activate(index)}
				onkeydown={modeTabController.onKeydown}
			>
				<modeOption.icon size={15} strokeWidth={1.8} aria-hidden="true" />
				<span class="mode-label">{t(modeOption.label)}</span>
			</button>
		{/each}
	</div>
{/snippet}

<main class="page">
	<div class="workspace-shell">
		<div
			class="workspace-main"
			style:--tools-panel-width={toolsPanel.width !== null ? `${toolsPanel.width}px` : undefined}
			style:--workspace-header-bottom={workspaceHeaderBottom !== null
				? `${workspaceHeaderBottom}px`
				: undefined}
		>
			<div class="workspace-header" {@attach measureWorkspaceHeader}>
				{#if isAuthenticated}
					<div class="workspace-row">
						<a class="resources-button" href={resolve('/projects', {})}>
							<FolderKanban size={18} strokeWidth={1.8} aria-hidden="true" />
							<span>{t('projects.navLabel')}</span>
						</a>
						{#if showWorkspaceTabs}
							<WorkspaceTabBar>
								{#snippet activeActions()}
									<button
										{@attach (node) => {
											shareTrigger = node as HTMLButtonElement;
											return () => {
												shareTrigger = null;
											};
										}}
										type="button"
										class="tab-share"
										aria-expanded={shareOpen}
										aria-label={t('workspace.shareButton')}
										title={t('workspace.shareButton')}
										onclick={() => (shareOpen = true)}
									>
										<Share2 size={13} strokeWidth={2} aria-hidden="true" />
									</button>
								{/snippet}
							</WorkspaceTabBar>
						{/if}
						<button
							{@attach (node) => {
								scenesTrigger = node as HTMLButtonElement;
								return () => {
									scenesTrigger = null;
								};
							}}
							type="button"
							class="scenes-button"
							aria-expanded={scenesOpen}
							aria-controls="scenes-drawer"
							onclick={openScenes}
						>
							<Images size={18} strokeWidth={1.8} aria-hidden="true" />
							<span>{t('generatedImages.title')}</span>
						</button>
						<a class="resources-button" href={resolve('/resources', {})}>
							<GalleryHorizontalEnd size={18} strokeWidth={1.8} aria-hidden="true" />
							<span>{t('resources.title')}</span>
						</a>
					</div>
				{/if}

				{#if isAuthenticated && showSessionTabs}
					<div class="workspace-row">
						<a
							class="resources-button"
							href={resolve('/projects/[id]', { id: workspaceTabs.activeTabId })}
						>
							<Layers size={18} strokeWidth={1.8} aria-hidden="true" />
							<span>{t('workspace.sessionsButton')}</span>
						</a>
						<SessionTabBar />
					</div>
				{/if}
			</div>

			{#if urlTargetStatus === 'loading'}
				<p class="url-target-status" role="status">{t('workspace.urlTarget.loading')}</p>
			{:else if urlTargetStatus === 'failed'}
				<div class="url-target-status" role="alert">
					<p>{t('workspace.urlTarget.failed')}</p>
					<div class="url-target-actions">
						<button type="button" class="boundary-retry" onclick={retryOpeningUrlTarget}>
							{t('workspace.urlTarget.retry')}
						</button>
						<button type="button" class="boundary-retry" onclick={settleUrlTarget}>
							{t('workspace.urlTarget.dismiss')}
						</button>
					</div>
				</div>
			{/if}

			<!-- Each mode keeps its own persistent canvas-layout (hidden via CSS, not
			     destroyed via {#if}) so that in-flight background work — the Object/
			     Texture Replacement tools' async job polling in particular — survives
			     switching away to another mode and back. All three share the same
			     `.canvas-layout` shape so the workspace footprint never changes
			     between modes. The root route is a fourth layout: the same canvas,
			     with no mode tab selected and a chooser in the tools panel. -->
			<div
				class="canvas-layout"
				class:reserve-panel-space={toolsPanelAtDefaultCorner}
				hidden={mode !== null || urlTargetStatus !== 'idle'}
			>
				<div class="canvas-col">
					{#if !request.currentRender}
						<ImageUpload />
					{:else}
						<section aria-label={t('render.result')}>
							<svelte:boundary
								onerror={(error: unknown) => logBoundaryError('workspace.renderResult', error)}
							>
								<RenderResult />
								{#snippet failed(_error: unknown, reset: () => void)}
									<p class="boundary-failed">{t('boundary.failed')}</p>
									<button type="button" class="boundary-retry" onclick={reset}>
										{t('boundary.retry')}
									</button>
								{/snippet}
							</svelte:boundary>
						</section>
					{/if}
				</div>

				<FloatingToolsPanel active={mode === null} header={modeSwitcher}>
					<div class="step-card">
						<p class="panel-description">{t('toolsPanel.chooseMode')}</p>
						<ul class="mode-clouds">
							{#each modes as modeOption (modeOption.id)}
								<li class="mode-cloud">
									<span class="mode-cloud-icon">
										<modeOption.icon size={16} strokeWidth={1.8} aria-hidden="true" />
									</span>
									<span class="mode-cloud-copy">
										<span class="mode-cloud-title">{t(modeOption.label)}</span>
										<span class="mode-cloud-description">{t(modeOption.description)}</span>
									</span>
								</li>
							{/each}
						</ul>
					</div>
				</FloatingToolsPanel>
			</div>

			<div
				class="canvas-layout"
				class:reserve-panel-space={toolsPanelAtDefaultCorner}
				role="tabpanel"
				id="mode-panel-render"
				aria-labelledby="mode-tab-render"
				tabindex="0"
				hidden={mode !== 'render' || urlTargetStatus !== 'idle'}
			>
				<div class="canvas-col">
					{#if mode === 'render' && !request.currentRender}
						<ImageUpload />
					{:else if mode === 'render' && request.currentRender}
						<section aria-label={t('render.result')}>
							<svelte:boundary
								onerror={(error: unknown) => logBoundaryError('workspace.renderResult', error)}
							>
								<RenderResult />
								{#snippet failed(_error: unknown, reset: () => void)}
									<p class="boundary-failed">{t('boundary.failed')}</p>
									<button type="button" class="boundary-retry" onclick={reset}>
										{t('boundary.retry')}
									</button>
								{/snippet}
							</svelte:boundary>
						</section>
					{/if}
				</div>

				<FloatingToolsPanel active={mode === 'render'} header={modeSwitcher}>
					<div class="step-card">
						<p class="panel-description">{t('render.panelDescription')}</p>
						<div class="panel-section">
							<h2 class="panel-heading">{t('render.sceneType.label')}</h2>
							<div
								class="scene-type-toggle"
								role="tablist"
								aria-label={t('render.sceneType.label')}
							>
								{#each sceneTypes as sceneTypeOption, index (sceneTypeOption.id)}
									<button
										{@attach (node) => {
											sceneTypeTabs[index] = node as HTMLElement;
										}}
										type="button"
										role="tab"
										aria-selected={request.sceneType === sceneTypeOption.id}
										tabindex={request.sceneType === sceneTypeOption.id ? 0 : -1}
										class:active={request.sceneType === sceneTypeOption.id}
										onclick={() => sceneTypeTabController.activate(index)}
										onkeydown={sceneTypeTabController.onKeydown}
									>
										{t(sceneTypeOption.label)}
									</button>
								{/each}
							</div>
						</div>

						<PromptViews
							stepLabel="③"
							headingKey="view.switcher.label"
							optionalBadgeKey="render.optional"
						/>

						<div class="panel-section generate-section">
							<label class="format-label">
								<span class="format-text">{t('render.outputFormat')}</span>
								<select
									value={request.outputFormat}
									onchange={(event) =>
										request.setOutputFormat(event.currentTarget.value as OutputFormat)}
									class="format-select"
								>
									<option value="webp">WebP</option>
									<option value="jpg">JPG</option>
									<option value="png">PNG</option>
									<option value="avif">AVIF</option>
								</select>
							</label>

							{#if !isAuthenticated}
								<p class="auth-hint">{t('render.signInToGenerate')}</p>
							{/if}

							<GenerateButton
								label={t('render.generate')}
								disabled={!canGenerate || !isAuthenticated}
								busy={request.status === 'rendering'}
								onclick={() => void generate()}
							/>

							{#if submitError}
								<p class="submit-error" role="alert">{submitError}</p>
							{/if}
						</div>
					</div>
				</FloatingToolsPanel>
			</div>

			<div
				class="canvas-layout"
				class:reserve-panel-space={toolsPanelAtDefaultCorner}
				role="tabpanel"
				id="mode-panel-edit"
				aria-labelledby="mode-tab-edit"
				tabindex="0"
				hidden={mode !== 'edit' || urlTargetStatus !== 'idle'}
			>
				<div class="canvas-col">
					{#if showMaskOnCanvas}
						<svelte:boundary
							onerror={(error: unknown) => logBoundaryError('workspace.maskEditor', error)}
						>
							<MaskEditor
								sourceUrl={request.workingImageUrl()}
								sourceKey={request.workingImageKey()}
								disabled={maskEditorLocked}
							/>
							{#snippet failed(_error: unknown, reset: () => void)}
								<p class="boundary-failed">{t('boundary.failed')}</p>
								<button type="button" class="boundary-retry" onclick={reset}>
									{t('boundary.retry')}
								</button>
							{/snippet}
						</svelte:boundary>
					{:else if mode === 'edit' && !request.currentRender}
						<ImageUpload selectRegion={activeEditTool === 'repaint'} />
					{:else if mode === 'edit' && request.currentRender}
						<section aria-label={t('render.result')}>
							<svelte:boundary
								onerror={(error: unknown) => logBoundaryError('workspace.renderResult', error)}
							>
								<RenderResult selectRegion={activeEditTool === 'repaint'} />
								{#snippet failed(_error: unknown, reset: () => void)}
									<p class="boundary-failed">{t('boundary.failed')}</p>
									<button type="button" class="boundary-retry" onclick={reset}>
										{t('boundary.retry')}
									</button>
								{/snippet}
							</svelte:boundary>
						</section>
					{/if}
				</div>

				<FloatingToolsPanel active={mode === 'edit'} header={modeSwitcher}>
					<svelte:boundary
						onerror={(error: unknown) => logBoundaryError('workspace.editPanel', error)}
					>
						<EditPanel />
						{#snippet failed(_error: unknown, reset: () => void)}
							<p class="boundary-failed">{t('boundary.failed')}</p>
							<button type="button" class="boundary-retry" onclick={reset}>
								{t('boundary.retry')}
							</button>
						{/snippet}
					</svelte:boundary>
				</FloatingToolsPanel>
			</div>

			<div
				class="canvas-layout"
				class:reserve-panel-space={toolsPanelAtDefaultCorner}
				role="tabpanel"
				id="mode-panel-styleTransfer"
				aria-labelledby="mode-tab-styleTransfer"
				tabindex="0"
				hidden={mode !== 'styleTransfer' || urlTargetStatus !== 'idle'}
			>
				<div class="canvas-col">
					{#if mode === 'styleTransfer' && !request.currentRender}
						<ImageUpload />
					{:else if mode === 'styleTransfer' && request.currentRender}
						<section aria-label={t('render.result')}>
							<svelte:boundary
								onerror={(error: unknown) => logBoundaryError('workspace.renderResult', error)}
							>
								<RenderResult />
								{#snippet failed(_error: unknown, reset: () => void)}
									<p class="boundary-failed">{t('boundary.failed')}</p>
									<button type="button" class="boundary-retry" onclick={reset}>
										{t('boundary.retry')}
									</button>
								{/snippet}
							</svelte:boundary>
						</section>
					{/if}
				</div>

				<FloatingToolsPanel active={mode === 'styleTransfer'} header={modeSwitcher}>
					<svelte:boundary
						onerror={(error: unknown) => logBoundaryError('workspace.styleTransfer', error)}
					>
						<StyleTransferPanel />
						{#snippet failed(_error: unknown, reset: () => void)}
							<p class="boundary-failed">{t('boundary.failed')}</p>
							<button type="button" class="boundary-retry" onclick={reset}>
								{t('boundary.retry')}
							</button>
						{/snippet}
					</svelte:boundary>
				</FloatingToolsPanel>
			</div>
		</div>
	</div>

	{#if isAuthenticated}
		<ScenesDrawer open={scenesOpen} onClose={closeScenes} />
		<ShareProjectDialog
			projectId={workspaceTabs.activeTabId}
			open={shareOpen}
			onClose={closeShare}
		/>
	{/if}
</main>

<style>
	.page {
		min-height: calc(100dvh - var(--app-chrome-height, 0px));
		padding: 2rem 1rem 4rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1.5rem;
		/* The 640px floor only applies once the viewport is wide enough to fit
		   it (min(640px, 100vw)) — otherwise a phone narrower than 640px would
		   get a --content-width wider than its own screen, leaving the
		   workspace looking inset instead of edge-to-edge. Above that floor it
		   fills the screen minus a comfortable side margin — the graph view in
		   particular benefits from the extra room — capped well above any real
		   monitor width so it never gets absurd on an ultrawide display. */
		--content-width: clamp(min(640px, 100vw), calc(100vw - 4rem), 1800px);
	}

	.workspace-shell {
		width: 100%;
		max-width: var(--content-width);
		display: flex;
		align-items: flex-start;
		justify-content: center;
	}

	.workspace-main {
		width: 100%;
		max-width: var(--content-width);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1.5rem;
		min-width: 0;
	}

	.workspace-header {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.workspace-row {
		width: 100%;
		display: flex;
		align-items: stretch;
		gap: 0.75rem;
	}

	.tab-share {
		display: flex;
		flex: 0 0 auto;
		align-items: center;
		justify-content: center;
		width: 1.25rem;
		height: 1.25rem;
		padding: 0;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-muted);
		cursor: pointer;
		transition:
			background 0.15s,
			color 0.15s;
	}

	.tab-share:hover {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}

	@media (prefers-reduced-motion: reduce) {
		.tab-share {
			transition: none;
		}
	}

	.scenes-button {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		/* Pins the Scenes+Resources pair to the right of the projects row even
		   when the project tab strip before it isn't rendered (a signed-in user
		   with no open project tabs yet) — margin-left: auto rather than
		   justify-content: space-between on the parent, since space-between
		   would collapse a single remaining flex item back to the start. */
		margin-left: auto;
		/* Matches .mode-nav's own (content-driven) height so the stretched
		   .workspace-row row doesn't leave the mode tabs looking like they're
		   floating in a taller pill with empty space below them. */
		min-height: 2.5rem;
		padding: 0.5rem 1rem;
		border: 1px solid var(--color-border);
		border-radius: 14px;
		background: var(--color-surface);
		color: var(--color-text);
		box-shadow: var(--shadow-sm);
		font: inherit;
		font-size: 0.875rem;
		font-weight: 650;
		cursor: pointer;
		transition:
			background 0.15s,
			border-color 0.15s,
			color 0.15s,
			box-shadow 0.15s;
	}

	.scenes-button:hover {
		background: var(--color-surface-hover);
		border-color: var(--color-accent);
		color: var(--color-accent-text);
		box-shadow: var(--shadow);
	}

	.resources-button {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		min-height: 2.5rem;
		padding: 0.5rem 1rem;
		border: 1px solid var(--color-border);
		border-radius: 14px;
		background: var(--color-surface);
		color: var(--color-text);
		box-shadow: var(--shadow-sm);
		font: inherit;
		font-size: 0.875rem;
		font-weight: 650;
		text-decoration: none;
		cursor: pointer;
		transition:
			background 0.15s,
			border-color 0.15s,
			color 0.15s,
			box-shadow 0.15s;
	}

	.resources-button:hover {
		background: var(--color-surface-hover);
		border-color: var(--color-accent);
		color: var(--color-accent);
		box-shadow: var(--shadow);
	}

	.mode-tabs {
		flex: 1 1 auto;
		min-width: 0;
		height: 2rem;
		box-sizing: border-box;
		display: flex;
		align-items: stretch;
		gap: 2px;
		padding: 3px;
		background: color-mix(in srgb, var(--color-accent) 6%, var(--color-surface));
		border: 1px solid color-mix(in srgb, var(--color-accent) 10%, var(--color-surface));
		border-radius: 10px;
	}

	.mode-tabs button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		flex: 1 1 0;
		min-width: 0;
		height: auto;
		min-height: 0;
		padding: 0 0.7rem;
		font: inherit;
		font-size: 0.8125rem;
		font-weight: 600;
		line-height: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		text-align: center;
		color: color-mix(in srgb, var(--color-accent) 55%, var(--color-text));
		background: transparent;
		border: none;
		border-radius: 8px;
		cursor: pointer;
		transition:
			background 0.15s,
			color 0.15s,
			box-shadow 0.15s;
	}

	.mode-tabs button :global(svg) {
		flex: 0 0 auto;
		width: 15px;
		height: 15px;
	}

	.mode-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.mode-tabs button:hover:not(.active) {
		color: var(--color-accent-text);
		background: color-mix(in srgb, var(--color-surface) 70%, transparent);
	}

	.mode-tabs button.active {
		/* Pairs with --color-background rather than --color-accent-contrast: this
		   pill is an inverted background/text swap (dark-on-light in light mode,
		   light-on-dark in dark mode), not an accent fill, so its text needs to
		   track --color-text's polarity flip rather than stay fixed white. */
		color: var(--color-background);
		background: var(--color-text);
		box-shadow: var(--shadow-sm);
	}

	.mode-tabs button.active:focus-visible {
		outline-color: var(--color-text);
	}

	.mode-tabs:global(.icons-only) button {
		padding-inline: 0;
	}

	.mode-tabs:global(.icons-only) .mode-label {
		display: none;
	}

	.mode-clouds {
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.mode-cloud {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 0.85rem 1rem;
		background: color-mix(in srgb, var(--color-accent) 10%, var(--color-surface));
		border-radius: 1.75rem;
	}

	.mode-cloud-icon {
		flex: 0 0 auto;
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-accent) 16%, var(--color-surface));
		color: var(--color-accent-text);
	}

	.mode-cloud-copy {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		min-width: 0;
	}

	.mode-cloud-title {
		font-size: 0.8125rem;
		font-weight: 600;
		line-height: 1.3;
		color: var(--color-text);
	}

	.mode-cloud-description {
		font-size: 0.8125rem;
		font-weight: 400;
		line-height: 1.45;
		color: var(--color-muted);
	}

	.canvas-layout {
		width: 100%;
		display: flex;
		flex-direction: row;
		align-items: flex-start;
		gap: 1.5rem;
	}

	/* The floating panel is fixed-positioned and out of flow, so it doesn't
	   naturally reserve space here. Full-width canvas controls (e.g. the photo
	   URL import row, the render result toolbar) would otherwise extend under
	   its default top-right corner and become unclickable — but only while the
	   panel is actually sitting there unopened-and-undragged; the moment the
	   user drags it or collapses it (`toolsPanelAtDefaultCorner` goes false),
	   the canvas reclaims that width immediately rather than keeping a
	   permanent gap for a panel that's no longer in the way. Desktop-only:
	   below 900px the panel becomes a static, normal-flow block instead. */
	@media (min-width: 901px) {
		.canvas-layout.reserve-panel-space {
			padding-right: calc(var(--tools-panel-width) + 1.5rem);
		}
	}

	.url-target-status {
		margin: 0;
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		color: var(--color-muted);
		text-align: center;
	}

	.url-target-status p {
		margin: 0;
	}

	.url-target-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.5rem;
	}

	.url-target-actions .boundary-retry {
		margin: 0;
	}

	.canvas-col {
		flex: 1 1 0;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.panel-section {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.scene-type-toggle {
		display: flex;
		gap: 0.5rem;
		padding: 0.25rem;
		background: var(--color-background);
		border-radius: 12px;
	}

	.scene-type-toggle button {
		flex: 1;
		min-width: 0;
		padding: 0.5rem 0.75rem;
		font: inherit;
		font-size: 0.875rem;
		font-weight: 500;
		line-height: 1.25;
		color: var(--color-muted);
		background: transparent;
		border: none;
		border-radius: 9px;
		cursor: pointer;
		transition:
			background 0.15s,
			color 0.15s;
	}

	.scene-type-toggle button:hover:not(.active) {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}

	.scene-type-toggle button.active {
		background: var(--color-surface);
		color: var(--color-text);
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.1);
	}

	@media (max-width: 900px) {
		.canvas-layout {
			flex-direction: column;
			/* align-items: flex-start (the row-mode default, above) sizes flex
			   children to their own content in the cross axis. That's correct
			   in a row, but once this switches to a column the cross axis is
			   horizontal — without stretch here, .canvas-col (and the stacked
			   FloatingToolsPanel) shrink to their content width instead of
			   filling the screen. */
			align-items: stretch;
		}
	}

	@media (max-width: 440px) {
		.workspace-row {
			flex-direction: column;
		}
	}

	@media (max-width: 640px) {
		.page {
			padding: 1.5rem 0.5rem 3rem;
		}

		.scenes-button,
		.resources-button {
			padding-inline: 0.75rem;
		}
	}
</style>
