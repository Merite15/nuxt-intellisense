import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StoreService } from '../../services/StoreService';
import { NuxtComponentInfo } from '../../types';
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

describe('StoreService (integration)', () => {
    let tmpDir: string;
    let service: StoreService;
    let cache: Map<string, NuxtComponentInfo[]>;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuxt-intellisense-test-'));
        setFixtureRoot(tmpDir);
        cache = new Map();
        service = new StoreService(cache);
    });

    afterEach(() => {
        service.dispose();
        fs.rmSync(tmpDir, { recursive: true, force: true });
        resetMock();
    });

    it('does not classify a computed() getter as both a variable and a method', async () => {
        const storesDir = path.join(tmpDir, 'stores');
        fs.mkdirSync(storesDir);
        fs.writeFileSync(
            path.join(storesDir, 'user.ts'),
            `import { defineStore } from 'pinia';
export const useUserStore = defineStore('user', () => {
  const name = ref('Alice');
  const isAdmin = computed(() => name.value === 'Alice');
  function login() {}
  return { name, isAdmin, login };
});
`
        );

        await service.scanStoresDirectory(storesDir);

        const storeInfo = cache.get('stores')?.find(s => s.name === 'user');
        assert.ok(storeInfo, 'store should be indexed');
        assert.deepStrictEqual(storeInfo!.members?.getters, ['isAdmin']);
        assert.deepStrictEqual(storeInfo!.members?.variables, ['name']);
        assert.deepStrictEqual(storeInfo!.members?.methods, ['login']);
    });

    it('scopes scanStoresDirectory to the given directory and merges results across multiple store folders', async () => {
        const storesDir = path.join(tmpDir, 'stores');
        fs.mkdirSync(storesDir);
        fs.writeFileSync(
            path.join(storesDir, 'user.ts'),
            `import { defineStore } from 'pinia';
export const useUserStore = defineStore('user', () => ({}));
`
        );

        const adminStoresDir = path.join(tmpDir, 'app', 'modules', 'admin', 'stores');
        fs.mkdirSync(adminStoresDir, { recursive: true });
        fs.writeFileSync(
            path.join(adminStoresDir, 'settings.ts'),
            `import { defineStore } from 'pinia';
export const useSettingsStore = defineStore('settings', () => ({}));
`
        );

        await service.scanStoresDirectory(storesDir);
        await service.scanStoresDirectory(adminStoresDir);

        const names = (cache.get('stores') || []).map(s => s.name).sort();
        assert.deepStrictEqual(names, ['settings', 'user']);

        // Rescanning the same directory should not create duplicate entries
        await service.scanStoresDirectory(storesDir);
        const namesAfterRescan = (cache.get('stores') || []).map(s => s.name).sort();
        assert.deepStrictEqual(namesAfterRescan, ['settings', 'user']);
    });

    it('flags two stores that define the same Pinia id', async () => {
        const storesDir = path.join(tmpDir, 'stores');
        fs.mkdirSync(storesDir);
        fs.writeFileSync(
            path.join(storesDir, 'user.ts'),
            `import { defineStore } from 'pinia';\nexport const useUserStore = defineStore('user', () => ({}));\n`
        );

        const adminDir = path.join(storesDir, 'admin');
        fs.mkdirSync(adminDir);
        const adminStoreFile = path.join(adminDir, 'user.ts');
        fs.writeFileSync(
            adminStoreFile,
            `import { defineStore } from 'pinia';\nexport const useAdminUserStore = defineStore('user', () => ({}));\n`
        );

        await service.scanStoresDirectory(storesDir);
        await service.scanStoresDirectory(adminDir);

        const doc = makeDocument(adminStoreFile);
        const lenses = await service.provideCodeLenses(doc);

        const conflictLens = lenses.find(l => /\$\(warning\)/.test((l.command as any)?.title ?? ''));
        assert.ok(conflictLens, 'expected a duplicate store id warning lens');
        assert.match((conflictLens!.command as any).title, /"user"/);
    });

    it('does not leak the exported hook name as a fake "variable" for a store using an implicit arrow return', async () => {
        const storesDir = path.join(tmpDir, 'stores');
        fs.mkdirSync(storesDir);
        fs.writeFileSync(
            path.join(storesDir, 'settings.ts'),
            `import { defineStore } from 'pinia';\nexport const useSettingsStore = defineStore('settings', () => ({}));\n`
        );

        await service.scanStoresDirectory(storesDir);

        const storeInfo = cache.get('stores')?.find(s => s.name === 'settings');
        assert.ok(storeInfo, 'store should be indexed');
        // "useSettingsStore" (the exported const name, not returned by the composition
        // function) must not be picked up as one of the store's own variables.
        assert.deepStrictEqual(storeInfo!.members?.variables, []);
    });

    it('offers a "search in workspace" lens next to a 0-reference store', async () => {
        const storesDir = path.join(tmpDir, 'stores');
        fs.mkdirSync(storesDir);
        const storeFile = path.join(storesDir, 'orphan.ts');
        fs.writeFileSync(
            storeFile,
            `import { defineStore } from 'pinia';\nexport const useOrphanStore = defineStore('orphan', () => ({}));\n`
        );

        await service.scanStoresDirectory(storesDir);

        const doc = makeDocument(storeFile);
        const lenses = await service.provideCodeLenses(doc);

        const mainLens = lenses.find(l => /\$\(database\)/.test((l.command as any)?.title ?? ''));
        assert.ok(mainLens, 'expected the main store lens');
        assert.match((mainLens!.command as any).title, /0 reference/);

        const searchLens = lenses.find(l => (l.command as any)?.command === 'workbench.action.findInFiles');
        assert.ok(searchLens, 'expected a companion "search in workspace" lens');
        assert.deepStrictEqual((searchLens!.command as any).arguments[0], { query: 'orphan', triggerSearch: true });
    });
});
