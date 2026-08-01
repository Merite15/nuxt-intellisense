import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ComponentService } from '../../services/ComponentService';
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

describe('ComponentService (integration)', () => {
    let tmpDir: string;
    let service: ComponentService;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuxt-intellisense-test-'));
        setFixtureRoot(tmpDir);
        service = new ComponentService(tmpDir);
    });

    afterEach(() => {
        service.dispose();
        fs.rmSync(tmpDir, { recursive: true, force: true });
        resetMock();
    });

    it('counts both PascalCase and kebab-case tag usages of a component', async () => {
        const componentsDir = path.join(tmpDir, 'components');
        fs.mkdirSync(componentsDir);
        const componentFile = path.join(componentsDir, 'MyButton.vue');
        fs.writeFileSync(
            componentFile,
            `<script setup lang="ts">\n</script>\n<template><button /></template>\n`
        );

        const pagesDir = path.join(tmpDir, 'pages');
        fs.mkdirSync(pagesDir);
        fs.writeFileSync(
            path.join(pagesDir, 'index.vue'),
            `<template>\n  <MyButton />\n  <my-button />\n</template>\n`
        );

        const doc = makeDocument(componentFile);
        const lenses = await service.provideCodeLenses(doc);

        const mainLens = lenses.find(l => /\$\(package\)/.test((l.command as any)?.title ?? ''));
        assert.ok(mainLens, 'expected a component usage lens');
        assert.match((mainLens!.command as any).title, /2 references/);
    });

    it('flags two components that resolve to the same Nuxt component name', async () => {
        const componentsDir = path.join(tmpDir, 'components');
        fs.mkdirSync(componentsDir);

        fs.writeFileSync(path.join(componentsDir, 'UiMyButton.vue'), `<template><button /></template>\n`);

        const uiDir = path.join(componentsDir, 'ui');
        fs.mkdirSync(uiDir);
        const nestedFile = path.join(uiDir, 'MyButton.vue');
        fs.writeFileSync(nestedFile, `<template><button /></template>\n`);

        const doc = makeDocument(nestedFile);
        const lenses = await service.provideCodeLenses(doc);

        const conflictLens = lenses.find(l => /\$\(warning\)/.test((l.command as any)?.title ?? ''));
        assert.ok(conflictLens, 'expected a duplicate-name warning lens');
        assert.match((conflictLens!.command as any).title, /"UiMyButton"/);
    });

    it('counts a component usage inside app.vue', async () => {
        const componentsDir = path.join(tmpDir, 'components');
        fs.mkdirSync(componentsDir);
        const componentFile = path.join(componentsDir, 'NetworkStatus.vue');
        fs.writeFileSync(
            componentFile,
            `<script setup lang="ts">\n</script>\n<template><div>offline</div></template>\n`
        );

        fs.writeFileSync(
            path.join(tmpDir, 'app.vue'),
            `<template>
  <NuxtLayout>
    <ClientOnly>
      <NetworkStatus />
    </ClientOnly>
    <NuxtPage />
  </NuxtLayout>
</template>
`
        );

        const doc = makeDocument(componentFile);
        const lenses = await service.provideCodeLenses(doc);

        const mainLens = lenses.find(l => /\$\(package\)/.test((l.command as any)?.title ?? ''));
        assert.ok(mainLens, 'expected a component usage lens');
        assert.match((mainLens!.command as any).title, /1 reference/);
    });
});
