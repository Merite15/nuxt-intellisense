import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PluginService } from '../../services/PluginService';
import { Position, Uri, resetMock, setFixtureRoot } from '../mocks/vscode';

function makeDocument(fsPath: string) {
    const text = fs.readFileSync(fsPath, 'utf-8');
    const uri = Uri.file(fsPath);

    return {
        uri,
        fileName: fsPath,
        getText: () => text,
        positionAt(offset: number) {
            const before = text.slice(0, offset);
            const lines = before.split('\n');
            return new Position(lines.length - 1, lines[lines.length - 1].length);
        }
    } as any;
}

describe('PluginService (integration)', () => {
    let tmpDir: string;
    let service: PluginService;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuxt-intellisense-test-'));
        setFixtureRoot(tmpDir);
        service = new PluginService(tmpDir);
    });

    afterEach(() => {
        service.dispose();
        fs.rmSync(tmpDir, { recursive: true, force: true });
        resetMock();
    });

    it('counts a plugin usage that lives inside a stores/ file (previously excluded from the search)', async () => {
        const pluginsDir = path.join(tmpDir, 'plugins');
        fs.mkdirSync(pluginsDir);
        fs.writeFileSync(
            path.join(pluginsDir, 'analytics.ts'),
            `export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.provide('analytics', { track: (e: string) => {} });
});
`
        );

        const storesDir = path.join(tmpDir, 'stores');
        fs.mkdirSync(storesDir);
        fs.writeFileSync(
            path.join(storesDir, 'user.ts'),
            `import { defineStore } from 'pinia';

export const useUserStore = defineStore('user', () => {
  function login() {
    const nuxtApp = useNuxtApp();
    nuxtApp.$analytics.track('login');
  }
  return { login };
});
`
        );

        const doc = makeDocument(path.join(pluginsDir, 'analytics.ts'));
        const lenses = await service.provideCodeLenses(doc);

        assert.strictEqual(lenses.length, 1);
        assert.match((lenses[0].command as any).title, /\$\(plug\) 1 reference/);
    });

    it('counts a usage of a shorthand `provide: { key }` object property (no colon, destructured as $key)', async () => {
        const pluginsDir = path.join(tmpDir, 'plugins');
        fs.mkdirSync(pluginsDir);
        fs.writeFileSync(
            path.join(pluginsDir, 'scroll.ts'),
            `export default defineNuxtPlugin(() => {
  const scrollToElement = () => {};

  return {
    provide: {
      scrollToElement,
    },
  };
});
`
        );

        const composablesDir = path.join(tmpDir, 'composables');
        fs.mkdirSync(composablesDir);
        fs.writeFileSync(
            path.join(composablesDir, 'useFormSubmission.ts'),
            `export function useFormSubmission() {
  const { $scrollToElement } = useNuxtApp();
  $scrollToElement();
}
`
        );

        const doc = makeDocument(path.join(pluginsDir, 'scroll.ts'));
        const lenses = await service.provideCodeLenses(doc);

        assert.strictEqual(lenses.length, 1);
        assert.match((lenses[0].command as any).title, /\$\(plug\) 1 reference/);
    });

    it('does not report "0 references" for a plugin that only registers a Vue dependency (nuxtApp.vueApp.use)', async () => {
        const pluginsDir = path.join(tmpDir, 'plugins');
        fs.mkdirSync(pluginsDir);
        fs.writeFileSync(
            path.join(pluginsDir, 'apexcharts.ts'),
            `import VueApexCharts from "vue3-apexcharts";

export default defineNuxtPlugin((nuxtApp) => {
    nuxtApp.vueApp.use(VueApexCharts);
});
`
        );

        const doc = makeDocument(path.join(pluginsDir, 'apexcharts.ts'));
        const lenses = await service.provideCodeLenses(doc);

        assert.strictEqual(lenses.length, 1);
        const title = (lenses[0].command as any).title;
        assert.doesNotMatch(title, /\b0 references?\b/);
        assert.match(title, /Enregistré automatiquement/);
    });

    it('flags two plugins that provide the same key', async () => {
        const pluginsDir = path.join(tmpDir, 'plugins');
        fs.mkdirSync(pluginsDir);
        fs.writeFileSync(
            path.join(pluginsDir, 'analytics.ts'),
            `export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.provide('tracker', { track: (e: string) => {} });
});
`
        );
        fs.writeFileSync(
            path.join(pluginsDir, 'legacy-analytics.ts'),
            `export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.provide('tracker', { track: (e: string) => {} });
});
`
        );

        const doc = makeDocument(path.join(pluginsDir, 'analytics.ts'));
        const lenses = await service.provideCodeLenses(doc);

        const conflictLens = lenses.find(l => /\$\(warning\)/.test((l.command as any)?.title ?? ''));
        assert.ok(conflictLens, 'expected a duplicate provide-key warning lens');
        assert.match((conflictLens!.command as any).title, /"tracker"/);
    });

    it('does not flag a provide key that is unique', async () => {
        const pluginsDir = path.join(tmpDir, 'plugins');
        fs.mkdirSync(pluginsDir);
        fs.writeFileSync(
            path.join(pluginsDir, 'analytics.ts'),
            `export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.provide('tracker', { track: (e: string) => {} });
});
`
        );

        const doc = makeDocument(path.join(pluginsDir, 'analytics.ts'));
        const lenses = await service.provideCodeLenses(doc);

        const conflictLens = lenses.find(l => /\$\(warning\)/.test((l.command as any)?.title ?? ''));
        assert.strictEqual(conflictLens, undefined);
    });
});
