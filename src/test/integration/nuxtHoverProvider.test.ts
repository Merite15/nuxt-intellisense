import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ComponentService } from '../../services/ComponentService';
import { NuxtHoverProvider } from '../../providers/NuxtHoverProvider';
import { Position, Range, Uri, resetMock, setFixtureRoot } from '../mocks/vscode';

function makeVueDocument(fsPath: string) {
    const text = fs.readFileSync(fsPath, 'utf-8');
    const lines = text.split('\n');
    const uri = Uri.file(fsPath);

    return {
        uri,
        fileName: fsPath,
        getText(range?: Range) {
            if (!range) {
                return text;
            }
            return lines[range.start.line].slice(range.start.character, range.end.character);
        },
        lineAt(line: number) {
            return { text: lines[line] };
        },
        getWordRangeAtPosition(position: Position, regex: RegExp) {
            const line = lines[position.line];
            const wordRegex = new RegExp(regex.source, 'g');
            let match: RegExpExecArray | null;

            while ((match = wordRegex.exec(line)) !== null) {
                const start = match.index;
                const end = match.index + match[0].length;

                if (position.character >= start && position.character <= end) {
                    return new Range(position.line, start, position.line, end);
                }
            }

            return undefined;
        }
    } as any;
}

describe('NuxtHoverProvider (integration)', () => {
    let tmpDir: string;
    let componentService: ComponentService;
    let provider: NuxtHoverProvider;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuxt-intellisense-test-'));
        setFixtureRoot(tmpDir);
        componentService = new ComponentService(tmpDir);
        provider = new NuxtHoverProvider(componentService);
    });

    afterEach(() => {
        componentService.dispose();
        fs.rmSync(tmpDir, { recursive: true, force: true });
        resetMock();
    });

    it('shows the reference count when hovering a known component tag', async () => {
        const componentsDir = path.join(tmpDir, 'components');
        fs.mkdirSync(componentsDir);
        fs.writeFileSync(
            path.join(componentsDir, 'MyButton.vue'),
            `<script setup lang="ts">\n</script>\n<template><button /></template>\n`
        );

        const pageFile = path.join(tmpDir, 'pages', 'index.vue');
        fs.mkdirSync(path.dirname(pageFile));
        fs.writeFileSync(
            pageFile,
            `<template>\n  <MyButton />\n  <MyButton />\n</template>\n`
        );

        const doc = makeVueDocument(pageFile);
        // Position inside "MyButton" on line 1 (0-indexed), right after the '<'
        const hover = await provider.provideHover(doc, new Position(1, 5) as any);

        assert.ok(hover, 'expected a hover to be returned');
        assert.match((hover as any).contents.value, /MyButton.*2 references/s);
    });

    it('returns nothing for a plain HTML tag that is not a project component', async () => {
        const componentsDir = path.join(tmpDir, 'components');
        fs.mkdirSync(componentsDir);
        fs.writeFileSync(
            path.join(componentsDir, 'MyButton.vue'),
            `<template><button /></template>\n`
        );

        const pageFile = path.join(tmpDir, 'pages', 'index.vue');
        fs.mkdirSync(path.dirname(pageFile));
        fs.writeFileSync(pageFile, `<template>\n  <div>hello</div>\n</template>\n`);

        const doc = makeVueDocument(pageFile);
        const hover = await provider.provideHover(doc, new Position(1, 4) as any);

        assert.strictEqual(hover, undefined);
    });

    it('returns nothing when hovering a word that is not at a tag position', async () => {
        const componentsDir = path.join(tmpDir, 'components');
        fs.mkdirSync(componentsDir);
        fs.writeFileSync(
            path.join(componentsDir, 'MyButton.vue'),
            `<template><button /></template>\n`
        );

        const pageFile = path.join(tmpDir, 'pages', 'index.vue');
        fs.mkdirSync(path.dirname(pageFile));
        fs.writeFileSync(pageFile, `<script setup lang="ts">\nconst MyButton = 1;\n</script>\n`);

        const doc = makeVueDocument(pageFile);
        // "MyButton" here is a plain identifier, not preceded by '<'
        const hover = await provider.provideHover(doc, new Position(1, 8) as any);

        assert.strictEqual(hover, undefined);
    });
});
