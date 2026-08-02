import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ServerMiddlewarePluginService } from '../../services/ServerMiddlewarePluginService';
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

describe('ServerMiddlewarePluginService (integration)', () => {
    let tmpDir: string;
    let service: ServerMiddlewarePluginService;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuxt-intellisense-test-'));
        setFixtureRoot(tmpDir);
        service = new ServerMiddlewarePluginService(tmpDir);
    });

    afterEach(() => {
        service.dispose();
        fs.rmSync(tmpDir, { recursive: true, force: true });
        resetMock();
    });

    it('flags two server middleware files sharing the same name', async () => {
        const middlewareDir = path.join(tmpDir, 'server', 'middleware');
        fs.mkdirSync(middlewareDir, { recursive: true });
        fs.writeFileSync(
            path.join(middlewareDir, 'logger.ts'),
            `export default defineEventHandler(() => {});\n`
        );

        const layerMiddlewareDir = path.join(tmpDir, 'layers', 'blog', 'server', 'middleware');
        fs.mkdirSync(layerMiddlewareDir, { recursive: true });
        fs.writeFileSync(
            path.join(layerMiddlewareDir, 'logger.ts'),
            `export default defineEventHandler(() => {});\n`
        );

        const doc = makeDocument(path.join(middlewareDir, 'logger.ts'));
        const lenses = await service.provideCodeLenses(doc);

        assert.strictEqual(lenses.length, 1);
        assert.match((lenses[0].command as any).title, /middleware serveur "logger"/);
    });

    it('does not flag a uniquely-named server plugin, and a middleware name never conflicts with a plugin name', async () => {
        const middlewareDir = path.join(tmpDir, 'server', 'middleware');
        fs.mkdirSync(middlewareDir, { recursive: true });
        fs.writeFileSync(
            path.join(middlewareDir, 'logger.ts'),
            `export default defineEventHandler(() => {});\n`
        );

        const pluginsDir = path.join(tmpDir, 'server', 'plugins');
        fs.mkdirSync(pluginsDir, { recursive: true });
        fs.writeFileSync(
            path.join(pluginsDir, 'logger.ts'),
            `export default defineNitroPlugin(() => {});\n`
        );

        const doc = makeDocument(path.join(pluginsDir, 'logger.ts'));
        const lenses = await service.provideCodeLenses(doc);

        assert.strictEqual(lenses.length, 0);
    });

    it('returns no lens for files outside server/middleware and server/plugins', async () => {
        const middlewareDir = path.join(tmpDir, 'middleware');
        fs.mkdirSync(middlewareDir);
        const file = path.join(middlewareDir, 'auth.ts');
        fs.writeFileSync(file, `export default defineNuxtRouteMiddleware(() => {});\n`);

        const doc = makeDocument(file);
        const lenses = await service.provideCodeLenses(doc);

        assert.strictEqual(lenses.length, 0);
    });
});
