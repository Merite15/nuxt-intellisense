# 🔍 Nuxt Intellisense

**An extension for VS Code that revolutionizes your Nuxt 3 development experience**

## ✨ Key Features

### 📊 Smart Visualization

- **Real-time reference count** for:
  - 🧩 Vue/Nuxt components (including custom components in the `pages` folder)
  - 🔄 Composables
  - 🗃️ Pinia stores (including individual methods, variables and getters)
  - 🖼️ Layouts
  - 🔌 Plugins (including custom directives)
  - 🔗 Middlewares
  - 🌐 `server/api` and `server/routes` Nitro event handlers (including dynamic `[id]` segments)
  - 🔧 Utility files such as `utils`, `lib`, `helpers`, `constants`, etc.

### 🩺 Code Health

- **Unused symbol detection**: any symbol with 0 detected references is flagged as a hint in the Problems panel, so dead exports are easy to spot without leaving the editor.
- **Duplicate component name detection**: warns when two different `.vue` files resolve to the same Nuxt auto-import name (e.g. `components/ui/Button.vue` and `components/common/Button.vue` both resolving to `Button`), with a one-click link to the conflicting files.

### 🗂️ Nuxt Structure Explorer

A dedicated panel in the VS Code Explorer sidebar lists your project's components, composables, stores, plugins, middleware, layouts, server API routes and utils by category, for quick navigation across a large codebase. Refresh it from its toolbar button after adding new files.

### 🎯 Nuxt 3 Precision

- Detection of **auto-imports** across components and composables.
- Support for **multi-line components** (components with multiple lines and dynamic usage).
- Fully compatible with **TypeScript** and **JavaScript** for enhanced typing and error detection.

### ⚡ Seamless Integration

- **Highlighting** within the source file to easily locate references.
- **Quick navigation** to references by simply clicking on them.
- **Real-time updates** as you modify your code, keeping everything synced.
- Native VS Code **codicons** in every CodeLens, matching your current theme.

## ⚙️ Settings

| Setting | Default | Description |
|---|---|---|
| `nuxt-intellisense.showWelcomeMessage` | `true` | Show the welcome message when the extension activates. |
| `nuxt-intellisense.showUnusedWarnings` | `true` | Report symbols with 0 detected references as hints in the Problems panel. |
| `nuxt-intellisense.ignoredDirectories` | `["utils","lib","helpers","constants","shared","public","config","assets"]` | Directory names excluded from component/composable/store reference search, on top of `node_modules`, `.nuxt`, `.output` and `dist` (always excluded). Adjust this if your project uses a different folder layout. |

## 🛠 Troubleshooting

- If you encounter issues with the extension, try restarting VS Code after installation.
- Ensure that your Nuxt project is correctly configured with the `nuxt.config.js`/`nuxt.config.ts` file for the extension to recognize auto-imports.
- Reference counts are cached for a few minutes for performance; editing a file invalidates its own cache immediately. Use the `Nuxt Intellisense: Refresh Nuxt CodeLens` command if you ever see a stale count.

## 🖥 Screenshot

![Demo](./images/demo/1.png)
![Demo](./images/demo/2.png)
_Visual representation of component and composable references in action._

## 🚀 Installation

1. Open VS Code
2. Go to the Extensions panel (Ctrl+Shift+X)
3. Search for "Nuxt Intellisense"
4. Click Install

## 💡 Practical Examples

```vue
<!-- 5 usages detected for the composable -->
export const useData() { }

<!-- 3 usages detected for the components -->
<script setup>
const { data } = useData()  <!-- Composable -->
</script>

<template></template>
```

## 🧪 Development & Tests

```bash
npm install
npm run compile   # Build the extension (out/)
npm test          # Run the unit/integration test suite
npm run watch      # Rebuild on change while developing
```

The test suite runs against a lightweight in-process mock of the `vscode` API (see `src/test/mocks/vscode.ts`), so it executes in milliseconds without downloading or launching a real VS Code instance. Tests live under `src/test/unit` (pure logic: path/text/file utilities) and `src/test/integration` (service-level behavior, including regression tests for previously fixed bugs).
