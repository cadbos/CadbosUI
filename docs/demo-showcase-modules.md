# Cadbos Demo Showcase — модули быстрой демо-ветки

Источник требований: [ТЗ v0.11](tz.md) и [mvp-modules-and-prompts.md](mvp-modules-and-prompts.md).
Документ описывает **одноразовую демо-ветку** `demo/showcase`, цель которой — показать
заказчику полный UX-цикл приложения на mock-данных, не дожидаясь реализации внешних
интеграций (UploadThing, MyArchitectAI, Nostr-relay).

> **Принципиально:** демо-ветка — не отдельная кодовая база. Это та же архитектура,
> те же правила («Absolute rules» из AGENTS.md), те же контракты. Отличие только в том,
> что mock-слой остаётся на месте вместо замены реальными интеграциями. Когда фаза C
> (реальный бэкенд) будет готова — демо-ветка либо закрывается, либо в неё вливается
> мейн.

---

## 1. Что приносим из текущего состояния

| Источник | Статус | Действие |
|---|---|---|
| `master` (Модуль 0) | ✅ готов | Берём как основу ветки |
| `master` (Модуль 2 — Nostr auth) | ✅ готов | Берём; добавляем demo-bypass поверх |
| `feat/module-1` (Модуль 1 — request store) | 🟡 не замержен | Мержим в `demo/showcase` первым шагом |
| `src/lib/server/mocks/fixtures.ts` | ✅ есть, URL-заглушки | Заменяем URL на реальные фото (public domain) |

---

## 2. Ключевые отличия от MVP-разработки

| Аспект | MVP (фаза C) | Demo-ветка |
|---|---|---|
| UploadThing | реальный file router + токен | `/api/uploads` остаётся mock; принимает файл на клиенте но не шлёт наружу |
| MyArchitectAI | реальный прокси с x-api-key | `/api/render` и `/api/edit` остаются mock; отдают fixture-фото |
| Авторизация | NIP-07 / NIP-46 (Nostr) | Реальная авторизация сохраняется; добавляется **кнопка «Войти в демо-режиме»** (только при `PUBLIC_DEMO_MODE=true`) |
| Квота | `billing.ts` с реальным учётом | Hardcoded mock-quota в `/auth/me` |
| Граф | Полноценный интерактивный | Упрощённый: без drag-and-drop, статичный layout |
| Загрузка файла | Реальный `<input type="file">` + UploadThing | `<input type="file">` есть, но файл в UploadThing не уходит — сразу возвращается fixture-URL |

**Не упрощаем:**
- Типы и контракт API — без изменений.
- Реактивность через стор Модуля 1 — реальная, не дублируется.
- i18n (весь UI-текст через словарь), Svelte 5 руны, TypeScript strict.
- `svelte-autofixer` до нуля перед каждым коммитом.

---

## 3. Изменения в mock-слое (DD0)

Текущие `fixtures.ts` возвращают технические заглушки (`example.ufs.sh/…`, `example.com/…`).
Для демо нужны **реальные, красивые фото интерьеров** (public domain / CC0):

```ts
// src/lib/server/mocks/fixtures.ts — demo-ready версия

export function mockUpload(): UploadResult {
  return {
    url: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=1200',
    // living room — Unsplash free, no attribution required for demo
    mime: 'image/jpeg',
    size: 342_000,
    dimensions: [1200, 800]
  };
}

export function mockRender(): RenderResponse {
  return {
    outputUrl: 'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?w=1200',
    // rendered scandinavian interior — Unsplash free
    cost: 2,
    balance: 48
  };
}
```

Дополнительно: для цепочки правок (DD3) нужна **вторая fixture**:

```ts
export function mockEdit(): RenderResponse {
  return {
    outputUrl: 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=1200',
    // interior with different color scheme — Unsplash free
    cost: 2,
    balance: 46
  };
}
```

`/api/edit/+server.ts` вызывает `mockEdit()` вместо `mockRender()` — чтобы пользователь
видел реальное «отличие» между исходным рендером и правкой.

---

## 4. Карта демо-модулей

| # | Демо-модуль | Зависит от | Фаза |
|---|---|---|---|
| DD0 | Ветка + мерж Модуля 1 + demo-fixtures | master + feat/module-1 | Alpha |
| DD1 | Три UI-вида (KeyValue, Chat, Graph) | DD0 | Alpha |
| DD2 | Upload UI + Render flow | DD0, DD1 | Alpha |
| DD3 | Edit flow | DD2 | Beta |
| DD4 | Demo-auth bypass + Quota display | DD0 | Alpha |

**Phase gates:**
- **Alpha (минимум для показа):** DD0 + DD4 + DD1 + DD2 — заказчик видит три вида,
  может загрузить фото (или использовать demo-фото), сгенерировать рендер, видит стоимость.
- **Beta (полный демо-цикл):** + DD3 — добавляется цикл правок.

---

## Шаблон промпта

Каждый промпт ниже соответствует структуре из `mvp-modules-and-prompts.md`:

```
Прочитай: <разделы ТЗ + скиллы>
Цель: <что и зачем>
Сделай: <шаги, файлы>
НЕ делай: <границы scope>
Готово: <критерии> · Тесты: <минимум>
```

**Общая преамбула** для каждого агента: AGENTS.md «Absolute rules»; Svelte 5 руны only;
каждый `.svelte`/`.svelte.ts` через `svelte-autofixer` до нуля; весь UI-текст через i18n
(`src/lib/i18n`), основной язык RU; TypeScript strict; по завершении —
`cadbos-self-review`.

---

## DD0 — Ветка + мерж Модуля 1 + demo-fixtures

```
Прочитай: docs/demo-showcase-modules.md §3 (изменения в mock-слое);
  src/lib/server/mocks/fixtures.ts; src/lib/api/contract.ts;
  src/routes/api/render/+server.ts; src/routes/api/edit/+server.ts.

Цель: подготовить ветку demo/showcase как базу для демо. Три действия:
  (1) создать ветку от master и вмержить feat/module-1;
  (2) обновить fixture-URL на реальные фото (§3 документа);
  (3) дать /api/edit свою fixture mockEdit(), чтобы правка визуально отличалась
      от исходного рендера.

Сделай:
- Из master создать ветку demo/showcase; вмержить туда feat/module-1
  (git merge --no-ff github-origin/feat/module-1).
- src/lib/server/mocks/fixtures.ts — заменить URL по §3: mockUpload() → реальное фото
  интерьера (исходная комната), mockRender() → красивый рендер того же помещения,
  добавить mockEdit() → рендер с заметно другой цветовой гаммой/объектом.
  Все URL — публично доступные HTTPS, CC0/Unsplash free (не требуют attribution в demo).
- src/lib/server/mocks/fixtures.test.ts — проверить, что все три функции возвращают
  объекты с непустыми url, mime и положительным size.
- src/routes/api/edit/+server.ts — заменить вызов mockRender() на mockEdit().

НЕ делай: не трогай реальные интеграции, не меняй схемы контракта, не меняй
  guard-логику hooks.server.ts, не убирай assertDevOnly().

Готово: pnpm build без ошибок; все unit-тесты зелёные (pnpm test).
  Тесты: обновить fixtures.test.ts; убедиться, что существующие тесты не сломаны.
```

---

## DD4 — Demo-авторизация + отображение квоты

> Делается раньше DD1 (до UI-видов), потому что без авторизации guard блокирует
> все /api/* endpoint'ы и render-flow не продемонстрировать.

```
Прочитай: ТЗ Приложение B §4-5 (флоу auth, endpoints); src/lib/server/auth/;
  src/lib/server/auth/session.ts; src/lib/server/auth/repository.ts;
  src/routes/auth/me/+server.ts; src/hooks.server.ts;
  src/lib/state/auth.svelte.ts; src/lib/components/AuthBar.svelte;
  cadbos-security (auth, cookies), cadbos-conventions.
  ВАЖНО: сверить API NDK и nostr-tools с актуальными доками перед правками.

Цель: (1) добавить demo-login endpoint, защищённый переменной окружения,
  чтобы заказчик мог войти без Nostr-расширения одним кликом; (2) отображать
  mock-квоту в шапке, чтобы на демо было видно «balance: 48 / 50».

Сделай:

  ── Demo-login endpoint ──
  - src/routes/auth/demo/+server.ts — POST, доступен ТОЛЬКО при
    `dev || env.PUBLIC_DEMO_MODE === 'true'`; иначе — 404.
    Логика: создать сессию с фиксированным demo-pubkey
    ('0000000000000000000000000000000000000000000000000000000000000001',
    valid hex Nostr pubkey) через существующий session.createSession().
    Найти-или-создать User с этим pubkey в репозитории (auth/repository.ts).
    Set-Cookie httpOnly+Secure+SameSite=Lax — точно как у /auth/verify.
    Ответ: { user: SessionUser } (тот же тип, что у /auth/verify).

  - .env.example (если есть) или wrangler.toml — добавить
    PUBLIC_DEMO_MODE=false с комментарием «set true for demo branch only».
    В demo/showcase ветке — wrangler.toml или .env.local с PUBLIC_DEMO_MODE=true.

  ── Mock-quota в /auth/me ──
  - src/routes/auth/me/+server.ts — если pubkey === demo-pubkey И нет реального
    billing-модуля: возвращать hardcoded quota { balanceOrLimit: 50, usage: 2, period: 'demo' }
    в поле quota ответа MeResponse. Тип Quota уже есть в contract.ts.
    Логика: обернуть существующий ответ, добавив quota при отсутствии реального billing.

  ── UI ──
  - AuthBar.svelte — добавить кнопку «Войти в демо-режиме» (i18n: auth.demoLogin),
    видимую ТОЛЬКО при PUBLIC_DEMO_MODE=true (передать через +layout.server.ts
    как public env). Кнопка вызывает POST /auth/demo и обновляет стор (auth.svelte.ts).
  - AuthBar.svelte — если quota есть в ответе /auth/me: показать
    «Баланс: {quota.balanceOrLimit - quota.usage} / {quota.balanceOrLimit}» рядом
    с именем пользователя (i18n: auth.quota).
  - Добавить ключи i18n: auth.demoLogin, auth.quota, auth.demoMode (бейдж «DEMO»
    рядом с именем) — в ru.ts и en.ts.

НЕ делай: не убирай реальную Nostr-авторизацию; не хардкодь demo-pubkey в production-
  путях; не убирай assertDevOnly() из API-маршрутов; не делай demo-login доступным
  без проверки PUBLIC_DEMO_MODE.

Готово: svelte-autofixer = 0 на AuthBar.svelte.
  Тесты: Vitest — POST /auth/demo без флага → 404; с флагом → 200 + cookie;
  /auth/me с demo-сессией → возвращает quota.
```

---

## DD1 — Три UI-вида (KeyValue, Chat, Graph)

```
Прочитай: ТЗ §6(б,в,г) FR-Б1…Б5, FR-В1…В4, FR-Г1…Г5; §7.2 (mapping);
  §10.1 (AC-9, процедура идентичности); mvp-modules-and-prompts.md Модули 3, 8, 9;
  src/lib/state/request.svelte.ts (Модуль 1 — API стора);
  src/lib/components/Workspace.svelte;
  cadbos-request-model, svelte-components, svelte-styling,
  svelte-template-directives, svelte-runes.
  Сверить синтаксис Svelte 5 через Svelte MCP (list-sections → get-documentation).

Цель: реализовать все три вида, переключаемых без потери данных (FR-А2/А3),
  с синхронизацией через стор Модуля 1. В demo-ветке граф упрощён (без drag-and-drop),
  но mapping граф↔key-value корректен (FR-Г3) и все три вида ведут к одному prompt.

Общие правила для всех трёх видов:
  - Мутации ТОЛЬКО через API стора (addFragment, updateFragment, removeFragment,
    reorder, setImage, setOutputFormat). Никакого теневого состояния.
  - $derived-промпт из стора — не пересчитывать в компоненте.
  - i18n для всех строк.

── Key-value (src/lib/components/KeyValueView.svelte) ──
  - Редактируемый список promptFragments[] — пары «метка (опц.) → текст»;
    текст = textarea, автоматически растущая по содержимому.
  - Кнопки: «+ Добавить сегмент», «↑↓ переместить», «✕ удалить».
  - Предпросмотр итогового prompt (read-only textarea или <pre>).
  - Selector outputFormat: webp / jpg / png / avif (дефолт из стора).
  - Мобильный: список полностью функционален (NFR-12).
  - a11y: кнопки с aria-label, фокус при добавлении нового поля.

── Chat (src/lib/components/ChatView.svelte) ──
  - Лента сообщений (хронологически): пользовательские сообщения + результаты.
  - Сообщение пользователя → addFragment({ text: message }); лента отражает fragments.
  - Прикрепление изображения (кнопка скрепки) → вызов setImage() стора; если уже
    есть currentRender, показать миниатюру рядом с вводом.
  - При отправке: если image загружено + prompt непустой — показать в ленте сообщение
    «Генерация…» (статус из стора), затем — карточку результата (см. DD2).
    В демо — кнопка «Отправить» просто добавляет фрагмент без вызова /api/render;
    реальный вызов монтируется в DD2.
  - Пустое состояние (нет fragments): подсказка-placeholder (i18n: chat.emptyHint).

── Graph (src/lib/components/GraphView.svelte) ──
  Упрощённая demo-реализация (без drag-and-drop):
  - Три типа узлов: «image» (один, показывает превью загруженного фото или заглушку),
    «fragment» (по одному на каждый PromptFragment), «compose» (один, всегда есть).
  - Layout: статичный CSS-grid — image-узел слева, fragment-узлы в центре (колонка),
    compose-узел справа.
  - Рёбра: SVG-линии от каждого fragment к compose (если connected), от image к compose.
    «Connected» = фрагмент входит в стор (все promptFragments[] включены по умолчанию).
  - Кнопки на fragment-узле: «✕ удалить», «⊕/⊖ вкл/выкл» (включение в сборку помечает
    включение рёбром; «выключенный» fragment остаётся в сторе, но не участвует в prompt —
    через поле enabled?: boolean в PromptFragment, добавить в стор).
    УТОЧНЕНИЕ: если добавление поля enabled усложняет стор сверх меры для demo,
    упростить: удаление = отключение (обычный removeFragment).
  - Кнопка «+ Добавить фрагмент» (под колонкой) → addFragment() → появляется новый узел.
  - Compose-узел показывает итоговый prompt ($derived) как read-only текст.
  - Деградация на узких экранах: граф скрывается (display:none при width < 640 px),
    вместо него — сообщение «Граф доступен только на широком экране» (i18n).

── Workspace ──
  - Убедиться, что переключатель в Workspace.svelte отображает нужный компонент
    и не теряет состояние стора при переключении (FR-А3).

НЕ делай: не вызывай /api/render или /api/edit из этих компонентов (это DD2/DD3);
  не реализуй drag-and-drop для графа; не дублируй стор.

Готово: svelte-autofixer = 0 на всех трёх компонентах + Workspace.
  Тесты: Vitest component — добавление fragment в KeyValue → виден в Chat и Graph;
  удаление fragment в Graph → исчезает из KeyValue; prompt в двух видах идентичен
  (фикстура AC-9). Playwright: переключение видов без потери данных.
```

---

## DD2 — Upload UI + Render flow

```
Прочитай: ТЗ FR-Ж0…Ж7, AC-1; mvp-modules-and-prompts.md Модуль 4 + Модуль 5;
  src/lib/server/mocks/fixtures.ts (mockUpload, mockRender — обновлены в DD0);
  src/routes/api/uploads/+server.ts; src/routes/api/render/+server.ts;
  src/lib/state/request.svelte.ts (setImage, setCurrentRender, validate);
  src/lib/api/contract.ts (UploadResult, RenderRequest, RenderResponse);
  cadbos-integrations (контракт прокси, обработка ошибок),
  cadbos-request-model, svelte-components.

Цель: реализовать полный цикл «загрузить фото → ввести промпт → сгенерировать рендер»
  на основе mock-endpoint'ов. Заказчик видит реалистичный UX: выбирает файл,
  нажимает «Сгенерировать», видит spinner, получает красивый рендер.

Сделай:

  ── Upload компонент ──
  - src/lib/components/ImageUpload.svelte.
    <input type="file" accept="image/*"> + drag-and-drop зона.
    Клиентская валидация: тип image/*, размер ≤ 8 MB (FR-Ж1) — при нарушении
    показывать локализованную ошибку (i18n: upload.errorType, upload.errorSize).
    При выборе файла:
      (demo-режим) вызвать POST /api/uploads (текущий mock без реального файла);
      получить UploadResult → storeAPI.setImage(result).
    Показать превью выбранного файла через URL.createObjectURL() для мгновенного
    отображения (не ждать ответа mock); после ответа mock — обновить image.url в сторе
    на fixture-URL (это то, что уйдёт в /api/render).
    Состояния: idle / uploading / done / error.

  ── Render-кнопка и поток ──
  - src/lib/components/RenderButton.svelte (или интегрировать в Workspace.svelte).
    Активна только когда store.validate().valid === true (FR-А5).
    При клике:
      1. Проверить validate(); если невалидно — показать список missing полей.
      2. Защита от двойной отправки: флаг isSubmitting в компоненте (FR-Ж6).
      3. Установить store.status = 'rendering'.
      4. POST /api/render с телом { image, prompt, outputFormat } из стора.
      5. По ответу: store.setCurrentRender(адаптировать RenderResponse → RenderResult).
      6. По ошибке: store.status = 'error'; показать локализованное сообщение.
    Показывать spinner / «Генерация...» пока status === 'rendering' (FR-Ж3).

  ── RenderResult компонент ──
  - src/lib/components/RenderResult.svelte.
    Получает currentRender из стора ($derived или $props).
    Показывает: изображение (src=outputUrls[0]) во весь доступный размер,
    кнопку «Скачать» (download-атрибут на <a>), cost и balance (FR-Ж7):
    «Стоимость: {cost} · Баланс: {balance}» (i18n).
    Кнопка «Редактировать» → переходит к панели правок (DD3); пока DD3 не готов —
    заглушка-кнопка visible=false.
    Компонент виден во всех трёх видах через Workspace (или отдельная панель под видами).

  ── Интеграция в виды ──
  - В ChatView (DD1): при нажатии «Отправить» (если validate() ok) — вызывать
    render-поток; результат появляется как карточка RenderResult в ленте.
  - В KeyValueView / GraphView: кнопка «Сгенерировать» + блок RenderResult снизу
    (или в Workspace).

  ── i18n ──
  Добавить ключи: upload.dropHint, upload.errorType, upload.errorSize,
  upload.uploading, render.generating, render.cost, render.balance,
  render.download, render.edit (placeholder).

НЕ делай: не реализуй реальный UploadThing-роутер; не шли файл наружу;
  не реализуй /api/edit в этом модуле (DD3); не убирай assertDevOnly().

Готово: svelte-autofixer = 0 на ImageUpload.svelte, RenderButton.svelte,
  RenderResult.svelte.
  Тесты: Vitest — клиентская валидация файла (тип/размер), validate() блокирует
  без image, isSubmitting предотвращает двойной вызов.
  Playwright: выбрать файл → нажать «Сгенерировать» → появляется рендер-изображение.
```

---

## DD3 — Edit flow (Beta)

```
Прочитай: ТЗ FR-К1…К7, Д-17, AC-13/14/15;
  mvp-modules-and-prompts.md Модуль 7;
  src/lib/server/mocks/fixtures.ts (mockEdit — добавлен в DD0);
  src/routes/api/edit/+server.ts;
  src/lib/state/request.svelte.ts (currentRender, EditOperation, setCurrentRender);
  src/lib/api/contract.ts (EditRequest, RenderResponse);
  cadbos-request-model, cadbos-integrations.

Цель: реализовать цикл правок «текстовая инструкция → обновлённый рендер» (FR-К).
  Заказчик видит: после генерации появляется панель редактирования с шаблонами
  («Заменить объект» / «Сменить цвет поверхности») и произвольным вводом;
  правка меняет изображение; есть кнопка «Отмена правки» (откат in-session).

Сделай:

  ── EditPanel компонент ──
  - src/lib/components/EditPanel.svelte.
    Видим только когда currentRender существует (FR-К1).
    Два шаблона-подсказки (FR-К7) — кнопки, вставляющие шаблон в поле ввода:
      «Заменить объект» → «Замени [объект] на [новый объект]»
      «Сменить цвет»   → «Сделай [поверхность] цвета [цвет]»
    Свободный textarea для инструкции.
    Selector типа правки (type: replace-object / change-surface-color / freeform) —
    UX-категория, на API уходит instruction (FR-К2/К3).
    Кнопка «Применить правку»:
      1. Защита от двойной отправки (isSubmitting).
      2. POST /api/edit { image: currentRender.outputUrls[0], prompt: instruction }.
      3. Ответ RenderResponse → новый RenderResult с parentId=currentRender.id,
         editOp={type, instruction}; store.setCurrentRender(newRender).
      4. RenderResult обновляется — заказчик видит изменённое изображение.
    Кнопка «Отмена правки» (FR-К6): восстановить предыдущий currentRender.
      Реализация: хранить previousRender в локальном $state компонента (или в сторе).
      Кнопка видима после каждой правки (только последний шаг in-session).
    Стоимость правки: показывать cost и balance из ответа (FR-К5, FR-Ж7).

  ── Интеграция ──
  - RenderResult.svelte (DD2): кнопка «Редактировать» → показывать EditPanel
    (toggle или отдельный блок под результатом).
  - В ChatView: команды правок из textarea добавляются в ленту; результат правки —
    карточка с заголовком «Правка: {type}» и обновлённым изображением.

  ── i18n ──
  Добавить: edit.title, edit.templateReplace, edit.templateColor, edit.instruction,
  edit.typeLabel, edit.apply, edit.undo, edit.cost, edit.balance.

НЕ делай: не реализуй полную revision history / дерево версий (только откат
  последней правки in-session, FR-К6); не убирай assertDevOnly(); не реализуй
  upscale (пост-MVP).

Готово: svelte-autofixer = 0 на EditPanel.svelte.
  Тесты: Vitest — POST /api/edit возвращает mockEdit() (другой URL от mockRender),
  undo восстанавливает предыдущий currentRender.
  Playwright: сгенерировать рендер → ввести инструкцию → получить изменённое
  изображение → нажать «Отмена» → вернуться к предыдущему рендеру (AC-13/14/15).
```

---

## Порядок выполнения и критерии готовности demo-ветки

```
DD0 → DD4 → DD1 → DD2 → DD3
```

**Минимум для Alpha-демо (показ заказчику):**

1. `pnpm dev` поднимается без ошибок.
2. Кнопка «Войти в демо-режиме» открывает сессию; видны имя «Demo» + бейдж + баланс.
3. Все три вида переключаются; добавление/удаление сегментов синхронизируется.
4. Загрузить фото (или mock-фото) → «Сгенерировать» → spinner → рендер виден.
5. Отображаются cost и balance после генерации.
6. `pnpm test` зелёный (никаких новых падений).
7. `svelte-autofixer` = 0 на всех изменённых `.svelte`.

**Beta (полная demo-петля):**

+ Панель редактирования видна под рендером; правка меняет изображение;
  откат возвращает предыдущее.

---

## Что осознанно упрощено в demo-ветке

- Граф без drag-and-drop (статичный CSS-layout).
- Загрузка файла не уходит в UploadThing — mock принимает запрос без файла.
- Авторизация через demo-кнопку (только при `PUBLIC_DEMO_MODE=true`).
- Квота hardcoded (billing.ts не реализован).
- `/api/render` и `/api/edit` защищены `assertDevOnly()` — production-сборка
  выдаст ошибку, что напоминает о незамещённых endpoint'ах.

Эти упрощения **не являются техническим долгом** — они явно разграничены:
- Mock-файлы (`fixtures.ts`, `assertDevOnly()`) заменяются в фазе C MVP.
- Demo-login endpoint (`/auth/demo`) существует только при флаге окружения.
- Граф будет доработан в Модуле 9 основной ветки (drag-and-drop, валидация циклов).
