import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileUtils } from '../../utils/fileUtils';
import { resetMock, setConfig } from '../mocks/vscode';

describe('FileUtils', () => {
    afterEach(() => {
        resetMock();
    });

    describe('shouldSkipFile', () => {
        it('flags files under node_modules', () => {
            assert.strictEqual(FileUtils.shouldSkipFile('/project/node_modules/pkg/index.js'), true);
        });

        it('flags files under .nuxt', () => {
            assert.strictEqual(FileUtils.shouldSkipFile('/project/.nuxt/imports.d.ts'), true);
        });

        it('does not flag a regular project file', () => {
            assert.strictEqual(FileUtils.shouldSkipFile('/project/components/Button.vue'), false);
        });
    });

    describe('getIgnoredDirectories / buildExcludeGlob', () => {
        it('falls back to the default list when nothing is configured', () => {
            const dirs = FileUtils.getIgnoredDirectories();
            assert.ok(dirs.includes('utils'));
            assert.ok(dirs.includes('assets'));
        });

        it('uses the user-configured list when present', () => {
            setConfig({ 'nuxt-intellisense.ignoredDirectories': ['vendor', 'generated'] });

            const dirs = FileUtils.getIgnoredDirectories();
            assert.deepStrictEqual(dirs, ['vendor', 'generated']);

            const glob = FileUtils.buildExcludeGlob();
            assert.ok(glob.includes('**/vendor/**'));
            assert.ok(glob.includes('**/generated/**'));
            assert.ok(!glob.includes('**/utils/**'));
        });

        it('always excludes node_modules/.nuxt/.output/dist regardless of configuration', () => {
            setConfig({ 'nuxt-intellisense.ignoredDirectories': [] });

            const glob = FileUtils.buildExcludeGlob();
            assert.ok(glob.includes('**/node_modules/**'));
            assert.ok(glob.includes('**/.nuxt/**'));
        });

        it('appends extra directories on top of the configured ones', () => {
            const glob = FileUtils.buildExcludeGlob(['store', 'stores']);
            assert.ok(glob.includes('**/store/**'));
            assert.ok(glob.includes('**/stores/**'));
        });
    });

    describe('findNuxtProjectRoot', () => {
        let tmpDir: string;

        beforeEach(() => {
            tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuxt-intellisense-test-'));
        });

        afterEach(() => {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('finds the root when nuxt.config.ts and package.json sit together', () => {
            fs.writeFileSync(path.join(tmpDir, 'nuxt.config.ts'), '');
            fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');

            const nested = path.join(tmpDir, 'pages');
            fs.mkdirSync(nested);

            const root = FileUtils.findNuxtProjectRoot(path.join(nested, 'index.vue'));
            assert.strictEqual(root, tmpDir);
        });

        it('returns null when no nuxt.config file exists anywhere above', () => {
            const nested = path.join(tmpDir, 'a', 'b', 'c');
            fs.mkdirSync(nested, { recursive: true });

            const root = FileUtils.findNuxtProjectRoot(path.join(nested, 'file.ts'));
            assert.strictEqual(root, null);
        });

        it('falls back to a nuxt.config-only directory when no package.json/.git is found above it', () => {
            const layerDir = path.join(tmpDir, 'layer');
            fs.mkdirSync(layerDir);
            fs.writeFileSync(path.join(layerDir, 'nuxt.config.ts'), '');

            const nested = path.join(layerDir, 'pages');
            fs.mkdirSync(nested);

            const root = FileUtils.findNuxtProjectRoot(path.join(nested, 'index.vue'));
            assert.strictEqual(root, layerDir);
        });
    });
});
