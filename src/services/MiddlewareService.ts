import * as vscode from 'vscode';
import * as fs from 'fs';
import { TextUtils } from '../utils/textUtils';
import path from 'path';

interface ReferenceCache {
    references: vscode.Location[];
    timestamp: number;
}

export class MiddlewareService {
    private referenceCache: Map<string, ReferenceCache> = new Map();
    private referenceCacheTTL: number = 300000; // 5 minutes comme fallback
    private fileWatcher: vscode.FileSystemWatcher | undefined;

    constructor() {
        this.setupFileWatcher();
    }

    private setupFileWatcher() {
        // Surveiller les changements dans les fichiers Vue, TS et JS
        this.fileWatcher = vscode.workspace.createFileSystemWatcher(
            '**/*.{vue,ts,js}',
            false, // Ne pas ignorer les créations
            false, // Ne pas ignorer les changements
            false  // Ne pas ignorer les suppressions
        );

        // Lors d'un changement de fichier, invalider le cache
        this.fileWatcher.onDidChange(() => this.invalidateReferenceCache());
        this.fileWatcher.onDidCreate(() => this.invalidateReferenceCache());
        this.fileWatcher.onDidDelete(() => this.invalidateReferenceCache());

        // S'assurer que le watcher est disposé lorsqu'il n'est plus nécessaire
        vscode.Disposable.from(this.fileWatcher);
    }

    async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        const lenses: vscode.CodeLens[] = [];
        const text = document.getText();
        const defineNuxtMiddlewareRegex = /defineNuxtRouteMiddleware\s*\(/g;
        let match: RegExpExecArray | null;

        while ((match = defineNuxtMiddlewareRegex.exec(text))) {
            const pos = document.positionAt(match.index);
            const range = new vscode.Range(pos.line, 0, pos.line, 0);
            const middlewareName = path.basename(document.fileName, path.extname(document.fileName));
            const isGlobal = document.fileName.includes('.global.');


            if (isGlobal) {
                lenses.push(
                    new vscode.CodeLens(range, {
                        title: `$(globe) Global Middleware`,
                        command: ''
                    })
                );
            } else {
                const references = await this.getCachedReferences(
                    `${document.uri.toString()}:${middlewareName}`,
                    middlewareName,
                );
                const referenceCount = references.length;

                lenses.push(
                    new vscode.CodeLens(range, {
                        title: `$(link) ${referenceCount} reference${referenceCount > 1 ? 's' : ''}`,
                        command: referenceCount > 0 ? 'editor.action.showReferences' : '',
                        arguments: referenceCount > 0
                            ? [document.uri, pos, references]
                            : undefined
                    })
                );
            }
        }

        return lenses;
    }

    async findMiddlewareReferences(middlewareName: string): Promise<vscode.Location[]> {
        const results: vscode.Location[] = [];

        await this.findVueFileReferences(middlewareName, results);

        await this.findNuxtConfigReferences(middlewareName, results);

        return results;
    }

    private async findVueFileReferences(middlewareName: string, results: vscode.Location[]): Promise<void> {
        const uris = await vscode.workspace.findFiles(
            '**/pages/**/*.vue',
            '{**/node_modules/**,**/.nuxt/**,**/.output/**,**/dist/**,, **/utils/**,**/lib/**,**/helpers/**,**/constants/**,**/shared/**, **/public/**,**/config/**, **/assets/**,**/store/**,**/stores/**}'
        );

        for (const uri of uris) {
            let content: string;
            try {
                content = fs.readFileSync(uri.fsPath, 'utf-8');
            } catch (e) {
                continue;
            }

            const definePageMetaRegex = /definePageMeta\s*\(\s*\{[^}]*\}/g;
            let metaMatch;

            while ((metaMatch = definePageMetaRegex.exec(content)) !== null) {
                const metaContent = metaMatch[0];

                const metaStartIndex = metaMatch.index;

                // Recherche middleware unique
                const singleMiddlewareRegex = new RegExp(`middleware\\s*:\\s*(['"\`])(${middlewareName})\\1`, 'g');
                let singleMatch;

                while ((singleMatch = singleMiddlewareRegex.exec(metaContent)) !== null) {
                    const middlewareValueIndex = metaContent.indexOf(singleMatch[1] + middlewareName + singleMatch[1], singleMatch.index);
                    const exactIndex = metaStartIndex + middlewareValueIndex + 1;

                    const start = TextUtils.indexToPosition(content, exactIndex);
                    const end = TextUtils.indexToPosition(content, exactIndex + middlewareName.length);

                    results.push(new vscode.Location(
                        uri,
                        new vscode.Range(
                            new vscode.Position(start.line, start.character),
                            new vscode.Position(end.line, end.character)
                        )
                    ));
                }

                // Recherche middleware en tableau
                const arrayMiddlewareRegex = /middleware\s*:\s*\[([^\]]*)\]/g;
                let arrayMatch;

                while ((arrayMatch = arrayMiddlewareRegex.exec(metaContent)) !== null) {
                    const arrayContent = arrayMatch[1];
                    const itemRegex = new RegExp(`(['"\`])(${middlewareName})\\1`, 'g');
                    let itemMatch;

                    while ((itemMatch = itemRegex.exec(arrayContent)) !== null) {
                        const arrayStartIndex = metaContent.indexOf(arrayContent, arrayMatch.index);
                        const middlewareInArrayIndex = arrayContent.indexOf(itemMatch[0]);
                        const exactIndex = metaStartIndex + arrayStartIndex + middlewareInArrayIndex + 1;

                        const start = TextUtils.indexToPosition(content, exactIndex);
                        const end = TextUtils.indexToPosition(content, exactIndex + middlewareName.length);

                        results.push(new vscode.Location(
                            uri,
                            new vscode.Range(
                                new vscode.Position(start.line, start.character),
                                new vscode.Position(end.line, end.character)
                            )
                        ));
                    }
                }
            }
        }
    }

    private async findNuxtConfigReferences(middlewareName: string, results: vscode.Location[]): Promise<void> {
        const configFiles = await vscode.workspace.findFiles(
            '**/nuxt.config.{js,ts}',
            '{**/node_modules/**,**/.nuxt/**,**/.output/**,**/dist/**,, **/utils/**,**/lib/**,**/helpers/**,**/constants/**,**/shared/**, **/public/**,**/config/**, **/assets/**,**/store/**,**/stores/**}'
        );

        for (const uri of configFiles) {
            try {
                const content = fs.readFileSync(uri.fsPath, 'utf-8');

                // Recherche middleware unique
                const singleMiddlewareRegex = new RegExp(`middleware\\s*:\\s*(['"\`])(${middlewareName})\\1`, 'g');
                let singleMatch;

                while ((singleMatch = singleMiddlewareRegex.exec(content)) !== null) {
                    const previousContent = content.substring(0, singleMatch.index);

                    if (previousContent.lastIndexOf('pages:extend') !== -1) {
                        const middlewareValueIndex = content.indexOf(singleMatch[1] + middlewareName + singleMatch[1], singleMatch.index);
                        const exactIndex = middlewareValueIndex + 1;

                        const start = TextUtils.indexToPosition(content, exactIndex);
                        const end = TextUtils.indexToPosition(content, exactIndex + middlewareName.length);

                        results.push(new vscode.Location(
                            uri,
                            new vscode.Range(
                                new vscode.Position(start.line, start.character),
                                new vscode.Position(end.line, end.character)
                            )
                        ));
                    }
                }

                // Recherche dans les hooks pages:extend
                const pagesExtendRegex = /'pages:extend'[\s\S]*?{[\s\S]*?}/g;
                let pagesExtendMatch;

                while ((pagesExtendMatch = pagesExtendRegex.exec(content)) !== null) {
                    const hookContent = pagesExtendMatch[0];

                    const arrayMiddlewareRegex = /middleware\s*:\s*\[([^\]]*)\]/g;
                    let arrayMatch;

                    while ((arrayMatch = arrayMiddlewareRegex.exec(hookContent)) !== null) {
                        const arrayContent = arrayMatch[1];
                        const itemRegex = new RegExp(`(['"\`])(${middlewareName})\\1`, 'g');
                        let itemMatch;

                        while ((itemMatch = itemRegex.exec(arrayContent)) !== null) {
                            const hookStartIndex = pagesExtendMatch.index;
                            const arrayStartIndex = hookContent.indexOf(arrayContent, arrayMatch.index);
                            const middlewareInArrayIndex = arrayContent.indexOf(itemMatch[0]);
                            const exactIndex = hookStartIndex + arrayStartIndex + middlewareInArrayIndex + 1;

                            const start = TextUtils.indexToPosition(content, exactIndex);
                            const end = TextUtils.indexToPosition(content, exactIndex + middlewareName.length);

                            results.push(new vscode.Location(
                                uri,
                                new vscode.Range(
                                    new vscode.Position(start.line, start.character),
                                    new vscode.Position(end.line, end.character)
                                )
                            ));
                        }
                    }
                }
            } catch (e) {
                continue;
            }
        }
    }

    public invalidateReferenceCache(): void {
        this.referenceCache.clear();
    }

    public dispose(): void {
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
        }
    }

    private async getCachedReferences(
        cacheKey: string,
        name: string,
    ): Promise<vscode.Location[]> {
        const now = Date.now();
        const cachedData = this.referenceCache.get(cacheKey);

        // Retourner les références en cache si elles sont toujours valides
        if (cachedData && (now - cachedData.timestamp < this.referenceCacheTTL)) {
            return cachedData.references;
        }

        // Sinon, trouver toutes les références et les mettre en cache
        const references = await this.findMiddlewareReferences(name);

        this.referenceCache.set(cacheKey, {
            references,
            timestamp: now
        });

        return references;
    }

}