import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StoreService } from '../../services/StoreService';
import { NuxtComponentInfo } from '../../types';
import { resetMock, setFixtureRoot } from '../mocks/vscode';

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
});
