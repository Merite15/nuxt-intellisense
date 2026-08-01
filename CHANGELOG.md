# Changelog

All notable changes to this project will be documented in this file.

## [0.8.0] - 2026-08-01

### Added

- **Unused symbol detection**: any CodeLens reporting "0 references" is now also surfaced as a hint diagnostic in the Problems panel. Toggle with `nuxt-intellisense.showUnusedWarnings`.
- **Configurable ignored directories**: `nuxt-intellisense.ignoredDirectories` setting lets you customize which folders (`utils`, `lib`, `helpers`, ...) are excluded from reference search, instead of a fixed, hardcoded list.
- **Duplicate component name detection**: warns when two different component files resolve to the same Nuxt component name (e.g. `components/ui/Button.vue` and `components/common/Button.vue` both resolving to `Button`), with a quick link to the conflicting files.
- **`server/api` and `server/routes` reference counting**: detects `defineEventHandler`/`eventHandler` handlers, derives the Nitro route path (including dynamic `[id]` segments and `.get`/`.post`/... method suffixes), and counts usages via `$fetch`/`useFetch`/`useLazyFetch` across the project.
- **"Nuxt Structure" explorer view**: a new panel in the Explorer sidebar listing components, composables, stores, plugins, middleware, layouts, server API routes and utils by category, for quick navigation. Refresh via the toolbar button or `nuxt-intellisense.refreshExplorer`.
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
