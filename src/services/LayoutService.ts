import * as vscode from 'vscode';
import * as fs from 'fs';
import { TextUtils } from '../utils/textUtils';
import { FileUtils } from '../utils/fileUtils';
import * as path from 'path';

interface ReferenceCache {
    references: vscode.Location[];
    timestamp: number;
}

export class LayoutService {
    private referenceCache: Map<string, ReferenceCache> = new Map();
    private referenceCacheTTL: number = 300000; // 5 minutes
    private fileWatcher: vscode.FileSystemWatcher | undefined;

    constructor() {
        this.setupFileWatcher();
    }

    private setupFileWatcher() {
        this.fileWatcher = vscode.workspace.createFileSystemWatcher(
            '**/*.{vue,js,ts}',
            false, // Ne pas ignorer les créations
            false, // Ne pas ignorer les changements
            false  // Ne pas ignorer les suppressions
        );

        // (en ignorant node_modules/.nuxt/.output/dist, régénérés en continu par Nuxt en dev)
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
        const text = document.getText();
        const layoutSetupRegex = /<script\s+setup[^>]*>|<template>/g;
        let match: RegExpExecArray | null;

        if ((match = layoutSetupRegex.exec(text))) {
            const pos = document.positionAt(match.index);
            const range = new vscode.Range(pos.line, 0, pos.line, 0);

            // Layout name based on file name
            const layoutName = path.basename(document.fileName, '.vue');

            // Use cache for references
            const cacheKey = `${document.uri.toString()}:${layoutName}`;
            const references = await this.getCachedReferences(cacheKey, layoutName);
            const referenceCount = references.length;

            if (layoutName === 'default') {
                lenses.push(
                    new vscode.CodeLens(range, {
                        title: `$(layout) Default Layout`,
                        command: ''
                    })
                );
            } else {
                lenses.push(
                    new vscode.CodeLens(range, {
                        title: `$(layout) ${referenceCount} reference${referenceCount > 1 ? 's' : ''}`,
                        command: referenceCount > 0 ? 'editor.action.showReferences' : '',
                        arguments: referenceCount > 0
                            ? [document.uri, pos, references]
                            : undefined
                    })
                );
            }
        } else {
        }

        return lenses;
    }

    private async getCachedReferences(cacheKey: string, layoutName: string): Promise<vscode.Location[]> {
        const now = Date.now();
        const cachedData = this.referenceCache.get(cacheKey);

        // Retourner les références en cache si elles sont encore valides
        if (cachedData && (now - cachedData.timestamp < this.referenceCacheTTL)) {
            return cachedData.references;
        }

        // Sinon, rechercher les références et les stocker dans le cache
        const references = await this.findLayoutReferences(layoutName);

        this.referenceCache.set(cacheKey, {
            references,
            timestamp: now
        });

        return references;
    }

    /**
     * Find references for a layout
     */
    private async findLayoutReferences(layoutName: string): Promise<vscode.Location[]> {
        const results: vscode.Location[] = [];

        // Find explicit references in Vue files
        const vueFiles = await vscode.workspace.findFiles(
            '**/*.vue',
            '{**/node_modules/**,**/.nuxt/**,**/.output/**,**/dist/**}'
        );

        for (const uri of vueFiles) {
            try {
                const content = fs.readFileSync(uri.fsPath, 'utf-8');

                const regex = new RegExp(`layout\\s*:\\s*(['"\`])${layoutName}\\1`, 'g');

                let match;

                while ((match = regex.exec(content)) !== null) {
                    const start = TextUtils.indexToPosition(content, match.index);

                    const end = TextUtils.indexToPosition(content, match.index + match[0].length);

                    results.push(new vscode.Location(
                        uri,
                        new vscode.Range(
                            new vscode.Position(start.line, start.character),
                            new vscode.Position(end.line, end.character)
                        )
                    ));
                }
            } catch (e) {
                continue;
            }
        }

        // Find references in Nuxt config files
        const configFiles = await vscode.workspace.findFiles(
            '**/nuxt.config.{js,ts}',
            '{**/node_modules/**,**/.nuxt/**,**/.output/**,**/dist/**,**/utils/**,**/lib/**,**/helpers/**,**/constants/**,**/shared/**, **/public/**,**/config/**, **/assets/**,**/store/**,**/stores/**}'
        );

        for (const uri of configFiles) {
            try {
                const content = fs.readFileSync(uri.fsPath, 'utf-8');

                // Recherche spécifique de layout: 'layoutName' dans les hooks de configuration
                const layoutInHookRegex = new RegExp(`layout\\s*:\\s*(['"\`])${layoutName}\\1`, 'g');
                let layoutMatch;

                while ((layoutMatch = layoutInHookRegex.exec(content)) !== null) {
                    // Vérifier que ce layout est dans un hook pages:extend
                    const previousContent = content.substring(0, layoutMatch.index);

                    if (previousContent.lastIndexOf('pages:extend') !== -1) {
                        const start = TextUtils.indexToPosition(content, layoutMatch.index);

                        const end = TextUtils.indexToPosition(content, layoutMatch.index + layoutMatch[0].length);

                        results.push(new vscode.Location(
                            uri,
                            new vscode.Range(
                                new vscode.Position(start.line, start.character),
                                new vscode.Position(end.line, end.character)
                            )
                        ));
                    }
                }
            } catch (e) {
                continue;
            }
        }

        return results;
    }

    // Méthode pour invalider le cache pour les tests ou un rafraîchissement manuel
    public invalidateReferenceCache(): void {
        this.referenceCache.clear();
    }

    // Libérer les ressources utilisées par le service
    public dispose(): void {
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
        }
    }
}