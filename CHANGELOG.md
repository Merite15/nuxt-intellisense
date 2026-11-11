# Changelog

All notable changes to this project will be documented in this file.

## [1.0.1] - 2026-11-11

### Fixed

- **Components inside a layer named like an ignored directory**: a layer such as `layers/shared` (or `layers/config`, `layers/utils`…) was skipped when discovering `components/` folders because its name matches `nuxt-intellisense.ignoredDirectories`, so the component CodeLens displayed `0 reference | undefined`. Direct children of `layers/` are no longer treated as ignored (`node_modules`, `.nuxt`, `.output` and `.git` still are).

## [1.0.0] - 2026-11-10

### Added

- **Component `prefix` / `pathPrefix` from `nuxt.config`**: component names now honour the `components: [{ path, prefix, pathPrefix }]` option of the root or layer `nuxt.config`. With `prefix: 'Staff'`, `PageTeachingUnitHeader.vue` resolves to `<StaffPageTeachingUnitHeader />` (no duplicate if the name already starts with the prefix). Directories declared outside a `components/` folder are also picked up.

### Changed

- **"Search in workspace" lens for 0-reference store members is scoped to the files using the store**, instead of the whole project.

### Fixed

- **Composable member reference count**: duplicate locations are removed (the CodeLens count now matches the peek list) and usages in template attributes (`v-model:foo="item"`, `:prop="item"`) and `{{ item }}` interpolations are now counted.
- **Test files no longer treated as plugins/composables/middleware**: `test/plugins/*.spec.ts` was reported as a "provide key conflict" with the real plugin. `*.spec.*`, `*.test.*` and `test/`, `tests/`, `__tests__/`, `e2e/` folders are now ignored.

### Security

- Bumped transitive dev dependencies: fast-uri 3.1.9, js-yaml 4.3.2, undici 8.12.4, markdown-it 14.3.3.

## [0.9.9] - 2026-09-02

### Added

- **Stale prop detection on component CodeLens**: a component using `<script setup>` + `defineProps` now shows a single `$(warning)` lens when one or more declared props are no longer referenced anywhere in the component (neither `<script>` nor `<template>`) while at least one parent still passes them — the typical leftover after removing a feature but forgetting to trim the props. Clicking the lens opens a QuickPick listing each stale prop and its parent call sites (`editor.action.showReferences`). The analysis is purely textual and deliberately conservative: destructured `defineProps`, `v-bind="obj"` object spreads on the parent, `useAttrs`, etc. suppress the warning rather than risk a false positive.

## [0.9.8] - 2026-08-22

### Fixed

- **False "provide key conflict" between unrelated plugins**: `PluginService`'s detection of duplicate `provide: { ... }` keys used a non-greedy regex to find the object body, which stopped at the *first* closing brace — so a plugin nesting its API under a sub-object (e.g. `provide: { posthog: { capture: (event: string, ...) => ... } }`) leaked identifiers found inside that nested object (including TS parameter type annotations) as if they were top-level provide keys. Two plugins each exposing an unrelated nested method named the same (e.g. both containing an `event` identifier somewhere inside, like a Posthog plugin's `capture(event: string, ...)` parameter and a Clarity plugin's `event(name: string)` method) were wrongly flagged as conflicting. Provide-key extraction now walks brace depth to only read genuine top-level keys.

### Changed

- **"Search in workspace" lens for 0-reference store members is now scoped, not a bare word search**: for a Pinia store variable/method/getter with a generic name (e.g. `loading`, `error`), the companion `$(search)` lens used to search the literal word across the whole project, surfacing unrelated matches (any other local `loading` ref in unrelated files). It now searches a regex limited to plausible member-access patterns (`.loading`, `{ loading } = ...`), regardless of how the store is aliased (`store.loading`, `agencyStore.loading`, `useAgencyStore().loading`).

## [0.9.7] - 2026-08-17

### Changed

- **Per-property CodeLens now hides 0-reference entries instead of showing "0 references"**: for exported constant objects (e.g. enum-like value objects such as `AppointmentPaymentStatus`), a property that's never accessed via `Object.property` / `Object['property']` no longer gets its own CodeLens at all — it was pure noise for objects whose members are mostly used as string literals rather than dot/bracket access. The parent object's own reference-count CodeLens is unaffected and still reports its total.

## [0.9.6] - 2026-08-04

### Changed

- **Documentation**: README now covers the per-property CodeLens for exported constant objects (0.9.5) — added to the feature list and a worked example (`DashboardModuleRoutes`) showing exactly how the per-property lenses render above each key, including the 0-reference "search in workspace" companion lens.

## [0.9.5] - 2026-08-04

### Added

- **"Search in workspace" companion lens for utils exports**: a `utils`/`lib`/`services`/`constants`/... export (function, const, interface, type, enum, class) reporting "0 references" now also shows the `$(search)` companion lens, matching the behavior already in place for components, composables, stores, middleware and layouts.
- **Per-property reference counts for exported constant objects**: an `export const NAME = { ... }` object (e.g. a route table like `export const DashboardModuleRoutes = { Shipment: '/dashboard/shipments', ... } as const`) now gets one CodeLens per top-level property, showing how many times `NAME.property` (or `NAME['property']`) is used across the project — same idea as the existing per-member CodeLenses on Pinia stores, extended to any plain exported object. Each 0-reference property also gets its own "search in workspace" lens.

### Fixed

- None of the CodeLens-based reference counts (components, composables, stores, utils, plugins, server API/middleware) ever refreshed on their own when the count-changing edit happened in a *different* file: `NuxtIntellisense` never implemented `onDidChangeCodeLenses`, so VS Code only re-requested a document's CodeLenses when that exact document was reopened or edited, regardless of whether the underlying service had already correctly invalidated its cache. A single project-wide watcher now signals VS Code to re-request CodeLenses (debounced) whenever any `.vue`/`.ts`/`.js` file changes. Supersedes the component-specific event added in 0.9.4.

## [0.9.4] - 2026-08-04

### Added

- **Props/slots preview on hover**: hovering a component tag (`<MyButton>` / `<my-button>`) now also lists the component's declared props (with their type and whether they're required) and slots, extracted from `defineProps` (generic type, inline object type, `interface`/`type` alias, or runtime object/array form) and `<slot name="...">` in its template — alongside the existing reference count.

### Fixed

- A component's reference count only refreshed when its own file was edited: `ComponentService`'s file watcher only covered `**/components/**/*.vue`, so removing a `<MyComponent />` usage from a page, layout, or `app.vue` never invalidated the cached count. The watcher now covers every `.vue` file in the project, matching the other services.

## [0.9.3] - 2026-08-02

### Added

- **"Search in workspace" companion lens for middleware and layouts**: matching the existing behavior for components/composables/stores, a middleware or layout CodeLens reporting "0 references" now also shows a `$(search)` lens to double-check with a real full-text search before deleting anything.

### Fixed

- A plugin using the object shorthand `provide: { scrollToElement }` (no `key: value` colon) never had its provided key detected, so any usage elsewhere via `const { $scrollToElement } = useNuxtApp()` was invisible to the reference counter — the CodeLens always reported 0 references regardless of actual usage. The key-extraction regex has been replaced with a plain comma-split parser that correctly handles both `key: value` and bare shorthand properties, including the last property in the object whether or not it has a trailing comma.
- A plugin that only registers a Vue-level dependency (e.g. `nuxtApp.vueApp.use(VueApexCharts)`) without ever calling `nuxtApp.provide(...)` or declaring a `provide: {...}` object exposes nothing another file could reference by name — Nuxt applies it automatically, the same way it applies `server/plugins`. It was still counted as having "0 references" and flagged as likely dead code. Such plugins now show an informational "registered automatically by Nuxt" CodeLens instead, and are no longer reported in the unused-symbol diagnostics.
- `MiddlewareService`'s `definePageMeta` matcher (both the plain string and array forms) computed the reference's location using the offset of `definePageMeta(` instead of the offset of the object's opening `{`, a ~15-character difference. "Go to references" on a middleware landed a fixed distance before the actual name — in practice, often right on top of the `middleware:` key itself instead of its value.
- `LayoutService`'s "plain string" reference matcher (`layout: 'name'`) used the entire matched text (`layout: 'name'`, including the `layout:` key and quotes) as the reference's location range instead of just the layout name itself — inconsistent with every other reference matcher in the codebase, which all point precisely at the name. "Go to references" on a layout now highlights only the name, same as middleware, components, composables and stores.

## [0.9.2] - 2026-08-02

### Changed

- New extension icon: a magnifying glass framing the official Nuxt logo, replacing the previous generic mountain-silhouette artwork — better reflects what the extension actually does (inspecting/searching your Nuxt project) and reads more clearly at small sizes (Marketplace listing, Extensions panel, activity indicators).

## [0.9.1] - 2026-08-02

### Added

- **"Search in workspace" companion lens**: any CodeLens reporting "0 references" for a component, composable, or store (including individual store methods/variables/getters) now shows an additional `$(search)` lens that opens VS Code's global search pre-filled with that name. Reference detection here is regex-based, not a real parser, so before deleting anything flagged as unused, this lets you double-check with a real full-text search in one click.

### Fixed

- A Pinia store defined with an implicit arrow return (`defineStore('x', () => ({ ... }))`) instead of an explicit `return { ... }` statement bypassed the "only keep members actually exposed" filter, which only recognized the explicit form. In practice this leaked the store's own exported hook name (e.g. `useSettingsStore`) into its `variables` list, producing a spurious extra CodeLens for a "variable" that was really just the store declaration itself. Both return forms are now recognized.

## [0.9.0] - 2026-08-02

### Added

- **Duplicate `provide` key detection**: two plugins calling `nuxtApp.provide('key', ...)` (classic or `provide: {...}` object form) with the same key silently overwrite one another at runtime — now flagged as a warning CodeLens on each conflicting plugin, project-wide.
- **Unknown `definePageMeta` key detection**: a top-level key that's a near-miss (Levenshtein distance ≤ 2) of a known Nuxt page-meta key (`midleware` vs `middleware`) is flagged as a likely typo with a suggested correction. Deliberately conservative — keys that aren't close to any known key are left alone, since many Nuxt modules add their own `definePageMeta` keys via type augmentation, and a strict allow-list would produce constant false positives on those.
- **`server/middleware` and `server/plugins` coverage**: both now appear as categories in the "Nuxt Structure" explorer, and a new `ServerMiddlewarePluginService` flags two Nitro files sharing the same name within the same category (a common leftover from refactors). Reference counting isn't meaningful here since Nitro applies these automatically rather than via named references.
- **Hover preview for components**: hovering a component tag (`<MyButton>` / `<my-button>`) in a `.vue` template shows its live reference count and a link to its definition file, without needing to open it. Reuses the exact same `ComponentService` logic and cache as the CodeLens, so counts always match.

## [0.8.4] - 2026-08-02

### Added

- **Phantom reference detection**: a new `PageMetaValidationService` flags `middleware`/`layout` names referenced in `definePageMeta` (string, array, or object form) or in `routeRules`' `appMiddleware`/`appLayout` that don't match any file found in the project, as a warning in the Problems panel — catches typos in these plain-string references, the mirror image of the existing "0 references" dead-code detection. Toggle with `nuxt-intellisense.showPhantomReferenceErrors`. Correctly excludes `.global.ts` middleware, which is never referenced by name.
- **Duplicate name detection extended to composables and stores** (previously components only): composables are auto-imported by their exported function name rather than by file path, so two different files exporting the same name (e.g. two `useAuth`) now trigger a conflict warning; similarly, two `defineStore(...)` calls sharing the same store id — even across unrelated files — are now flagged.

## [0.8.3] - 2026-08-02

### Fixed

- The "Nuxt Structure" view was visible even in workspaces without a `nuxt.config.js`/`.ts` (any open folder would show it, using the workspace root as a fallback). Since VS Code 1.74, views and commands declared in `contributes` implicitly activate the extension on their own — independently of the `workspaceContains:nuxt.config.*` activation events — so the view's real content depended entirely on whether a project root was actually detected, with no visual indication when it wasn't. A `nuxtIntellisense.isNuxtProject` context key now gates the view's visibility (`when` clause) so it only appears on genuine Nuxt projects.

## [0.8.2] - 2026-08-01

### Security

- Forced `uuid` to `>=11.1.1` (resolved to `14.0.1`) via a `pnpm-workspace.yaml` override, fixing the last remaining moderate-severity advisory (out-of-bounds buffer writes in `v3()`/`v5()`/`v6()` when called with an explicit output buffer) nested inside `@vscode/vsce > @azure/identity > @azure/msal-node`. `uuid@14` is ESM-only, which could in principle break a CommonJS `require('uuid')` — verified this doesn't affect `vsce package` or loading `@azure/msal-node` in practice, since the only code path that actually invokes `uuid` there is `vsce`'s optional Azure AD login/publish flow, unused by this project. `pnpm audit` now reports zero known vulnerabilities.

## [0.8.1] - 2026-08-01

### Fixed

- Project root detection stopped at the first ancestor directory containing both `nuxt.config.ts` and `package.json`/`.git`. In a monorepo using local Nuxt layers (`layers/<name>/`) that ship their own `nuxt.config.ts` **and** `package.json`, opening a file inside a layer would incorrectly scope the whole extension to that layer instead of the actual project root. Root detection now prefers the outermost matching ancestor. The duplicate implementation of this logic (one in `NuxtIntellisense`, one in `FileUtils`) has also been consolidated into a single `FileUtils.findNuxtProjectRoot`.
- `middleware`/`layout` usages declared in `definePageMeta({ ... })` were missed whenever an _earlier_ property in the same object was itself a nested object (e.g. the newer `layout: { name, props }` form) — the regex used to isolate the `definePageMeta` object stopped at the first `}` it found, which belonged to the nested object, cutting off everything declared after it (including `middleware: '...'`). Parsing now walks balanced braces instead (new `TextUtils.extractBalancedBlock`). The object form of `layout` (`layout: { name: 'x', props: {...} }`) is also now detected, not just the plain string form.
- Component usages inside `app.vue` and `error.vue` were never counted — these two files were explicitly skipped while scanning for component tags, even though `app.vue` routinely uses components (`<NuxtLayout>`, custom components, ...).
- Middleware referenced via Nitro `routeRules`' `appMiddleware` (string or array form) was not detected at all, whether declared directly in `nuxt.config.ts` or in a separate file imported into it (e.g. `app/config/route-rules.config.ts`) — the search now covers this pattern project-wide, without excluding the normally-ignored `config/` folder for this specific case.
- Same fix applied to layouts referenced via `routeRules`' `appLayout` (Nuxt 3.21+/4.3+).

### Security

- Upgraded `@vscode/vsce` (2.32.0 → 3.9.2) and `mocha` (10.8.2 → 11.7.6), and removed the unused `glob`/`@types/glob` devDependencies, resolving 50 of 51 known vulnerabilities in transitive dev dependencies (`form-data`, `tar-fs`, `minimatch`, `brace-expansion`, `js-yaml`, `undici`, `jws`, `serialize-javascript`, `qs`, `diff`, `tmp`, `picomatch`, `underscore`, `linkify-it`, ...), via `pnpm-workspace.yaml` overrides where the upstream packages hadn't bumped their own dependency yet. The last one (`uuid`) is fixed in 0.8.2.
- **None of these packages are runtime dependencies of the extension** — they're devDependencies used only to build/test/package it locally, and `node_modules` is already excluded from the published `.vsix` via `.vscodeignore`. This is a supply-chain/dev-environment hardening, not a fix for anything reachable by end users.

### Changed

- The published `.vsix` no longer bundles `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.gitignore`, or stale build artifacts from previously removed source files (a `clean` step now wipes `out/` before every `vscode:prepublish`/package). Package size dropped from ~207 KB to ~138 KB.

## [0.8.0] - 2026-08-01

### Added

- **Unused symbol detection**: any CodeLens reporting "0 references" is now also surfaced as a hint diagnostic in the Problems panel. Toggle with `nuxt-intellisense.showUnusedWarnings`.
- **Configurable ignored directories**: `nuxt-intellisense.ignoredDirectories` setting lets you customize which folders (`utils`, `lib`, `helpers`, ...) are excluded from reference search, instead of a fixed, hardcoded list.
- **Duplicate component name detection**: warns when two different component files resolve to the same Nuxt component name (e.g. `components/ui/Button.vue` and `components/common/Button.vue` both resolving to `Button`), with a quick link to the conflicting files.
- **`server/api` and `server/routes` reference counting**: detects `defineEventHandler`/`eventHandler` handlers, derives the Nitro route path (including dynamic `[id]` segments and `.get`/`.post`/... method suffixes), and counts usages via `$fetch`/`useFetch`/`useLazyFetch` across the project.
- **"Nuxt Structure" explorer view**: a new panel in the Explorer sidebar listing components, composables, stores, plugins, middleware, layouts, server API routes, utils and unit/integration test files (`*.test.{ts,js}` / `*.spec.{ts,js}`) by category, for quick navigation. Refresh via the toolbar button or `nuxt-intellisense.refreshExplorer`.
- **Nuxt 4 compatibility**: `~/` and `@/` alias resolution now tries both the project root (Nuxt 3 default `srcDir`) and `app/` (Nuxt 4 default `srcDir`), so import-based reference detection keeps working after migrating to the new `app/`-nested directory layout.
- Real codicons (`$(package)`, `$(database)`, `$(symbol-method)`, ...) instead of emoji in all CodeLens titles, for a native, theme-aware look.
- Unit and integration test suite (`npm test`), running against a lightweight in-process mock of the `vscode` API — no need to download or launch a real VS Code instance.

### Fixed

- Plugin usages inside `stores/` files were silently excluded from the reference search and always showed as unused.
- A Pinia `computed()` getter could be double-counted as both a "getter" and a "variable"/"method" in the store CodeLens, due to overlapping regexes.
- `UtilsService` could count the same import statement twice (once via the dedicated import regex, once via the generic usage regex).
- A utils export name appearing inside an unrelated string literal (e.g. `"please search carefully"`) was incorrectly counted as a real usage of an export named `search`.
- `StoreService.scanStoresDirectory` ignored its `dir` argument and rescanned the entire workspace once per store directory; it is now properly scoped and results from multiple `stores/` folders (monorepo layers) are merged instead of overwritten.
- Several `vscode.workspace.findFiles` exclude globs contained a stray double comma (`,,`), producing an empty, meaningless glob alternative.
- File watchers for composables/stores/plugins/middleware/layouts were not filtering out `.nuxt`/`.output`/`node_modules`/`dist`, so cache invalidation fired on every Nuxt dev-server regeneration, defeating the reference cache almost entirely during active development.
- `ComponentService`/`ComposableService`/`UtilsService` re-scanned the whole workspace once per referenced symbol instead of once per file, making it noticeably slow on larger projects; reference lookups are now batched per document.
- File type detection (`components`, `stores`, `utils`, ...) matched on substring instead of full path segments, causing false positives on folders like `my-components-lib`.
- Several long-lived file watchers were created but never disposed of when the extension deactivated.

### Removed

- ~1500 lines of dead code (`src/old/old-version.ts`) that were no longer referenced anywhere.

## [0.7.1] - 2025-05-13

### Fixed

- Detect stores api options state, actions or getters detection
- Detect composables computed functions

## [0.7.0] - 2025-05-12

### Added

- Detection of stores and composables functions and variables.

### Changed

- Stores detection.

### Fixed

- Detect components names
