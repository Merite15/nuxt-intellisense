import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { UtilsService } from '../../services/UtilsService';
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

describe('UtilsService (integration)', () => {
    let tmpDir: string;
    let service: UtilsService;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuxt-intellisense-test-'));
        setFixtureRoot(tmpDir);
        service = new UtilsService(tmpDir);
    });

    afterEach(() => {
        service.dispose();
        fs.rmSync(tmpDir, { recursive: true, force: true });
        resetMock();
    });

    it('counts an import once, not twice (import-regex + usage-regex overlap)', async () => {
        const utilsDir = path.join(tmpDir, 'utils');
        fs.mkdirSync(utilsDir);
        const utilsFile = path.join(utilsDir, 'format.ts');
        fs.writeFileSync(utilsFile, `export const search = (q: string) => q.trim();\n`);

        const consumerDir = path.join(tmpDir, 'composables');
        fs.mkdirSync(consumerDir);
        fs.writeFileSync(
            path.join(consumerDir, 'useSearchBox.ts'),
            `import { search } from '~/utils/format';

export function useSearchBox() {
  const run = () => search('x');
  return { run };
}
`
        );

        const doc = makeDocument(utilsFile);
        const exportsFound = [{ name: 'search', position: new Position(0, 13) }];

        const refsByName = await service.findUtilsReferencesForExports(doc, exportsFound as any);
        const refs = refsByName.get('search') || [];

        // One for the import statement, one for the actual call — not three.
        assert.strictEqual(refs.length, 2);
    });

    it('does not count an export name appearing inside an unrelated string literal', async () => {
        const utilsDir = path.join(tmpDir, 'utils');
        fs.mkdirSync(utilsDir);
        const utilsFile = path.join(utilsDir, 'format.ts');
        fs.writeFileSync(utilsFile, `export const search = (q: string) => q.trim();\n`);

        const consumerDir = path.join(tmpDir, 'pages');
        fs.mkdirSync(consumerDir);
        fs.writeFileSync(
            path.join(consumerDir, 'index.vue'),
            `<script setup lang="ts">
const message = "Please search carefully before submitting";
</script>
`
        );

        const doc = makeDocument(utilsFile);
        const exportsFound = [{ name: 'search', position: new Position(0, 13) }];

        const refsByName = await service.findUtilsReferencesForExports(doc, exportsFound as any);
        const refs = refsByName.get('search') || [];

        assert.strictEqual(refs.length, 0);
    });
});
