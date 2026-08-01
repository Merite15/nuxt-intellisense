import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PathUtils } from '../../utils/pathUtils';

describe('PathUtils', () => {
    describe('pascalToKebabCase', () => {
        it('converts a simple PascalCase name', () => {
            assert.strictEqual(PathUtils.pascalToKebabCase('MyButton'), 'my-button');
        });

        it('converts a single word', () => {
            assert.strictEqual(PathUtils.pascalToKebabCase('Button'), 'button');
        });

        it('handles consecutive uppercase letters', () => {
            assert.strictEqual(PathUtils.pascalToKebabCase('UIButton'), 'ui-button');
        });

        it('handles names with digits', () => {
            assert.strictEqual(PathUtils.pascalToKebabCase('Icon404'), 'icon404');
        });
    });

    describe('resolveWithExtension', () => {
        let tmpDir: string;

        beforeEach(() => {
            tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuxt-intellisense-test-'));
        });

        afterEach(() => {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('returns the path unchanged if it already has a valid extension', () => {
            const filePath = path.join(tmpDir, 'foo.ts');
            assert.strictEqual(PathUtils.resolveWithExtension(filePath), filePath);
        });

        it('appends the extension of the file that actually exists on disk', () => {
            const base = path.join(tmpDir, 'foo');
            fs.writeFileSync(`${base}.vue`, '');

            assert.strictEqual(PathUtils.resolveWithExtension(base), `${base}.vue`);
        });

        it('resolves to an index file inside a directory', () => {
            const dir = path.join(tmpDir, 'composables');
            fs.mkdirSync(dir);
            fs.writeFileSync(path.join(dir, 'index.ts'), '');

            assert.strictEqual(PathUtils.resolveWithExtension(dir), path.join(dir, 'index.ts'));
        });

        it('falls back to the original path when nothing matches', () => {
            const missing = path.join(tmpDir, 'does-not-exist');
            assert.strictEqual(PathUtils.resolveWithExtension(missing), missing);
        });
    });

    describe('isImportPointingToFile', () => {
        let tmpDir: string;

        beforeEach(() => {
            tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuxt-intellisense-test-'));
        });

        afterEach(() => {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('resolves a relative import to the target file', () => {
            const targetFile = path.join(tmpDir, 'utils', 'format.ts');
            fs.mkdirSync(path.dirname(targetFile));
            fs.writeFileSync(targetFile, '');

            const importingFile = path.join(tmpDir, 'pages', 'index.vue');
            fs.mkdirSync(path.dirname(importingFile));

            const result = PathUtils.isImportPointingToFile('../utils/format', importingFile, targetFile, tmpDir);
            assert.strictEqual(result, true);
        });

        it('resolves an alias import (~/) to the target file', () => {
            const targetFile = path.join(tmpDir, 'utils', 'format.ts');
            fs.mkdirSync(path.dirname(targetFile));
            fs.writeFileSync(targetFile, '');

            const importingFile = path.join(tmpDir, 'pages', 'index.vue');

            const result = PathUtils.isImportPointingToFile('~/utils/format', importingFile, targetFile, tmpDir);
            assert.strictEqual(result, true);
        });

        it('returns false for an unrelated import path', () => {
            const targetFile = path.join(tmpDir, 'utils', 'format.ts');
            const importingFile = path.join(tmpDir, 'pages', 'index.vue');

            const result = PathUtils.isImportPointingToFile('vue', importingFile, targetFile, tmpDir);
            assert.strictEqual(result, false);
        });
    });
});
