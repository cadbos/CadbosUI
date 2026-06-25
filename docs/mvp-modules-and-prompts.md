# Cadbos MVP — разбиение на модули и профильные промпты

Источник требований: [ТЗ v0.11](tz-cadbos-interior-ai.md). Документ декомпозирует MVP на
разрабатываемые модули и даёт по каждому **готовый профильный промпт** для разработки
в Claude Code — с привязкой к нашим скиллам (`.claude/skills/`) и субагентам
(`.claude/agents/`).

> Файловая раскладка во всех промптах соответствует
> [cadbos-structure](../.claude/skills/cadbos-structure/SKILL.md). Все модули
> подчиняются «Absolute rules» из [AGENTS.md](../AGENTS.md): руны-only, секреты —
> server-only, единый store, `svelte-autofixer` в ноль, i18n без хардкода.

---

## Карта модулей

| # | Модуль | Фаза | Зависит от | Ключевые FR/AC | Профильные скиллы | Субагент |
|---|---|---|---|---|---|---|
| 0 | Скаффолд приложения + i18n + security-каркас | A | — | NFR-9/11/13/14, заголовки безопасности | `cadbos-structure`, `cadbos-conventions`, `svelte-deployment` | `svelte-file-editor` |
| 1 | Ядро: единая модель запроса (контракт) | A | 0 | FR-А1…А6, AC-9 | `cadbos-request-model`, `cadbos-conventions`, `svelte-runes` | `svelte-file-editor` |
| 3 | Key-value интерфейс | B | 1 | FR-В1…В4, AC-4 | `cadbos-request-model`, `svelte-components`, `svelte-styling` | `svelte-file-editor`, `a11y-validator` |
| 8 | Чат-интерфейс | B | 1 | FR-Б1…Б5, AC-3 | `cadbos-request-model`, `svelte-components` | `svelte-file-editor`, `a11y-validator` |
| 9 | Граф-интерфейс | B | 1 | FR-Г1…Г5, AC-5 | `cadbos-request-model`, `svelte-template-directives`, `svelte-styling` | `svelte-file-editor`, `a11y-validator` |
| 2 | Nostr-авторизация (клиент + сервер) | C | 1 | FR-И1, FR-И7, AC-11, Прил. B | `cadbos-security`, `cadbos-structure`, `sveltekit-data-flow` | `svelte-file-editor`, `code-reviewer` |
| 4 | Загрузка изображения (UploadThing) | C | 1, 2 | FR-Ж0…Ж1, И-UT-*, AC-1 | `cadbos-integrations`, `cadbos-security` | `svelte-file-editor` |
| 5 | Создание рендера + серверный прокси | C | 1, 4 | FR-Ж2…Ж7, И-MA-*, AC-1/6/7 | `cadbos-integrations`, `cadbos-security` | `svelte-file-editor`, `code-reviewer` |
| 6 | Тарификация / лимиты (Account/Quota) | C | 2, 5 | FR-И4, NFR-18, AC-10/12 | `cadbos-integrations`, `cadbos-security` | `code-reviewer` |
| 7 | Редактирование рендера (`edit-by-prompt`) | C | 5, 6 | FR-К1…К7, И-MA-ED*, AC-13/14/15 | `cadbos-integrations`, `cadbos-request-model` | `svelte-file-editor` |
| 10 | Hardening: a11y / i18n / адаптив / безопасность | D | все | NFR-2,7-12,16-18 | `cadbos-testing`, `cadbos-self-review`, `cadbos-security` | `a11y-validator`, `test-runner`, `code-reviewer` |

**Мэппинг на milestone'ы ТЗ §11.3:** Фаза A → M1 (ядро); Фаза B → часть M1 + M4 (три
вида); Фаза C → M1(auth)+M2+M3 (auth, загрузка, рендер, тарификация, правка);
Фаза D → M5 (hardening). Фазы — основная ось планирования; milestone'ы ТЗ — для
трассируемости к договору.

---

## Стратегия разработки: UI-first на контракте

Цель — быстро получить видимый, кликабельный UI и только затем подключать внешнюю
логику, **без последующего переписывания**. Это совместимо с «Absolute rules» при двух
условиях: (1) виды строятся поверх **настоящего стора** (Модуль 1), а не выбрасываемого
локального состояния; (2) и мок-, и реальные endpoint'ы реализуют **один и тот же
контракт API** (ниже). Три вида — проекции одного источника истины
(`cadbos-request-model`), и AC-9 (идентичность трёх UI) держится на сторе с первого дня.

Что можно отложить (чистые границы — мокаются на уровне endpoint'а):
`/auth/*`, `/api/uploads`, `/api/render`, `/api/edit` и server-only модули за ними
(`auth.ts`, `uploads.ts`, `generation.ts`, `billing.ts`). На UI-этапе они отвечают
фикстурами **в форме контракта API**.
Что отложить **нельзя**: сам стор, деривацию `prompt` и контракт API.

**Фазы и критерии выхода (phase gates):**

- **Фаза A — каркас и контракт.** Модуль 0 → Модуль 1.
  *Выход:* `pnpm dev` и `pnpm build` поднимаются; стор проходит unit-тесты;
  три плейсхолдер-вида переключаются без ошибок; мок-endpoint'ы возвращают DTO
  контракта; заголовки безопасности и CSP отдаются (проверяемо в DevTools).
- **Фаза B — UI на контракте (моки).** Модули 3 ∥ 8 ∥ 9.
  *Выход:* AC-3, AC-4, AC-5 зелёные на моках; AC-9 (идентичность трёх UI) проходит на
  моках; a11y-validator без блокеров по трём видам.
- **Фаза C — реальная логика.** Модули 2 → 4 → 5 → 6 → 7.
  *Выход:* AC-1, AC-6, AC-7, AC-10, AC-11, AC-12, AC-13, AC-14, AC-15 зелёные против
  реальных server-only модулей (внешние сервисы — в моках); ключей нет в клиенте;
  UI из фазы B не переписан.
- **Фаза D — hardening.** Модуль 10.
  *Выход:* весь NFR-блок; e2e AC-9 по процедуре §10.1; `/security-review` чистый.

**Порядок (зависимости):** 0 → 1 → (3 ∥ 8 ∥ 9, на моках) → 2 → 4 → 5 → 6 → 7 → 10.
Тестирование (`cadbos-testing` + `test-runner`) и self-review (`cadbos-self-review`)
применяются в каждом модуле, не только в фазе D.

> Скиллы `cadbos-structure` и `cadbos-security` уже приведены в соответствие с ТЗ
> v0.11 (Nostr-авторизация, без логина/пароля и `nsec`).

---

## Контракт API (wire DTO) — единый для мока и реального бэкенда

Это «контракт» из названия стратегии. Прокси нормализует ответы внешних сервисов к
этим формам, поэтому клиент не зависит от различий MyArchitectAI (`output` массив vs
строка, И-MA-4). И dev-моки (Модуль 0), и реальные endpoint'ы (фаза C) отдают **ровно
эти типы** — UI не переписывается при переходе. Тела запросов валидируются на сервере
схемой (Zod/Valibot), ошибки — обобщённые, без внутренних деталей (NFR-6/8).

```ts
// src/lib/api/contract.ts — общие типы клиент↔сервер (без секретов)

type OutputFormat = 'webp' | 'jpg' | 'png' | 'avif';

// Унифицированная ошибка (тело при HTTP 4xx/5xx) — без stack/путей/внутр. id
interface ApiError { error: { code: string; message: string } }

// POST /api/uploads (после UploadThing) → данные для ImageInput
interface UploadResult { url: string; mime: string; size: number; dimensions?: [number, number] }

// POST /api/render — { image, prompt, outputFormat } → нормализованный результат
interface RenderRequest { image: string; prompt: string; outputFormat: OutputFormat }
// POST /api/edit — { image, prompt } (без outputFormat; aspect ratio сохраняется)
interface EditRequest { image: string; prompt: string }
// Общий ответ генерации и правки (output[0] для render, output для edit — нормализованы)
interface RenderResponse { outputUrl: string; cost: number; balance: number }

// Auth (Приложение B). Подписанное событие NIP-98 — в заголовке Authorization: Nostr <base64>
interface ChallengeRequest { pubkey: string }
interface ChallengeResponse { challenge: string }              // nonce, single-use, TTL ~60c
interface SessionUser { pubkey: string; firstName?: string; lastName?: string }
interface Quota { balanceOrLimit: number; usage: number; period: string }
interface MeResponse { user: SessionUser; quota: Quota }       // GET /auth/me; 401 если нет сессии
// POST /auth/verify → 200 + Set-Cookie (httpOnly); тело: { user: SessionUser }
// POST /auth/logout → 204
```

Клиентский адаптер заворачивает `RenderResponse` в `RenderResult` стора
(`outputUrls: [outputUrl]`, плюс `parentId`/`editOp` при правке) — массив в сторе нужен
под задел revision history (Д-16).

---

## Шаблон промпта (структура всех модулей ниже)

Каждый промпт следует единой структуре для предсказуемости агента:

```
Прочитай: <разделы ТЗ + скиллы — стартовый контекст>
Цель: <что и зачем, со ссылками на FR/AC>
Сделай: <конкретные шаги, файлы, поведение>
НЕ делай: <границы scope — что НЕ трогаем в этом модуле>
Готово: <критерии завершения> · Тесты: <Vitest unit | Playwright e2e + AC>
```

**Общая преамбула** (подразумевается в каждом промпте): стек Svelte 5 (руны) +
SvelteKit; прочитать AGENTS.md и соблюдать «Absolute rules»; сверять синтаксис
Svelte/SvelteKit и внешние API с актуальными доками (Svelte MCP: list-sections →
get-documentation), не доверять памяти; каждый `.svelte`/`.svelte.ts` — через
`svelte-autofixer` до нуля; весь UI-текст через i18n (`src/lib/i18n`), без хардкода,
основной язык RU; TypeScript strict, без `any`, явные типы у публичных API;
комментарии — только если нужны; по завершении — self-review по `cadbos-self-review`.

---

## Модуль 0 — Скаффолд приложения + i18n + security-каркас

```
Прочитай: ТЗ §9 (NFR-9/11/13/14), cadbos-structure, cadbos-conventions, cadbos-security
  (Do/Avoid: заголовки, CSP, CSRF), sveltekit-structure, svelte-deployment.

Цель: поднять базовое SvelteKit-приложение как фундамент UI-first разработки и задать
security-каркас с первого коммита.

Сделай:
- Инициализируй проект: SvelteKit + Svelte 5 (руны), TypeScript strict, пакетный
  менеджер **pnpm** (как в AGENTS.md «Commands»; commit `pnpm-lock.yaml`).
  Скрипты: dev / build / test (type-check + lint + Vitest), e2e (Playwright).
- Раскладка по cadbos-structure: src/lib/state, src/lib/components, src/lib/server,
  src/lib/api (контракт), src/lib/i18n, routes/+layout.svelte, routes/+page.svelte,
  routes/api/, routes/auth/.
- src/lib/api/contract.ts — типы из раздела «Контракт API» этого документа.
- i18n-каркас (src/lib/i18n): механизм словарей, RU основной, EN-готовность.
- Базовый workspace (routes/+page.svelte): переключатель трёх видов (chat / key-value /
  graph) — пока плейсхолдеры; каждая область вида в svelte:boundary (NFR-9).
- hooks.server.ts: заголовки безопасности (Strict-Transport-Security, X-Content-Type-
  Options: nosniff, X-Frame-Options: DENY, Referrer-Policy, Permissions-Policy) и CSP
  с nonce/hash (без unsafe-inline/eval); csrf.checkOrigin включён.
- Dev-стабы бэкенда: src/lib/server/mocks + dev-режим /api/* и /auth/*, отвечающие
  фикстурами СТРОГО в форме контракта API (UploadResult, RenderResponse, MeResponse,
  ChallengeResponse). Помечены dev-only, заменяются в фазе C.

НЕ делай: реальные интеграции (UploadThing/MyArchitectAI/NDK), бизнес-логику стора и
видов, аутентификацию по-настоящему — только мок-сессия.

Готово: dev и build поднимаются; заголовки/CSP видны в DevTools; svelte-autofixer = 0.
  Тесты: Vitest smoke (страница рендерится, виды переключаются); каркас Playwright готов.
```

---

## Модуль 1 — Ядро: единая модель запроса (контракт)

```
Прочитай: ТЗ §6(а) FR-А1…А6, §7 (модель/синхронизация), §10.1 (AC-9),
  cadbos-request-model, svelte-runes, cadbos-conventions.

Цель: единый источник истины для трёх представлений (FR-А1…А6, AC-9). Это контракт
фазы A: стор чисто клиентский (бэкенд не нужен), типы и API стабильны и далее не
переписываются — на них строятся все виды.

Сделай: src/lib/state/request.svelte.ts — единственный владелец данных запроса.
- Модель: id, image?: ImageInput (url/mime/size/dimensions), promptFragments:
  PromptFragment[] (id, label?, text, order), outputFormat: OutputFormat (дефолт 'webp'),
  currentRender?: RenderResult (id, outputUrls, cost, balance, parentId?, editOp?, ts),
  status. Типы переиспользуют src/lib/api/contract.ts где уместно.
- prompt — $derived: конкатенация promptFragments[] по order; прямое редактирование
  prompt — явный override-флаг, не теряется при переключении видов.
- API: addFragment/updateFragment/removeFragment/reorder, setImage, setOutputFormat,
  setCurrentRender, reset, toJSON()/fromJSON() (FR-А6).
- validate(): непустой prompt + загруженное image; список незаполненных полей; submit
  блокируется до валидности (FR-А5) + защита от двойной отправки (FR-Ж6).
- Детерминизм (FR-А4): одинаковое наполнение → побайтово одинаковый prompt и
  нормализованная модель (без UI-полей) — основа AC-9.

НЕ делай: сетевые вызовы из стора; UI-компоненты; revision history (только parentId/
editOp в типах как задел Д-16, без логики версий/дерева).

Готово: svelte-autofixer = 0. Тесты: Vitest unit — деривация prompt, reorder,
  override-флаг, validate, сериализация туда-обратно; фикстуры-помощник для AC-9.
```

---

## Модуль 3 — Key-value интерфейс

```
Прочитай: ТЗ §6(в) FR-В1…В4, §10 AC-4, cadbos-request-model, svelte-components,
  svelte-styling.

Цель: представление «Key-value» над стором Модуля 1 (FR-В1…В4, AC-4).

Сделай: src/lib/components/KeyValueView.svelte.
- Редактируемый список пар «метка → текст» = promptFragments[] стора.
- Добавление / удаление / переупорядочивание (drag и кнопки) — порядок задаёт порядок
  конкатенации (FR-А4); мутации только через API стора, без теневого state.
- Предпросмотр итогового prompt ($derived из стора).
- Изменение сегмента мгновенно обновляет модель → отражается в чате и графе (FR-А2).
- a11y: клавиатурное управление списком и переупорядочиванием, ARIA, контраст
  WCAG 2.1 AA (NFR-10). Полная функциональность на мобильных (NFR-12).

НЕ делай: собственное хранилище сегментов; вызовы бэкенда; стилизацию вне дизайн-токенов.

Готово: svelte-autofixer = 0, a11y-validator без блокеров. Тесты: Vitest component
  (CRUD/reorder сегмента → стор); Playwright AC-4 (отражение в чат/граф — на phase-gate B).
```

---

## Модуль 8 — Чат-интерфейс

```
Прочитай: ТЗ §6(б) FR-Б1…Б5, §10 AC-3, cadbos-request-model, svelte-components.

Цель: чат-подобное представление БЕЗ LLM (FR-Б1…Б5, AC-3). «Ответы» в ленте — результаты
генерации/правок и статус. В фазе B результаты приходят из мок-endpoint'а (контракт
RenderResponse); реальные вызовы подключаются в фазе C (Модули 5, 7) без переписывания.

Сделай: src/lib/components/ChatView.svelte.
- Ввод сообщений (фрагменты промпта / команды правок) → формируют итоговый prompt и
  отражаются в key-value/графе (FR-Б2); мутации через стор Модуля 1.
- Прикрепление изображения → setImage() стора (FR-Б4).
- При создании/правке — статус, затем результат-изображение в ленте (FR-Б3).
- История диалога в рамках сессии, хронологически (FR-Б5).
- a11y: чат полностью функционален на мобильных (NFR-12), клавиатура/ARIA (NFR-10).

НЕ делай: интеграцию с LLM/OpenRouter; прямые вызовы внешних API (только контракт-
endpoint, в фазе B — мок); собственное состояние промпта вне стора.

Готово: svelte-autofixer = 0, a11y-validator без блокеров. Тесты: Vitest component;
  Playwright AC-3; участие в e2e AC-9.
```

---

## Модуль 9 — Граф-интерфейс

```
Прочитай: ТЗ §6(г) FR-Г1…Г5, §10 AC-5, §7.2 (mapping), cadbos-request-model,
  svelte-template-directives, svelte-styling.

Цель: графовое представление модели (FR-Г1…Г5, AC-5).

Сделай: src/lib/components/GraphView.svelte.
- Узлы: image / fragment / compose; рёбра — порядок включения фрагментов в сборку.
- Добавление/удаление узлов-фрагментов, соединение с compose; мутации через стор
  Модуля 1; позиции узлов — локальное UI-состояние (не в сторе).
- Однозначный mapping граф ↔ key-value: узел-фрагмент = сегмент, ребро = включение в
  порядке связей (FR-Г3).
- Предотвращение невалидных конфигураций (циклы, висячие узлы) с понятной индикацией
  (FR-Г5).
- На узких экранах граф деградирует (NFR-12), не ломая приложение (svelte:boundary).

НЕ делай: хранение содержимого фрагментов в графе вместо стора; вызовы бэкенда.

Готово: svelte-autofixer = 0, a11y-validator без блокеров. Тесты: Vitest unit
  (валидация графа: циклы/висячие; граф→сегменты); Playwright AC-5; участие в AC-9.
```

---

## Модуль 2 — Nostr-авторизация (клиент + сервер)

```
Прочитай: ТЗ Д-11, FR-И1/И7, §8.4 (И-NO), NFR-17, AC-11, Приложение B целиком;
  cadbos-security (auth, cookies, rate-limit, валидация, лог событий), cadbos-structure,
  sveltekit-data-flow, svelte-runes. Сверь API NDK / nostr-tools с актуальными доками.

Цель: фаза C — заменить dev-стаб /auth/* реальной Nostr-авторизацией; построить UI входа.
Авторизация ТОЛЬКО через Nostr: паролей нет, импорт nsec НЕ поддерживается, приватный
ключ на сервер не уходит. Методы: (а) NIP-07 (NDKNip07Signer); (б) QR/NIP-46 Nostr
Connect (NDKNip46Signer). Библиотека — NDK.

Сделай:
- Клиент: src/lib/state/auth.svelte.ts (руны) — источник истины состояния входа:
  метод, активный NDKSigner, pubkey, кэш профиля (picture/name из kind:0), флаг сессии.
  NDK + загрузка профиля (kind:0) и релеев (NIP-65, kind:10002) от конфигурируемого
  bootstrap-набора.
- Сервер: src/lib/server/auth.ts + routes/auth/*, контракт из раздела «Контракт API».
  · POST /auth/challenge {pubkey} → ChallengeResponse (nonce, single-use, TTL ~60c).
  · POST /auth/verify (Authorization: Nostr <base64>) → проверка NIP-98 (kind 27235):
    kind, окно времени ±60c, теги u/method, одноразовость nonce, schnorr строго по
    pubkey ИЗ события (nostr-tools verifyEvent). Найти/создать User{pubkey}, открыть
    Session, Set-Cookie httpOnly+Secure+SameSite=Lax, ротация id.
  · POST /auth/logout → 204; GET /auth/me → MeResponse | 401.
  · hooks.server.ts: cookie → event.locals.user; guard /api/render|edit|uploads.
- Валидация тел запросов схемой (Zod/Valibot); rate-limit /auth/challenge и /auth/verify
  (анти-брутфорс); лог событий безопасности (отказы подписи/nonce) без PII/секретов.
- Модель данных (§7): User(pubkey hex unique, firstName?, lastName?, createdAt), Session,
  AuthChallenge(nonce, pubkey, createdAt, usedAt?). Профиль-кэш на сервере не храним.
  Хранилище минимальное (KV/файл/мини-БД), схема forward-совместима (P-7).
  firstName/lastName — поля Cadbos; после первого входа предложить дозаполнить (FR-И7).
- Зафиксировать как конфиг (ОВ-11): формат подписи = NIP-98; TTL сессии и «remember me»;
  connectRelay для NIP-46; bootstrap-список релеев.

НЕ делай: приём nsec/seed в любом виде; хранение приватного ключа/пароля; логирование
ключей/подписей; серверное хранение истории/настроек (пост-MVP).

Готово: svelte-autofixer = 0, code-reviewer без блокеров. Тесты: Vitest unit —
  верификация подписи (валид/реплей/просрочка/чужой pubkey), guard endpoint'ов,
  rate-limit; Playwright AC-11 (с тестовым signer-моком: вход открывает доступ).
```

---

## Модуль 4 — Загрузка изображения (UploadThing)

```
Прочитай: ТЗ FR-Ж0/Ж1, §8.3 (И-UT-*), Д-8/Д-9/Д-9a, AC-1; cadbos-integrations,
  cadbos-security (валидация загрузок, server-only токены). Сверь @uploadthing/svelte
  с актуальными доками.

Цель: загрузка одного изображения и публичный URL для поля image (FR-Ж0/Ж1, И-UT-*).
Заменяет мок /api/uploads, отдаёт UploadResult (контракт API).

Сделай:
- Сервер: src/lib/server/uploads.ts (file router) + routes/api/uploads/+server.ts.
  Токен UPLOADTHING_TOKEN — server-only, не в клиентский бандл (NFR-4/14, AC-7).
- Ограничения маршрута: тип image, maxFileSize 8 MB, maxFileCount 1 (И-UT-3);
  серверная пере-проверка типа/размера (не доверять клиенту); ACL public-read (Д-9a).
- Клиент: компонент загрузки на @uploadthing/svelte; результат UploadResult →
  setImage() стора Модуля 1 (И-UT-4).
- Ошибки (тип/размер/сбой) → локализованное сообщение в форме ApiError, повторный
  выбор (И-UT-6). Доступ — только при валидной сессии (guard из Модуля 2).

НЕ делай: мульти-загрузку/батч; private+signed URL (пост-MVP); раскрытие токена клиенту.

Готово: svelte-autofixer = 0; токена нет в клиентском бандле (проверка). Тесты:
  Vitest (валидация типа/размера на сервере, форма UploadResult); guard без сессии → 401.
```

---

## Модуль 5 — Создание рендера + серверный прокси

```
Прочитай: ТЗ FR-Ж2…Ж7, §8.2.0 (И-MA-1…8), Д-5/Д-10, AC-1/6/7; cadbos-integrations,
  cadbos-security (прокси, секреты, rate-limit, маппинг ошибок), sveltekit-data-flow.

Цель: создать визуал через серверный прокси к render/interior (FR-Ж2…Ж7). Заменяет мок
/api/render; прокси нормализует output[] → RenderResponse (контракт API).

Сделай:
- Сервер: src/lib/server/generation.ts + routes/api/render/+server.ts.
  POST https://api.myarchitectai.com/v1/render/interior, тело {image, prompt,
  outputFormat}; x-api-key — ТОЛЬКО на сервере (NFR-4/5, AC-7). Синхронно, таймаут 120c
  конфигурируемо (И-MA-6). output — массив → берём output[0] (Д-5), нормализуем в
  RenderResponse; адаптер терпит и строковый формат (И-MA-4).
- Валидация тела схемой (Zod/Valibot, RenderRequest); rate-limit /api/render
  (анти-cost-abuse, привязка к pubkey).
- Ошибки: обобщённый маппинг HTTP → локализованные сообщения ApiError (валидация/лимит/
  таймаут/отказ/недостаточный баланс); секреты не в логах/ответах (NFR-6/8, AC-6).
  Ретраи только без подтверждённого ответа (И-MA-7); защита от двойной отправки (FR-Ж6).
- Клиент: запуск из workspace, состояние «генерация выполняется» (FR-Ж3); по ответу —
  просмотр в полном размере + скачивание; результат → currentRender (FR-Ж4) для Модуля 7.
  cost/balance (FR-Ж7) — связка с Модулем 6. Guard: только при валидной сессии.

НЕ делай: edit-by-prompt (это Модуль 7); мульти-изображения; auto-prompt/upscale (пост-
MVP); раскрытие x-api-key клиенту.

Готово: svelte-autofixer = 0, code-reviewer без блокеров. Тесты: Vitest (прокси с моками:
  успех/таймаут/ошибки/нормализация output, анти-дубль, rate-limit); Playwright
  AC-1/AC-6; проверка отсутствия ключа в клиенте (AC-7).
```

---

## Модуль 6 — Тарификация / лимиты (Account/Quota)

```
Прочитай: ТЗ FR-И4, NFR-18, AC-10/12; cadbos-integrations, cadbos-security
  (авторизация на уровне данных).

Цель: учёт стоимости и лимиты на уровне аккаунта Cadbos (FR-И4, NFR-18, AC-10/12).

Сделай:
- Сервер: src/lib/server/billing.ts. Модель Account/Quota(userId, balanceOrLimit,
  usage, period), привязка к pubkey (Модуль 2). Авторизация на уровне данных: квота
  принадлежит текущему pubkey, не просто валидной сессии.
- На каждую подтверждённую генерацию (Модуль 5) и правку (Модуль 7) списывать cost из
  ответа; согласованность с cost/balance, защита от двойного списания (NFR-18, FR-Ж6);
  списание атомарно с подтверждением вызова.
- Перед запуском: исчерпан баланс/лимит → блокировать с сообщением (AC-12); до операции
  показывать ожидаемую стоимость и остаток (AC-10).
- Клиент: индикатор остатка/лимита и стоимости операции в workspace (FR-Ж7, FR-И4).

НЕ делай: приём платежей/платёжные шлюзы (пост-MVP); списание до подтверждения вызова.

Готово: code-reviewer без блокеров. Тесты: Vitest — списание ровно один раз, блокировка
  при исчерпании, нет двойного списания, изоляция квот по pubkey; Playwright AC-10/AC-12.
```

---

## Модуль 7 — Редактирование рендера (`edit-by-prompt`)

```
Прочитай: ТЗ FR-К1…К7, §8.2.1 (И-MA-ED1…3), Д-15/Д-16/Д-17, AC-13/14/15;
  cadbos-integrations, cadbos-request-model, cadbos-security.

Цель: итеративная правка текущего рендера натуральным языком (FR-К1…К7). Масок нет —
цель словами. Заменяет мок /api/edit; ответ нормализуется в RenderResponse.

Сделай:
- Сервер: расширить src/lib/server/generation.ts + routes/api/edit/+server.ts.
  POST /v1/edit-by-prompt, тело {image, prompt} (БЕЗ outputFormat). image = URL текущего
  рендера currentRender.outputUrls[0] (Д-17). output — строка → RenderResponse (И-MA-4).
  Таймаут/ретраи/ошибки как у render (И-MA-ED3). Валидация схемой (EditRequest);
  rate-limit /api/edit.
- Модель: EditOperation(type: 'replace-object'|'change-surface-color'|'freeform',
  instruction). На API уходит instruction; type — UX-категория. Результат → новый
  currentRender с parentId/editOp (задел Д-16). Итеративность (FR-К4).
- Откат последней правки к предыдущему currentRender — in-session (FR-К6).
- Клиент: связный цикл «создание → улучшение»; шаблоны-подсказки для «замена объекта»/
  «смена цвета поверхности» как UX-обёртка над свободным текстом (FR-К7); индикация
  состояния и стоимости. Каждая правка — платный вызов через Модуль 6 (FR-К5), анти-дубль.

НЕ делай: полную revision history/дерево/откат к произвольной версии (пост-MVP Д-16,
только parent-link); маски/выделение области; upscale (пост-MVP).

Готово: svelte-autofixer = 0. Тесты: Vitest (нормализация output, цепочка image=
  предыдущий рендер, анти-дубль, rate-limit); Playwright AC-13 (замена объекта),
  AC-14 (смена цвета), AC-15 (итеративность + откат).
```

---

## Модуль 10 — Hardening (a11y / i18n / адаптив / производительность / безопасность)

```
Прочитай: ТЗ §9 (весь NFR-блок), §10.1 (AC-9); cadbos-testing, cadbos-self-review,
  cadbos-security (полный чек-лист). Субагенты: a11y-validator, test-runner, code-reviewer.

Цель: довести MVP до Definition of done по NFR-блоку перед приёмкой.

Сделай:
- a11y (NFR-10): аудит — клавиатура, ARIA-роли/labels, контраст WCAG 2.1 AA по трём
  видам + auth + результат рендера.
- i18n (NFR-11): ни одной хардкод-строки; полный RU-словарь, EN-готовность.
- Адаптивность (NFR-12): desktop + mobile; деградация графа; чат и key-value полностью
  рабочие на мобильных; вечнозелёные браузеры.
- Производительность (NFR-2/3): переключение видов и деривация prompt ≤100мс на ≤50
  сегментов; TTI-бюджет, SSR/код-сплиттинг.
- Изоляция сбоев (NFR-9): svelte:boundary вокруг видов/вызовов.
- Безопасность (NFR-4/6/7/17, AC-7): финальный прогон cadbos-security — секреты только
  server-only и не в логах; нет приватных ключей на сервере; серверная валидация
  ввода/файлов (Zod/Valibot); cookie httpOnly/Secure/SameSite; заголовки безопасности +
  CSP активны; rate-limit на /auth/* и /api/render|edit на месте. Запусти
  /security-review по диффу ветки и закрой findings.

НЕ делай: новую функциональность; рефактор стора/контракта без необходимости.

Готово: весь NFR-блок выполнен, svelte-autofixer = 0 по всем компонентам,
  /security-review чистый. Тесты: Playwright — полный e2e AC-9 по процедуре §10.1
  (chat → key-value → граф дают побайтово идентичный prompt и тело запроса);
  весь e2e/unit зелёный (test-runner).
```

---

## Что осознанно вне MVP (не делаем в этих модулях)

Revision history / ветвление / откат к произвольной версии (Д-16, заложен только
parent-link); OpenRouter (LLM-чат, выбор моделей, мульти-изображения); пошаговый
конструктор и каталог ключей (Приложение A); EN-требование и LLM-пост-обработка
промпта; серверное хранение истории/настроек; `auto-prompt`, `upscale-4k`,
`style-transfer`, экстерьер, видео, batch; платёжные шлюзы; маски/выделение области
при редактировании.
