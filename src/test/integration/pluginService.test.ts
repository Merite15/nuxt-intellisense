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
        service = new PluginService();
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
});
