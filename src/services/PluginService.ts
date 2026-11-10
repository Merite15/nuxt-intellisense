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

    private duplicateProvideKeysCache: { keys: Map<string, string[]>, timestamp: number } | null = null;
    private duplicateProvideKeysCacheTTL: number = 600000; // 10 minutes

    constructor(private nuxtProjectRoot: string) {
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
                this.duplicateProvideKeysCache = null;
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

            // Un plugin qui n'expose ni `provide` ni `directive` (ex: un plugin qui se
            // contente d'appeler `nuxtApp.vueApp.use(...)` pour enregistrer une dépendance
            // globale) n'a rien qu'un autre fichier puisse référencer par nom : Nuxt
            // l'applique automatiquement, comme server/middleware et server/plugins. Compter
            // des "références" n'a alors pas de sens et affichait à tort "0 references",
            // signalé comme du code potentiellement mort.
            if (!this.pluginExposesApi(text)) {
                lenses.push(
                    new vscode.CodeLens(range, {
                        title: '$(plug) Enregistré automatiquement par Nuxt (aucune API exposée à référencer)',
                        command: ''
                    })
                );

                continue;
            }

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

            // Une seule occurrence de definePageMeta par fichier plugin en pratique :
            // le check de doublon de clés provide n'a besoin d'être fait qu'une fois.
            await this.appendDuplicateProvideKeyLenses(document, text, range, lenses);
        }

        return lenses;
    }

    /**
     * Deux plugins qui appellent `nuxtApp.provide('clé', ...)` avec la même clé
     * s'écrasent silencieusement à l'exécution (le second gagne). On le signale.
     */
    private async appendDuplicateProvideKeyLenses(
        document: vscode.TextDocument,
        text: string,
        range: vscode.Range,
        lenses: vscode.CodeLens[]
    ): Promise<void> {
        const thisFileKeys = this.extractProvideKeys(text);
        if (thisFileKeys.size === 0) {
            return;
        }

        const duplicateKeys = await this.getCachedDuplicateProvideKeys();

        for (const key of thisFileKeys) {
            const conflictingPaths = (duplicateKeys.get(key) || []).filter(p => p !== document.uri.fsPath);

            if (conflictingPaths.length === 0) {
                continue;
            }

            const conflictLocations = conflictingPaths.map(
                p => new vscode.Location(vscode.Uri.file(p), new vscode.Position(0, 0))
            );

            lenses.push(
                new vscode.CodeLens(range, {
                    title: `$(warning) Clé provide "${key}" en conflit avec ${conflictingPaths.length} autre plugin${conflictingPaths.length > 1 ? 's' : ''}`,
                    command: 'editor.action.showReferences',
                    arguments: [
                        document.uri,
                        range.start,
                        conflictLocations
                    ]
                })
            );
        }
    }

    /**
     * Un plugin "expose une API" s'il fournit au moins une clé `provide` ou une directive
     * Vue — c'est-à-dire quelque chose qu'un autre fichier peut référencer explicitement
     * par nom. Un plugin qui se contente d'un `nuxtApp.vueApp.use(...)` (enregistrement
     * d'une dépendance globale) n'expose rien de tel.
     */
    private pluginExposesApi(content: string): boolean {
        if (this.extractProvideKeys(content).size > 0) {
            return true;
        }

        return /nuxtApp\.vueApp\.directive\s*\(/.test(content);
    }

    private extractProvideKeys(content: string): Set<string> {
        const keys = new Set<string>();

        const provideRegex = /nuxtApp\.provide\s*\(\s*['"`]([$\w]+)['"`]/g;
        let match: RegExpExecArray | null;

        while ((match = provideRegex.exec(content)) !== null) {
            keys.add(match[1]);
        }

        const provideObjectHeaderRegex = /provide\s*:\s*\{/g;
        let headerMatch: RegExpExecArray | null;

        while ((headerMatch = provideObjectHeaderRegex.exec(content)) !== null) {
            const openIndex = headerMatch.index + headerMatch[0].length - 1;
            const closeIndex = this.findMatchingBraceIndex(content, openIndex);

            if (closeIndex === -1) {
                continue;
            }

            const block = content.slice(openIndex + 1, closeIndex);

            for (const entry of this.splitTopLevelEntries(block)) {
                const trimmed = entry.trim();

                if (!trimmed) {
                    continue;
                }

                const keyValueMatch = trimmed.match(/^['"`]?([$\w]+)['"`]?\s*:/);

                if (keyValueMatch) {
                    keys.add(keyValueMatch[1]);
                } else if (/^[$\w]+$/.test(trimmed)) {
                    keys.add(trimmed);
                }
            }

            provideObjectHeaderRegex.lastIndex = closeIndex + 1;
        }

        return keys;
    }

    /**
     * Trouve l'index de l'accolade fermante correspondant à l'accolade ouvrante
     * située à `openIndex`, en ignorant les accolades trouvées dans des chaînes,
     * template literals et commentaires. Retourne -1 si non trouvée.
     */
    private findMatchingBraceIndex(content: string, openIndex: number): number {
        let depth = 0;
        let i = openIndex;

        while (i < content.length) {
            const char = content[i];

            if (char === '"' || char === "'" || char === '`') {
                i = this.skipStringLiteral(content, i);
                continue;
            }

            if (char === '/' && content[i + 1] === '/') {
                const newline = content.indexOf('\n', i);
                i = newline === -1 ? content.length : newline + 1;
                continue;
            }

            if (char === '/' && content[i + 1] === '*') {
                const end = content.indexOf('*/', i + 2);
                i = end === -1 ? content.length : end + 2;
                continue;
            }

            if (char === '{') {
                depth++;
            } else if (char === '}') {
                depth--;
                if (depth === 0) {
                    return i;
                }
            }

            i++;
        }

        return -1;
    }

    /**
     * Avance l'index au-delà d'une chaîne (simple/double quote ou template literal),
     * en gérant les échappements et les interpolations `${...}` imbriquées.
     */
    private skipStringLiteral(content: string, startIndex: number): number {
        const quote = content[startIndex];
        let i = startIndex + 1;

        while (i < content.length) {
            const char = content[i];

            if (char === '\\') {
                i += 2;
                continue;
            }

            if (quote === '`' && char === '$' && content[i + 1] === '{') {
                const closeIndex = this.findMatchingBraceIndex(content, i + 1);
                i = closeIndex === -1 ? content.length : closeIndex + 1;
                continue;
            }

            if (char === quote) {
                return i + 1;
            }

            i++;
        }

        return i;
    }

    /**
     * Découpe un bloc d'objet (contenu entre `{` et `}`, exclus) en entrées de
     * premier niveau, en respectant l'imbrication des accolades/parenthèses/
     * crochets et les chaînes de caractères.
     */
    private splitTopLevelEntries(block: string): string[] {
        const entries: string[] = [];
        let depth = 0;
        let start = 0;
        let i = 0;

        while (i < block.length) {
            const char = block[i];

            if (char === '"' || char === "'" || char === '`') {
                i = this.skipStringLiteral(block, i);
                continue;
            }

            if (char === '/' && block[i + 1] === '/') {
                const newline = block.indexOf('\n', i);
                i = newline === -1 ? block.length : newline + 1;
                continue;
            }

            if (char === '/' && block[i + 1] === '*') {
                const end = block.indexOf('*/', i + 2);
                i = end === -1 ? block.length : end + 2;
                continue;
            }

            if (char === '{' || char === '(' || char === '[') {
                depth++;
            } else if (char === '}' || char === ')' || char === ']') {
                depth--;
            } else if (char === ',' && depth === 0) {
                entries.push(block.slice(start, i));
                start = i + 1;
            }

            i++;
        }

        entries.push(block.slice(start));

        return entries;
    }

    private async getCachedDuplicateProvideKeys(): Promise<Map<string, string[]>> {
        const now = Date.now();

        if (this.duplicateProvideKeysCache && (now - this.duplicateProvideKeysCache.timestamp < this.duplicateProvideKeysCacheTTL)) {
            return this.duplicateProvideKeysCache.keys;
        }

        const keys = await this.computeDuplicateProvideKeys();

        this.duplicateProvideKeysCache = { keys, timestamp: now };

        return keys;
    }

    private async computeDuplicateProvideKeys(): Promise<Map<string, string[]>> {
        const dirs = await FileUtils.findAllDirsByName(this.nuxtProjectRoot, 'plugins');
        const pathsByKey = new Map<string, string[]>();

        for (const dir of dirs) {
            const files = await vscode.workspace.findFiles(new vscode.RelativePattern(dir, '**/*.{ts,js}'));

            for (const file of files) {
                // Un fichier de test (test/plugins/x.spec.ts) n'est pas un vrai plugin
                if (FileUtils.isTestFile(file.fsPath, this.nuxtProjectRoot)) {
                    continue;
                }

                let content: string;
                try {
                    content = fs.readFileSync(file.fsPath, 'utf-8');
                } catch {
                    continue;
                }

                for (const key of this.extractProvideKeys(content)) {
                    const paths = pathsByKey.get(key) || [];
                    if (!paths.includes(file.fsPath)) {
                        paths.push(file.fsPath);
                    }
                    pathsByKey.set(key, paths);
                }
            }
        }

        const duplicates = new Map<string, string[]>();
        for (const [key, paths] of pathsByKey) {
            if (paths.length > 1) {
                duplicates.set(key, paths);
            }
        }

        return duplicates;
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
            provides = [...this.extractProvideKeys(pluginContent)];

            // Directive detection
            const directiveRegex = /nuxtApp\.vueApp\.directive\s*\(\s*['\"`]([\w-]+)['\"`]/g;

            let match: RegExpExecArray | null;

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