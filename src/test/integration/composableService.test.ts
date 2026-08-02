import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ComposableService } from '../../services/ComposableService';
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

describe('ComposableService (integration)', () => {
    let tmpDir: string;
    let service: ComposableService;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuxt-intellisense-test-'));
        setFixtureRoot(tmpDir);
        service = new ComposableService(tmpDir);
    });

    afterEach(() => {
        service.dispose();
        fs.rmSync(tmpDir, { recursive: true, force: true });
        resetMock();
    });

    it('flags two composables exporting the same function name from different files', async () => {
        const composablesDir = path.join(tmpDir, 'composables');
        fs.mkdirSync(composablesDir);
        fs.writeFileSync(
            path.join(composablesDir, 'useAuth.ts'),
            `export function useAuth() {\n  const user = ref(null);\n  return { user };\n}\n`
        );

        const nestedDir = path.join(composablesDir, 'foo');
        fs.mkdirSync(nestedDir);
        const nestedFile = path.join(nestedDir, 'useAuth.ts');
        fs.writeFileSync(
            nestedFile,
            `export function useAuth() {\n  const token = ref(null);\n  return { token };\n}\n`
        );

        const doc = makeDocument(nestedFile);
        const lenses = await service.provideCodeLenses(doc);

        const conflictLens = lenses.find(l => /\$\(warning\)/.test((l.command as any)?.title ?? ''));
        assert.ok(conflictLens, 'expected a duplicate composable name warning lens');
        assert.match((conflictLens!.command as any).title, /"useAuth"/);
    });

    it('does not flag a composable with a unique name', async () => {
        const composablesDir = path.join(tmpDir, 'composables');
        fs.mkdirSync(composablesDir);
        const file = path.join(composablesDir, 'useCounter.ts');
        fs.writeFileSync(
            file,
            `export function useCounter() {\n  const count = ref(0);\n  return { count };\n}\n`
        );

        const doc = makeDocument(file);
        const lenses = await service.provideCodeLenses(doc);

        const conflictLens = lenses.find(l => /\$\(warning\)/.test((l.command as any)?.title ?? ''));
        assert.strictEqual(conflictLens, undefined);
    });
});
