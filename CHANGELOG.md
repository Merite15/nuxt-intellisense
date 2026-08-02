# Changelog

All notable changes to this project will be documented in this file.

## [0.9.0] - 2026-08-01

### Added

- **Duplicate `provide` key detection**: two plugins calling `nuxtApp.provide('key', ...)` (classic or `provide: {...}` object form) with the same key silently overwrite one another at runtime — now flagged as a warning CodeLens on each conflicting plugin, project-wide.
- **Unknown `definePageMeta` key detection**: a top-level key that's a near-miss (Levenshtein distance ≤ 2) of a known Nuxt page-meta key (`midleware` vs `middleware`) is flagged as a likely typo with a suggested correction. Deliberately conservative — keys that aren't close to any known key are left alone, since many Nuxt modules add their own `definePageMeta` keys via type augmentation, and a strict allow-list would produce constant false positives on those.
- **`server/middleware` and `server/plugins` coverage**: both now appear as categories in the "Nuxt Structure" explorer, and a new `ServerMiddlewarePluginService` flags two Nitro files sharing the same name within the same category (a common leftover from refactors). Reference counting isn't meaningful here since Nitro applies these automatically rather than via named references.
- **Hover preview for components**: hovering a component tag (`<MyButton>` / `<my-button>`) in a `.vue` template shows its live reference count and a link to its definition file, without needing to open it. Reuses the exact same `ComponentService` logic and cache as the CodeLens, so counts always match.

## [0.8.4] - 2026-08-01

### Added

- **Phantom reference detection**: a new `PageMetaValidationService` flags `middleware`/`layout` names referenced in `definePageMeta` (string, array, or object form) or in `routeRules`' `appMiddleware`/`appLayout` that don't match any file found in the project, as a warning in the Problems panel — catches typos in these plain-string references, the mirror image of the existing "0 references" dead-code detection. Toggle with `nuxt-intellisense.showPhantomReferenceErrors`. Correctly excludes `.global.ts` middleware, which is never referenced by name.
- **Duplicate name detection extended to composables and stores** (previously components only): composables are auto-imported by their exported function name rather than by file path, so two different files exporting the same name (e.g. two `useAuth`) now trigger a conflict warning; similarly, two `defineStore(...)` calls sharing the same store id — even across unrelated files — are now flagged.

## [0.8.3] - 2026-08-01

### Fixed

- The "Nuxt Structure" view was visible even in workspaces without a `nuxt.config.js`/`.ts` (any open folder would show it, using the workspace root as a fallback). Since VS Code 1.74, views and commands declared in `contributes` implicitly activate the extension on their own — independently of the `workspaceContains:nuxt.config.*` activation events — so the view's real content depended entirely on whether a project root was actually detected, with no visual indication when it wasn't. A `nuxtIntellisense.isNuxtProject` context key now gates the view's visibility (`when` clause) so it only appears on genuine Nuxt projects.

## [0.8.2] - 2026-08-01

### Security

- Forced `uuid` to `>=11.1.1` (resolved to `14.0.1`) via a `pnpm-workspace.yaml` override, fixing the last remaining moderate-severity advisory (out-of-bounds buffer writes in `v3()`/`v5()`/`v6()` when called with an explicit output buffer) nested inside `@vscode/vsce > @azure/identity > @azure/msal-node`. `uuid@14` is ESM-only, which could in principle break a CommonJS `require('uuid')` — verified this doesn't affect `vsce package` or loading `@azure/msal-node` in practice, since the only code path that actually invokes `uuid` there is `vsce`'s optional Azure AD login/publish flow, unused by this project. `pnpm audit` now reports zero known vulnerabilities.

## [0.8.1] - 2026-08-01

### Fixed

- Project root detection stopped at the first ancestor directory containing both `nuxt.config.ts` and `package.json`/`.git`. In a monorepo using local Nuxt layers (`layers/<name>/`) that ship their own `nuxt.config.ts` **and** `package.json`, opening a file inside a layer would incorrectly scope the whole extension to that layer instead of the actual project root. Root detection now prefers the outermost matching ancestor. The duplicate implementation of this logic (one in `NuxtIntellisense`, one in `FileUtils`) has also been consolidated into a single `FileUtils.findNuxtProjectRoot`.
- `middleware`/`layout` usages declared in `definePageMeta({ ... })` were missed whenever an *earlier* property in the same object was itself a nested object (e.g. the newer `layout: { name, props }` form) — the regex used to isolate the `definePageMeta` object stopped at the first `}` it found, which belonged to the nested object, cutting off everything declared after it (including `middleware: '...'`). Parsing now walks balanced braces instead (new `TextUtils.extractBalancedBlock`). The object form of `layout` (`layout: { name: 'x', props: {...} }`) is also now detected, not just the plain string form.
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
