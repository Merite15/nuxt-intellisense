import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LayoutService } from '../../services/LayoutService';
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

describe('LayoutService (integration)', () => {
    let tmpDir: string;
    let service: LayoutService;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuxt-intellisense-test-'));
        setFixtureRoot(tmpDir);
        service = new LayoutService();
    });

    afterEach(() => {
        service.dispose();
        fs.rmSync(tmpDir, { recursive: true, force: true });
        resetMock();
    });

    it('detects a layout referenced with the object form (layout: { name, props })', async () => {
        const layoutsDir = path.join(tmpDir, 'layouts');
        fs.mkdirSync(layoutsDir);
        const layoutFile = path.join(layoutsDir, 'dashboard.vue');
        fs.writeFileSync(
            layoutFile,
            `<script setup lang="ts">\n</script>\n<template><div><slot /></div></template>\n`
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

        const doc = makeDocument(layoutFile);
        const lenses = await service.provideCodeLenses(doc);

        assert.strictEqual(lenses.length, 1);
        assert.match((lenses[0].command as any).title, /\$\(layout\) 1 reference/);
    });

    it('still detects the plain string form (layout: "name")', async () => {
        const layoutsDir = path.join(tmpDir, 'layouts');
        fs.mkdirSync(layoutsDir);
        const layoutFile = path.join(layoutsDir, 'admin.vue');
        fs.writeFileSync(
            layoutFile,
            `<script setup lang="ts">\n</script>\n<template><div><slot /></div></template>\n`
        );

        const pagesDir = path.join(tmpDir, 'pages');
        fs.mkdirSync(pagesDir);
        fs.writeFileSync(
            path.join(pagesDir, 'index.vue'),
            `<script setup lang="ts">\ndefinePageMeta({ layout: 'admin' });\n</script>\n`
        );

        const doc = makeDocument(layoutFile);
        const lenses = await service.provideCodeLenses(doc);

        assert.strictEqual(lenses.length, 1);
        assert.match((lenses[0].command as any).title, /\$\(layout\) 1 reference/);

        // The reference range must cover only the layout name ("admin"), not the whole
        // `layout: 'admin'` key/value text - otherwise "Go to references" highlights far
        // more than the actual name.
        const [, , references] = (lenses[0].command as any).arguments;
        const range = references[0].range;
        assert.strictEqual(range.end.character - range.start.character, 'admin'.length);
    });

    it('offers a "search in workspace" lens next to a 0-reference layout', async () => {
        const layoutsDir = path.join(tmpDir, 'layouts');
        fs.mkdirSync(layoutsDir);
        const layoutFile = path.join(layoutsDir, 'unused.vue');
        fs.writeFileSync(
            layoutFile,
            `<script setup lang="ts">\n</script>\n<template><div><slot /></div></template>\n`
        );

        const doc = makeDocument(layoutFile);
        const lenses = await service.provideCodeLenses(doc);

        assert.strictEqual(lenses.length, 2);
        assert.match((lenses[0].command as any).title, /\$\(layout\) 0 reference/);

        const searchLens = lenses[1].command as any;
        assert.match(searchLens.title, /\$\(search\)/);
        assert.strictEqual(searchLens.command, 'workbench.action.findInFiles');
        assert.strictEqual(searchLens.arguments[0].query, 'unused');
    });

    it('detects a layout referenced via appLayout in routeRules, even inside a config/ folder', async () => {
        const layoutsDir = path.join(tmpDir, 'layouts');
        fs.mkdirSync(layoutsDir);
        const layoutFile = path.join(layoutsDir, 'dashboard.vue');
        fs.writeFileSync(
            layoutFile,
            `<script setup lang="ts">\n</script>\n<template><div><slot /></div></template>\n`
        );

        // config/ est normalement exclu de la recherche de références (composants,
        // stores, ...) : ce test vérifie que routeRules reste détecté malgré ça.
        const configDir = path.join(tmpDir, 'app', 'config');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
            path.join(configDir, 'route-rules.config.ts'),
            `export const routeRulesConfig = {
    '/dashboard/**': { ssr: false, appLayout: 'dashboard', robots: false },
};
`
        );

        const doc = makeDocument(layoutFile);
        const lenses = await service.provideCodeLenses(doc);

        assert.strictEqual(lenses.length, 1);
        assert.match((lenses[0].command as any).title, /\$\(layout\) 1 reference/);
    });
});
