import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MiddlewareService } from '../../services/MiddlewareService';
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

describe('MiddlewareService (integration)', () => {
    let tmpDir: string;
    let service: MiddlewareService;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuxt-intellisense-test-'));
        setFixtureRoot(tmpDir);
        service = new MiddlewareService();
    });

    afterEach(() => {
        service.dispose();
        fs.rmSync(tmpDir, { recursive: true, force: true });
        resetMock();
    });

    it('detects a middleware referenced in definePageMeta even when an earlier property (layout) is a nested object', async () => {
        const middlewareDir = path.join(tmpDir, 'middleware');
        fs.mkdirSync(middlewareDir);
        const middlewareFile = path.join(middlewareDir, 'has-company.ts');
        fs.writeFileSync(
            middlewareFile,
            `export default defineNuxtRouteMiddleware((to) => {\n  console.log('checking company');\n});\n`
        );

        const pagesDir = path.join(tmpDir, 'pages');
        fs.mkdirSync(pagesDir);
        fs.writeFileSync(
            path.join(pagesDir, 'index.vue'),
            `<script setup lang="ts">
definePageMeta({
    name: 'Tableau de bord',
    layout: {
        name: 'dashboard',
        props: {
            title: 'Tableau de bord',
            icon: 'lucide:layout-dashboard'
        },
    },
    middleware: 'has-company'
})
</script>
<template><div /></template>
`
        );

        const doc = makeDocument(middlewareFile);
        const lenses = await service.provideCodeLenses(doc);

        assert.strictEqual(lenses.length, 1);
        assert.match((lenses[0].command as any).title, /\$\(link\) 1 reference/);
    });

    it('points the reference range at the middleware name itself, not the `middleware:` key (offset bug)', async () => {
        const middlewareDir = path.join(tmpDir, 'middleware');
        fs.mkdirSync(middlewareDir);
        const middlewareFile = path.join(middlewareDir, 'has-company.ts');
        fs.writeFileSync(
            middlewareFile,
            `export default defineNuxtRouteMiddleware((to) => {});\n`
        );

        const pagesDir = path.join(tmpDir, 'pages');
        fs.mkdirSync(pagesDir);
        const pageContent = `<script setup lang="ts">
definePageMeta({
    middleware: 'has-company'
})
</script>
<template><div /></template>
`;
        fs.writeFileSync(path.join(pagesDir, 'index.vue'), pageContent);

        const doc = makeDocument(middlewareFile);
        const lenses = await service.provideCodeLenses(doc);

        assert.strictEqual(lenses.length, 1);
        assert.match((lenses[0].command as any).title, /\$\(link\) 1 reference/);

        const [, , references] = (lenses[0].command as any).arguments;
        const range = references[0].range;

        const lines = pageContent.split('\n');
        const referencedText = lines[range.start.line].slice(range.start.character, range.end.character);

        assert.strictEqual(referencedText, 'has-company');
    });

    it('detects a middleware referenced via appMiddleware in a routeRules array, even inside a config/ folder', async () => {
        const middlewareDir = path.join(tmpDir, 'middleware');
        fs.mkdirSync(middlewareDir);
        const middlewareFile = path.join(middlewareDir, 'auth.ts');
        fs.writeFileSync(
            middlewareFile,
            `export default defineNuxtRouteMiddleware((to) => {});\n`
        );

        // config/ est normalement exclu de la recherche de références (composants,
        // stores, ...) : ce test vérifie que routeRules reste détecté malgré ça.
        const configDir = path.join(tmpDir, 'app', 'config');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
            path.join(configDir, 'route-rules.config.ts'),
            `export const routeRulesConfig = {
    '/dashboard/**': { ssr: false, appMiddleware: ['auth', 'checking-token'], robots: false },
    '/auth/**': { ssr: false, appMiddleware: ['auth', 'checking-token'], robots: false },
};
`
        );

        const doc = makeDocument(middlewareFile);
        const lenses = await service.provideCodeLenses(doc);

        assert.strictEqual(lenses.length, 1);
        assert.match((lenses[0].command as any).title, /\$\(link\) 2 references/);
    });

    it('offers a "search in workspace" lens next to a 0-reference middleware', async () => {
        const middlewareDir = path.join(tmpDir, 'middleware');
        fs.mkdirSync(middlewareDir);
        const middlewareFile = path.join(middlewareDir, 'has-company.ts');
        fs.writeFileSync(
            middlewareFile,
            `export default defineNuxtRouteMiddleware((to) => {});\n`
        );

        const doc = makeDocument(middlewareFile);
        const lenses = await service.provideCodeLenses(doc);

        assert.strictEqual(lenses.length, 2);
        assert.match((lenses[0].command as any).title, /\$\(link\) 0 reference/);

        const searchLens = lenses[1].command as any;
        assert.match(searchLens.title, /\$\(search\)/);
        assert.strictEqual(searchLens.command, 'workbench.action.findInFiles');
        assert.strictEqual(searchLens.arguments[0].query, 'has-company');
    });
});
