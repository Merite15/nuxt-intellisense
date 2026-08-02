import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PageMetaValidationService } from '../../services/PageMetaValidationService';
import { Uri, resetMock, setFixtureRoot } from '../mocks/vscode';

function makeDocument(fsPath: string) {
    const text = fs.readFileSync(fsPath, 'utf-8');
    const uri = Uri.file(fsPath);

    return {
        uri,
        fileName: fsPath,
        getText: () => text
    } as any;
}

describe('PageMetaValidationService (integration)', () => {
    let tmpDir: string;
    let service: PageMetaValidationService;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuxt-intellisense-test-'));
        setFixtureRoot(tmpDir);

        fs.mkdirSync(path.join(tmpDir, 'middleware'));
        fs.writeFileSync(
            path.join(tmpDir, 'middleware', 'auth.ts'),
            `export default defineNuxtRouteMiddleware(() => {});\n`
        );

        fs.mkdirSync(path.join(tmpDir, 'layouts'));
        fs.writeFileSync(
            path.join(tmpDir, 'layouts', 'dashboard.vue'),
            `<script setup lang="ts"></script>\n<template><div><slot /></div></template>\n`
        );

        service = new PageMetaValidationService(tmpDir);
    });

    afterEach(() => {
        service.dispose();
        fs.rmSync(tmpDir, { recursive: true, force: true });
        resetMock();
    });

    it('flags a middleware name that does not match any file (typo)', async () => {
        const pagesDir = path.join(tmpDir, 'pages');
        fs.mkdirSync(pagesDir);
        const pageFile = path.join(pagesDir, 'index.vue');
        fs.writeFileSync(
            pageFile,
            `<script setup lang="ts">\ndefinePageMeta({ middleware: 'atuh' });\n</script>\n`
        );

        const diagnostics = await service.validateDocument(makeDocument(pageFile));

        assert.strictEqual(diagnostics.length, 1);
        assert.match(diagnostics[0].message, /aucun middleware nommé "atuh"/);
    });

    it('flags a layout name that does not match any file (typo)', async () => {
        const pagesDir = path.join(tmpDir, 'pages');
        fs.mkdirSync(pagesDir);
        const pageFile = path.join(pagesDir, 'index.vue');
        fs.writeFileSync(
            pageFile,
            `<script setup lang="ts">\ndefinePageMeta({ layout: 'dashbord' });\n</script>\n`
        );

        const diagnostics = await service.validateDocument(makeDocument(pageFile));

        assert.strictEqual(diagnostics.length, 1);
        assert.match(diagnostics[0].message, /aucun layout nommé "dashbord"/);
    });

    it('does not flag valid middleware/layout names', async () => {
        const pagesDir = path.join(tmpDir, 'pages');
        fs.mkdirSync(pagesDir);
        const pageFile = path.join(pagesDir, 'index.vue');
        fs.writeFileSync(
            pageFile,
            `<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'dashboard' });
</script>
`
        );

        const diagnostics = await service.validateDocument(makeDocument(pageFile));

        assert.strictEqual(diagnostics.length, 0);
    });

    it('flags a phantom middleware inside a middleware array', async () => {
        const pagesDir = path.join(tmpDir, 'pages');
        fs.mkdirSync(pagesDir);
        const pageFile = path.join(pagesDir, 'index.vue');
        fs.writeFileSync(
            pageFile,
            `<script setup lang="ts">
definePageMeta({ middleware: ['auth', 'checking-tkoen'] });
</script>
`
        );

        const diagnostics = await service.validateDocument(makeDocument(pageFile));

        assert.strictEqual(diagnostics.length, 1);
        assert.match(diagnostics[0].message, /aucun middleware nommé "checking-tkoen"/);
    });

    it('does not flag a .global.ts middleware name (it is applied automatically, not referenced by name)', async () => {
        fs.writeFileSync(
            path.join(tmpDir, 'middleware', 'analytics.global.ts'),
            `export default defineNuxtRouteMiddleware(() => {});\n`
        );

        const pagesDir = path.join(tmpDir, 'pages');
        fs.mkdirSync(pagesDir);
        const pageFile = path.join(pagesDir, 'index.vue');
        fs.writeFileSync(
            pageFile,
            `<script setup lang="ts">\ndefinePageMeta({ middleware: 'analytics' });\n</script>\n`
        );

        const diagnostics = await service.validateDocument(makeDocument(pageFile));

        // 'analytics' n'existe que comme middleware .global.ts : ce n'est pas un nom
        // référençable explicitement, donc c'est bien une référence fantôme.
        assert.strictEqual(diagnostics.length, 1);
    });

    it('flags a phantom layout declared with the object form', async () => {
        const pagesDir = path.join(tmpDir, 'pages');
        fs.mkdirSync(pagesDir);
        const pageFile = path.join(pagesDir, 'index.vue');
        fs.writeFileSync(
            pageFile,
            `<script setup lang="ts">
definePageMeta({
    layout: {
        name: 'dashbord',
        props: { title: 'Tableau de bord' }
    }
});
</script>
`
        );

        const diagnostics = await service.validateDocument(makeDocument(pageFile));

        assert.strictEqual(diagnostics.length, 1);
        assert.match(diagnostics[0].message, /aucun layout nommé "dashbord"/);
    });
});
