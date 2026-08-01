import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ServerApiService } from '../../services/ServerApiService';
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

describe('ServerApiService (integration)', () => {
    let tmpDir: string;
    let service: ServerApiService;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuxt-intellisense-test-'));
        setFixtureRoot(tmpDir);
        service = new ServerApiService();
    });

    afterEach(() => {
        service.dispose();
        fs.rmSync(tmpDir, { recursive: true, force: true });
        resetMock();
    });

    it('matches a dynamic route ([id].get.ts -> /api/users/:id) against a useFetch call', async () => {
        const apiDir = path.join(tmpDir, 'server', 'api', 'users');
        fs.mkdirSync(apiDir, { recursive: true });
        const routeFile = path.join(apiDir, '[id].get.ts');
        fs.writeFileSync(
            routeFile,
            `export default defineEventHandler((event) => {
  return { id: getRouterParam(event, 'id') };
});
`
        );

        const pagesDir = path.join(tmpDir, 'pages');
        fs.mkdirSync(pagesDir);
        fs.writeFileSync(
            path.join(pagesDir, 'index.vue'),
            `<script setup lang="ts">
const { data } = await useFetch('/api/users/42');
</script>
`
        );

        const doc = makeDocument(routeFile);
        const lenses = await service.provideCodeLenses(doc);

        assert.strictEqual(lenses.length, 1);
        assert.match((lenses[0].command as any).title, /\$\(server\) 1 reference \| \/api\/users\/:id/);
    });

    it('reports 0 references for a route that is never called', async () => {
        const apiDir = path.join(tmpDir, 'server', 'api');
        fs.mkdirSync(apiDir, { recursive: true });
        const routeFile = path.join(apiDir, 'health.get.ts');
        fs.writeFileSync(
            routeFile,
            `export default defineEventHandler(() => ({ ok: true }));\n`
        );

        const doc = makeDocument(routeFile);
        const lenses = await service.provideCodeLenses(doc);

        assert.strictEqual(lenses.length, 1);
        assert.match((lenses[0].command as any).title, /\$\(server\) 0 reference \| \/api\/health/);
    });
});
