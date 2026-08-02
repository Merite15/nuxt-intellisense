# 🔍 Nuxt Intellisense

**A VS Code extension that revolutionizes your Nuxt 3 & 4 development experience** — real-time reference counts, dead-code detection and project navigation, right inside the editor.

## Table of Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Key Features](#key-features)
- [Settings](#settings)
- [Commands](#commands)
- [Troubleshooting](#troubleshooting)
- [Development & Tests](#development--tests)
- [License](#license)

## 📋 Requirements

- VS Code `1.60.0` or later.
- A **folder** open in the workspace (not a single loose file) containing a `nuxt.config.js` or `nuxt.config.ts` — this is what triggers the extension's activation and lets it locate your project root.

## 🚀 Installation

1. Open VS Code.
2. Go to the Extensions panel (`Ctrl+Shift+X` / `Cmd+Shift+X`).
3. Search for **"Nuxt Intellisense"**.
4. Click **Install**.

Or from the command line:

```bash
code --install-extension MeriteK.nuxt-intellisense
```

## ✨ Key Features

### 📊 Smart Visualization

**Real-time reference count**, shown as a CodeLens above each definition, for:

  - 🧩 Vue/Nuxt components — including usages in `pages`, `app.vue`/`error.vue`, and both PascalCase/kebab-case tags
  - 🔄 Composables
  - 🗃️ Pinia stores (including individual methods, variables and getters)
  - 🖼️ Layouts — via `definePageMeta` (plain string `layout: 'name'` or object form `layout: { name, props }`) and Nitro `routeRules`' `appLayout` (wherever that config file lives)
  - 🔌 Plugins (including custom directives)
  - 🔗 Middlewares — via `definePageMeta` (string or array), Nitro `routeRules`' `appMiddleware` (string or array, wherever that config file lives), and `.global.ts` files
  - 🌐 `server/api` and `server/routes` Nitro event handlers (including dynamic `[id]` segments and `.get`/`.post`/... method suffixes)
  - 🔧 Utility files such as `utils`, `lib`, `helpers`, `constants`, etc.

Detection follows path **segments**, not a fixed root, so it works the same whether your project uses the Nuxt 3 layout (`components/`, `composables/`, ... at the root) or the Nuxt 4 layout (nested under `app/`), and inside local [Nuxt layers](https://nuxt.com/docs/4.x/getting-started/layers) (`layers/<name>/...`).

### 🩺 Code Health

- **Unused symbol detection**: any symbol with 0 detected references is flagged as a hint in the Problems panel, so dead exports are easy to spot without leaving the editor.
- **Phantom reference detection**: the inverse problem — a `middleware`/`layout` name referenced in `definePageMeta` (string, array, or object form) or in `routeRules`' `appMiddleware`/`appLayout` that doesn't match any actual file is flagged as a warning in the Problems panel. Catches typos (`middleware: 'atuh'`) that TypeScript can't see, since these are plain strings.
- **Unknown `definePageMeta` key detection**: a key that's close to a known one (`midleware` vs `middleware`) is flagged as a likely typo, with a suggestion. Genuinely custom keys added by Nuxt modules (`requiresAuth`, i18n-specific keys, ...) are left alone — only near-misses of the core Nuxt keys are reported, to avoid false positives.
- **Duplicate name detection**: warns when two different files would collide under Nuxt's auto-import rules, with a one-click link to the conflicting files —
  - **components**: two `.vue` files resolving to the same Nuxt component name (e.g. `components/ui/Button.vue` and `components/common/Button.vue` both resolving to `Button`);
  - **composables**: two files exporting a function/const with the same name (composables are auto-imported by function name, not file path);
  - **stores**: two `defineStore(...)` calls using the same store id, regardless of which file they're in;
  - **plugins**: two plugins calling `nuxtApp.provide('key', ...)` (or the `provide: {...}` object form) with the same key, which silently overwrite one another at runtime;
  - **`server/middleware`/`server/plugins`**: two Nitro files sharing the same file name within the same category.

### 🗂️ Nuxt Structure Explorer

A collapsible **"Nuxt Structure"** section is added to the built-in VS Code **Explorer** panel (the file tree, not a separate sidebar icon). It lists your project's components, composables, stores, plugins, middleware, layouts, server API routes, **server middleware**, **server plugins**, utils and **unit/integration test files** (any `*.test.{ts,js}` / `*.spec.{ts,js}`) by category, for quick navigation across a large codebase. Click the refresh icon in its title bar after adding new files to pick up changes.

### 🎯 Nuxt 3 & 4 Precision

- Detection of **auto-imports** across components and composables.
- Support for **multi-line components** (components with multiple lines and dynamic usage).
- Fully compatible with **TypeScript** and **JavaScript** for enhanced typing and error detection.
- Works with both Nuxt 3's default layout and Nuxt 4's `app/`-nested layout, including `~/`/`@/` alias resolution against either `srcDir`.
- Monorepo-aware: project root detection prefers the outermost `nuxt.config.ts` when a local layer also ships its own config, so working inside a layer doesn't lose the rest of the app.

### ⚡ Seamless Integration

- **Highlighting** within the source file to easily locate references.
- **Quick navigation** to references by simply clicking on them.
- **Hover preview**: hovering a component tag (`<MyButton>` or `<my-button>`) in a template shows its reference count and a link to its definition, without having to open the file.
- **Real-time updates** as you modify your code, keeping everything synced.
- Native VS Code **codicons** in every CodeLens, matching your current theme (light/dark).

## ⚙️ Settings

| Setting | Default | Description |
|---|---|---|
| `nuxt-intellisense.showWelcomeMessage` | `true` | Show the welcome message when the extension activates. |
| `nuxt-intellisense.showUnusedWarnings` | `true` | Report symbols with 0 detected references as hints in the Problems panel. |
| `nuxt-intellisense.showPhantomReferenceErrors` | `true` | Report middleware/layout names referenced in `definePageMeta` that don't match any file in the project (likely typos) as warnings in the Problems panel. |
| `nuxt-intellisense.ignoredDirectories` | `["utils","lib","helpers","constants","shared","public","config","assets"]` | Directory names excluded from component/composable/store reference search, on top of `node_modules`, `.nuxt`, `.output` and `dist` (always excluded). Adjust this if your project uses a different folder layout. |

## 📟 Commands

Available from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

| Command | Description |
|---|---|
| `Refresh Nuxt CodeLens` | Force VS Code to re-evaluate the CodeLenses in the active editor. |
| `Show Nuxt Intellisense Documentation` | Opens this project's documentation. |
| `Refresh Nuxt Explorer` | Re-scans the project and refreshes the "Nuxt Structure" panel (also available as a toolbar icon on the panel itself). |

## 🛠 Troubleshooting

- If you encounter issues with the extension, try restarting VS Code after installation.
- Ensure that your Nuxt project is correctly configured with a `nuxt.config.js`/`nuxt.config.ts` file **at or above** the folder you have open, so the extension can locate your project root and recognize auto-imports.
- The "Nuxt Structure" panel only appears when a folder (not a single file) is open in the workspace and a `nuxt.config.js`/`.ts` is found.
- Reference counts are cached for a few minutes for performance; editing a file invalidates its own cache immediately. Use the `Refresh Nuxt CodeLens` command if you ever see a stale count.

## 🖥 Screenshots

![Demo](./images/demo/1.png)
![Demo](./images/demo/2.png)
_Visual representation of component and composable references in action._

## 💡 Practical Example

Given a composable:

```ts
// composables/useData.ts
export function useData() {
  const items = ref([])
  return { items }
}
```

...used in three different places, the extension shows the count directly above the definition:

```ts
// $(sync) 3 references
export function useData() {
  const items = ref([])
  return { items }
}
```

Clicking the CodeLens opens the standard "Find References" view with all three usage locations.

## 🧪 Development & Tests

```bash
npm install
npm run compile   # Build the extension (out/)
npm run watch      # Rebuild on change while developing
npm test          # Run the unit/integration test suite
npm run package    # Produce a distributable .vsix
```

The test suite runs against a lightweight in-process mock of the `vscode` API (see `src/test/mocks/vscode.ts`), so it executes in milliseconds without downloading or launching a real VS Code instance.

- `src/test/unit` — pure logic: path/text/file utilities.
- `src/test/integration` — service-level behavior, including regression tests for previously fixed bugs.

## 📄 License

[MIT](./license.txt) © MeriteK
