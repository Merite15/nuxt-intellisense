import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { TextUtils } from '../utils/textUtils';
import { FileUtils } from '../utils/fileUtils';

interface ReferenceCache {
    references: vscode.Location[];
    timestamp: number;
}

export class PluginService {
    private referenceCache: Map<string, ReferenceCache> = new Map();

    private referenceCacheTTL: number = 300000;

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

        const defineNuxtPluginRegex = /defineNuxtPlugin\s*\(/g;

        let match: RegExpExecArray | null;

        while ((match = defineNuxtPluginRegex.exec(text))) {
            const pos = document.positionAt(match.index);

            const range = new vscode.Range(pos.line, 0, pos.line, 0);

            const pluginName = path.basename(document.fileName, path.extname(document.fileName));

            // Use cache for references
            const cacheKey = `${document.uri.toString()}:${pluginName}`;

            const references = await this.getCachedReferences(cacheKey, pluginName);

            const referenceCount = references.length;

            lenses.push(
                new vscode.CodeLens(range, {
                    title: `$(plug) ${referenceCount} reference${referenceCount > 1 ? 's' : ''}`,
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

    private async getCachedReferences(cacheKey: string, pluginName: string): Promise<vscode.Location[]> {
        const now = Date.now();

        const cachedData = this.referenceCache.get(cacheKey);

        // Retourner les références en cache si elles sont encore valides
        if (cachedData && (now - cachedData.timestamp < this.referenceCacheTTL)) {
            return cachedData.references;
        }

        // Sinon, rechercher les références et les stocker dans le cache
        const references = await this.findPluginReferences(pluginName);

        this.referenceCache.set(cacheKey, {
            references,
            timestamp: now
        });

        return references;
    }

    async findPluginReferences(pluginName: string): Promise<vscode.Location[]> {
        const references: vscode.Location[] = [];
        const addedReferences = new Set<string>();

        const pluginUris = await vscode.workspace.findFiles(
            `**/plugins/${pluginName}.{js,ts}`,
            '{**/node_modules/**,**/.nuxt/**,**/.output/**,**/dist/**}'
        );

        if (pluginUris.length === 0) {
            return references;
        }

        const pluginPath = pluginUris[0].fsPath;

        let pluginContent: string;
        try {
            pluginContent = fs.readFileSync(pluginPath, 'utf-8');
        } catch (e) {
            return references;
        }

        let provides: string[] = [];

        let hasDirectives: boolean = false;

        let directives: string[] = [];

        try {
            // Classic provide detection
            const provideRegex = /nuxtApp\.provide\s*\(\s*['\"`]([$\w]+)['\"`]/g;

            let match: RegExpExecArray | null;

            while ((match = provideRegex.exec(pluginContent))) {
                provides.push(match[1]);
            }

            // Advanced provide detection
            const provideObjectRegex = /provide\s*:\s*\{([\s\S]*?)\}/g;

            const keyRegex = /(?:['\"`]?([$\w]+)['\"`]?\s*:|(\\b[$\w]+),)/g;

            let provideObjectMatch: RegExpExecArray | null;

            while ((provideObjectMatch = provideObjectRegex.exec(pluginContent))) {
                const keysBlock = provideObjectMatch[1];

                let keyMatch: RegExpExecArray | null;

                while ((keyMatch = keyRegex.exec(keysBlock))) {
                    const key = keyMatch[1] || keyMatch[2];

                    if (key) {
                        provides.push(key);
                    }
                }
            }

            provides = [...new Set(provides)];

            // Directive detection
            const directiveRegex = /nuxtApp\.vueApp\.directive\s*\(\s*['\"`]([\w-]+)['\"`]/g;

            while ((match = directiveRegex.exec(pluginContent))) {
                hasDirectives = true;

                directives.push(match[1]);
            }

            directives = [...new Set(directives)];
        } catch (e) {
            return references;
        }

        const allFileUris = await vscode.workspace.findFiles(
            '**/*.{vue,js,ts}',
            '{**/node_modules/**,**/.nuxt/**,**/.output/**,**/dist/**}'
        );

        for (const uri of allFileUris) {
            if (uri.fsPath.includes('.nuxt') || uri.fsPath === pluginPath) {
                continue;
            }

            try {
                const fileContent = fs.readFileSync(uri.fsPath, 'utf-8');

                // Check provides usage
                for (const key of provides) {
                    const patterns = [
                        new RegExp(`useNuxtApp\\(\\)\\s*\\.\\s*\\$${key}\\b`, 'g'),

                        new RegExp(`(const|let|var)\\s+\\{[^}]*\\$${key}\\b[^}]*\\}\\s*=\\s*(useNuxtApp\\(\\)|nuxtApp)`, 'g'),

                        new RegExp(`nuxtApp\\s*\\.\\s*\\$${key}\\b`, 'g'),

                        new RegExp(`Vue\\.prototype\\.\\$${key}\\b`, 'g'),

                        new RegExp(`app\\.\\$${key}\\b`, 'g'),

                        new RegExp(`this\\.\\$${key}\\b`, 'g'),

                        new RegExp(`const\\s+nuxtApp\\s*=\\s*useNuxtApp\\(\\)[^]*?\\{[^}]*\\$${key}\\b[^}]*\\}\\s*=\\s*nuxtApp`, 'gs'),

                        new RegExp(`const\\s*\\{\\s*\\$${key}\\s*\\}\\s*=\\s*useNuxtApp\\(\\)`, 'g')
                    ];

                    for (const regex of patterns) {
                        let match: RegExpExecArray | null;

                        while ((match = regex.exec(fileContent))) {
                            const refKey = `${uri.fsPath}:${match.index}`;

                            if (!addedReferences.has(refKey)) {
                                addedReferences.add(refKey);

                                const start = TextUtils.indexToPosition(fileContent, match.index);

                                const end = TextUtils.indexToPosition(fileContent, match.index + match[0].length);

                                references.push(new vscode.Location(
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

                // Check directives usage
                if (hasDirectives) {
                    for (const directive of directives) {
                        const directiveRegex = new RegExp(`\\sv-${directive}\\b|\\s:v-${directive}\\b`, 'g');

                        let match: RegExpExecArray | null;

                        while ((match = directiveRegex.exec(fileContent))) {
                            const refKey = `${uri.fsPath}:${match.index}`;
                            if (!addedReferences.has(refKey)) {
                                addedReferences.add(refKey);

                                const start = TextUtils.indexToPosition(fileContent, match.index);

                                const end = TextUtils.indexToPosition(fileContent, match.index + match[0].length);

                                references.push(new vscode.Location(
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

                // Check direct imports
                const importRegex = new RegExp(`import\\s+[^;]*['"\`]~/plugins/${pluginName}['"\`]`, 'g');

                let match: RegExpExecArray | null;

                while ((match = importRegex.exec(fileContent))) {
                    const refKey = `${uri.fsPath}:${match.index}`;
                    if (!addedReferences
                        .has(refKey)) {
                        addedReferences.add(refKey);

                        const start = TextUtils.indexToPosition(fileContent, match.index);

                        const end = TextUtils.indexToPosition(fileContent, match.index + match[0].length);

                        references.push(new vscode.Location(
                            uri,
                            new vscode.Range(
                                new vscode.Position(start.line, start.character),
                                new vscode.Position(end.line, end.character)
                            )
                        ));
                    }
                }
            } catch (e) {
                console.error('[findPluginReferences] Error analyzing file:', uri.fsPath, e);
            }
        }

        return references;
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