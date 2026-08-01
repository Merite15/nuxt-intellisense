import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { FileUtils } from '../utils/fileUtils';
import { TextUtils } from '../utils/textUtils';

interface ReferenceCache {
    references: vscode.Location[];
    timestamp: number;
}

interface RouteInfo {
    displayPath: string;
    pattern: RegExp;
}

/**
 * @author Merite15
 * @created 2026-08-01
 */
export class ServerApiService {
    private referenceCache: Map<string, ReferenceCache> = new Map();
    private referenceCacheTTL: number = 300000; // 5 minutes
    private fileWatcher: vscode.FileSystemWatcher | undefined;

    constructor() {
        this.setupFileWatcher();
    }

    private setupFileWatcher() {
        this.fileWatcher = vscode.workspace.createFileSystemWatcher(
            '**/*.{vue,ts,js}',
            false,
            false,
            false
        );

        const onFileEvent = (uri: vscode.Uri) => {
            if (!FileUtils.shouldSkipFile(uri.fsPath)) {
                this.invalidateReferenceCache();
            }
        };

        this.fileWatcher.onDidChange(onFileEvent);
        this.fileWatcher.onDidCreate(onFileEvent);
        this.fileWatcher.onDidDelete(onFileEvent);

        vscode.Disposable.from(this.fileWatcher);
    }

    async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        const lenses: vscode.CodeLens[] = [];

        const routeInfo = this.getRouteInfoForFile(document.fileName);
        if (!routeInfo) {
            return lenses;
        }

        const text = document.getText();

        const handlerRegex = /export\s+default\s+(?:defineEventHandler|eventHandler|defineWebSocketHandler)\s*\(/g;

        let match: RegExpExecArray | null;

        while ((match = handlerRegex.exec(text))) {
            const pos = document.positionAt(match.index);
            const range = new vscode.Range(pos.line, 0, pos.line, 0);

            const cacheKey = `${document.uri.toString()}:${routeInfo.displayPath}`;
            const references = await this.getCachedReferences(cacheKey, routeInfo.pattern);
            const referenceCount = references.length;

            lenses.push(
                new vscode.CodeLens(range, {
                    title: `$(server) ${referenceCount} reference${referenceCount > 1 ? 's' : ''} | ${routeInfo.displayPath}`,
                    command: 'editor.action.showReferences',
                    arguments: [
                        document.uri,
                        pos,
                        references
                    ]
                })
            );
        }

        return lenses;
    }

    /**
     * Dérive le chemin de route Nitro à partir du chemin de fichier
     * (server/api/users/[id].get.ts -> /api/users/:id) et construit le pattern
     * de recherche associé (segments dynamiques traités comme des jokers).
     */
    private getRouteInfoForFile(filePath: string): RouteInfo | null {
        const segments = filePath.split(path.sep);
        const serverIndex = segments.lastIndexOf('server');
        if (serverIndex === -1 || serverIndex + 1 >= segments.length) {
            return null;
        }

        const kind = segments[serverIndex + 1];
        if (kind !== 'api' && kind !== 'routes') {
            return null;
        }

        const relativeSegments = segments.slice(serverIndex + 2);
        if (relativeSegments.length === 0) {
            return null;
        }

        const fileName = relativeSegments[relativeSegments.length - 1];
        const extMatch = fileName.match(/^(.*?)(?:\.(get|post|put|delete|patch|head|options))?\.(ts|js|mjs)$/);
        if (!extMatch) {
            return null;
        }

        const baseName = extMatch[1];
        const pathParts = [...relativeSegments.slice(0, -1), baseName].filter(Boolean);

        if (pathParts[pathParts.length - 1]?.toLowerCase() === 'index') {
            pathParts.pop();
        }

        const prefix = kind === 'api' ? '/api' : '';

        const parsedParts = pathParts.map(part => {
            const catchAll = part.match(/^\[\.\.\.(\w+)\]$/);
            if (catchAll) {
                return { dynamic: true, catchAll: true, name: catchAll[1] };
            }

            const dynamic = part.match(/^\[(\w+)\]$/);
            if (dynamic) {
                return { dynamic: true, catchAll: false, name: dynamic[1] };
            }

            return { dynamic: false, catchAll: false, value: part };
        });

        const displaySegments = parsedParts.map(p => p.dynamic ? `:${p.name}` : p.value);
        const displayPath = `${prefix}/${displaySegments.join('/')}`;

        const patternSegments = parsedParts.map(p => {
            if (p.dynamic) {
                return p.catchAll ? '.+' : `[^\\/'"\`]+`;
            }
            return this.escapeRegExp(p.value!);
        });

        const pattern = new RegExp(`${this.escapeRegExp(prefix)}\\/${patternSegments.join('\\/')}(?:[/'"\`?]|$)`);

        return { displayPath, pattern };
    }

    private escapeRegExp(value: string): string {
        return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    private async getCachedReferences(cacheKey: string, pattern: RegExp): Promise<vscode.Location[]> {
        const now = Date.now();
        const cachedData = this.referenceCache.get(cacheKey);

        if (cachedData && (now - cachedData.timestamp < this.referenceCacheTTL)) {
            return cachedData.references;
        }

        const references = await this.findRouteReferences(pattern);

        this.referenceCache.set(cacheKey, {
            references,
            timestamp: now
        });

        return references;
    }

    private async findRouteReferences(pattern: RegExp): Promise<vscode.Location[]> {
        const results: vscode.Location[] = [];

        const uris = await vscode.workspace.findFiles(
            '**/*.{vue,ts,js}',
            FileUtils.buildExcludeGlob()
        );

        const callRegex = /(?:\$fetch|useFetch|useLazyFetch)\s*\(\s*(['"`])((?:(?!\1).)*)\1/g;

        for (const uri of uris) {
            let content: string;
            try {
                content = fs.readFileSync(uri.fsPath, 'utf-8');
            } catch (e) {
                continue;
            }

            callRegex.lastIndex = 0;
            let match: RegExpExecArray | null;

            while ((match = callRegex.exec(content)) !== null) {
                const urlArg = match[2];

                if (!pattern.test(`${urlArg}/`) && !pattern.test(urlArg)) {
                    continue;
                }

                const argStart = match.index + match[0].indexOf(urlArg, match[0].indexOf(match[1]) + 1);

                const start = TextUtils.indexToPosition(content, argStart);
                const end = TextUtils.indexToPosition(content, argStart + urlArg.length);

                results.push(new vscode.Location(
                    uri,
                    new vscode.Range(
                        new vscode.Position(start.line, start.character),
                        new vscode.Position(end.line, end.character)
                    )
                ));
            }
        }

        return results;
    }

    public invalidateReferenceCache(): void {
        this.referenceCache.clear();
    }

    public dispose(): void {
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
        }
    }
}
