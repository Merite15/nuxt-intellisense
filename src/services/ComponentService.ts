import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { PathUtils } from '../utils/pathUtils';
import { FileUtils } from '../utils/fileUtils';
import { TextUtils } from '../utils/textUtils';
import { ComponentMetadata, ComponentPropInfo, ComponentSlotInfo } from '../types';

interface ReferenceCache {
    references: vscode.Location[];
    timestamp: number;
}

interface ComponentDirsCache {
    dirs: string[];
    timestamp: number;
}

interface MetadataCache {
    metadata: ComponentMetadata;
    mtimeMs: number;
}

interface StalePropInfo {
    name: string;
    /** Balises parentes qui transmettent encore cette prop. */
    locations: vscode.Location[];
}

export class ComponentService {
    private referenceCache: Map<string, ReferenceCache> = new Map();
    private componentDirsCache: ComponentDirsCache | null = null;
    private componentNameCache: Map<string, string> = new Map(); // Cache pour les noms de composants par chemin
    private referenceCacheTTL: number = 300000; // 5 minutes
    private dirsCacheTTL: number = 600000; // 10 minutes
    private fileWatcher: vscode.FileSystemWatcher | undefined;
    private initialized: boolean = false;
    private duplicateNamesCache: { names: Map<string, string[]>, timestamp: number } | null = null;
    private duplicateNamesCacheTTL: number = 600000; // 10 minutes, aligné sur le cache des répertoires
    private metadataCache: Map<string, MetadataCache> = new Map();
    private stalePropsCache: Map<string, { mtimeMs: number, result: StalePropInfo[] }> = new Map();

    constructor(
        private nuxtProjectRoot: string
    ) {
    }

    /**
     * Initialise le service de composants une seule fois
     */
    public async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        // Précharger les répertoires de composants (coûteux)
        await this.getCachedComponentDirs();

        // Mettre en place un watcher ciblé pour les fichiers Vue
        this.setupFileWatcher();

        this.initialized = true;
    }

    private setupFileWatcher() {
        // Surveiller TOUS les fichiers Vue du projet : un composant peut être
        // référencé depuis n'importe quel fichier (page, layout, autre composant,
        // app.vue...), pas seulement depuis components/. Se limiter à ce dossier
        // faisait que retirer un <MonComposant /> d'une page ne rafraîchissait
        // jamais son compteur de références.
        this.fileWatcher = vscode.workspace.createFileSystemWatcher(
            '**/*.vue',
            false, // Ne pas ignorer les créations
            false, // Ne pas ignorer les changements
            false  // Ne pas ignorer les suppressions
        );

        this.fileWatcher.onDidChange(uri => this.invalidateOnFileEvent(uri.fsPath));
        this.fileWatcher.onDidCreate(uri => this.invalidateOnFileEvent(uri.fsPath));
        this.fileWatcher.onDidDelete(uri => this.invalidateOnFileEvent(uri.fsPath));

        // S'assurer que le watcher est disposé lorsqu'il n'est plus nécessaire
        vscode.Disposable.from(this.fileWatcher);
    }

    /**
     * Invalide les caches concernés par un fichier Vue modifié/créé/supprimé.
     */
    private invalidateOnFileEvent(filePath: string): void {
        // N'importe quel fichier peut avoir gagné ou perdu une référence à
        // n'importe quel composant : impossible de cibler précisément une entrée,
        // donc on vide tout le cache de références plutôt que de risquer un
        // compteur périmé.
        this.referenceCache.clear();

        // Les props "mortes" dépendent à la fois du composant ET des parents qui le
        // transmettent : n'importe quel fichier modifié peut invalider le calcul.
        this.stalePropsCache.clear();

        // Le fichier lui-même a pu changer de props/slots.
        this.metadataCache.delete(filePath);

        // Un fichier créé/déplacé/supprimé peut changer l'ensemble des noms en conflit
        this.duplicateNamesCache = null;
    }

    async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        // S'assurer que l'initialisation est faite
        await this.initialize();

        const lenses: vscode.CodeLens[] = [];

        const fileName = path.basename(document.fileName);

        if (fileName === 'app.vue' || fileName === 'error.vue') {
            return [];
        }

        // Utiliser la version mise en cache des répertoires
        const allComponentDirs = await this.getCachedComponentDirs();

        // Obtenir le nom du composant Nuxt à partir du cache
        let nuxtComponentName = this.getCachedComponentName(document.uri.fsPath);

        if (!nuxtComponentName) {
            // On ne l'a pas encore dans le cache, le calculer
            for (const dir of allComponentDirs) {
                if (document.uri.fsPath.startsWith(dir)) {
                    nuxtComponentName = this.getNuxtComponentName(document.uri.fsPath, dir);
                    // Mettre en cache pour une utilisation future
                    this.componentNameCache.set(document.uri.fsPath, nuxtComponentName);
                    break;
                }
            }
        } else {
        }

        // Avertir si un autre composant du projet résout au même nom Nuxt
        // (ex: components/ui/Button.vue et components/common/Button.vue -> "Button")
        if (nuxtComponentName) {
            const duplicates = await this.getCachedDuplicateComponentNames();
            const conflictingPaths = (duplicates.get(nuxtComponentName) || [])
                .filter(p => p !== document.uri.fsPath);

            if (conflictingPaths.length > 0) {
                const conflictLocations = conflictingPaths.map(
                    p => new vscode.Location(vscode.Uri.file(p), new vscode.Position(0, 0))
                );

                lenses.push(
                    new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
                        title: `$(warning) Nom "${nuxtComponentName}" en conflit avec ${conflictingPaths.length} autre${conflictingPaths.length > 1 ? 's' : ''} fichier${conflictingPaths.length > 1 ? 's' : ''}`,
                        command: 'editor.action.showReferences',
                        arguments: [
                            document.uri,
                            new vscode.Position(0, 0),
                            conflictLocations
                        ]
                    })
                );
            }
        }

        const text = document.getText();

        const isPagesComponents = document.fileName.includes(`${path.sep}pages${path.sep}`) &&
            document.fileName.includes(`${path.sep}components${path.sep}`);

        if (!isPagesComponents && document.fileName.includes(`${path.sep}layouts${path.sep}`)) {
            return [];
        }

        let hasAddedLens = false;

        // Générer une clé unique pour ce composant dans ce document
        const documentCacheKey = document.uri.toString();

        // 2.1 Pour les composants avec <script setup>
        const scriptSetupRegex = /<script\s+[^>]*setup[^>]*>/g;

        let match: RegExpExecArray | null;

        while ((match = scriptSetupRegex.exec(text))) {
            const pos = document.positionAt(match.index);
            const range = new vscode.Range(pos.line, 0, pos.line, 0);

            const cacheKey = `${documentCacheKey}:${nuxtComponentName}:setup`;
            const references = await this.getCachedReferences(cacheKey, String(nuxtComponentName));

            const referenceCount = references.length;

            lenses.push(
                new vscode.CodeLens(range, {
                    title: `$(package) ${referenceCount} reference${referenceCount > 1 ? 's' : ''} | ${nuxtComponentName}`,
                    command: 'editor.action.showReferences',
                    arguments: [
                        document.uri,
                        pos,
                        references
                    ]
                })
            );
            if (referenceCount === 0) {
                lenses.push(TextUtils.buildSearchInWorkspaceLens(range, String(nuxtComponentName)));
            }

            // Props déclarées mais plus utilisées dans le composant, alors qu'un
            // parent continue de les transmettre : signalées via un unique CodeLens
            // agrégé (un QuickPick liste chaque prop concernée et ses sites parents).
            if (referenceCount > 0) {
                const staleProps = await this.getCachedStaleProps(document, text, references);
                if (staleProps.length > 0) {
                    lenses.push(
                        new vscode.CodeLens(range, {
                            title: `$(warning) ${staleProps.length} prop${staleProps.length > 1 ? 's' : ''} inutilisée${staleProps.length > 1 ? 's' : ''} mais encore transmise${staleProps.length > 1 ? 's' : ''} par un parent`,
                            command: 'nuxt-intellisense.showStaleProps',
                            arguments: [
                                staleProps.map(p => ({
                                    name: p.name,
                                    locations: p.locations
                                }))
                            ]
                        })
                    );
                }
            }

            hasAddedLens = true;
        }

        // 2.2 Pour les composants avec defineComponent
        if (!hasAddedLens) {
            const defineComponentRegex = /defineComponent\s*\(/g;

            while ((match = defineComponentRegex.exec(text))) {
                const pos = document.positionAt(match.index);
                const range = new vscode.Range(pos.line, 0, pos.line, 0);

                const cacheKey = `${documentCacheKey}:${nuxtComponentName}:defineComponent`;
                const references = await this.getCachedReferences(cacheKey, String(nuxtComponentName));

                const referenceCount = references.length;

                lenses.push(
                    new vscode.CodeLens(range, {
                        title: `$(package) ${referenceCount} reference${referenceCount > 1 ? 's' : ''} | ${nuxtComponentName}`,
                        command: 'editor.action.showReferences',
                        arguments: [
                            document.uri,
                            pos,
                            references
                        ]
                    })
                );
                if (referenceCount === 0) {
                    lenses.push(TextUtils.buildSearchInWorkspaceLens(range, String(nuxtComponentName)));
                }
                hasAddedLens = true;
            }
        }

        // 2.3 Pour les composants Nuxt spécifiques
        if (!hasAddedLens) {
            const defineNuxtComponentRegex = /defineNuxtComponent\s*\(/g;

            while ((match = defineNuxtComponentRegex.exec(text))) {
                const pos = document.positionAt(match.index);
                const range = new vscode.Range(pos.line, 0, pos.line, 0);

                const cacheKey = `${documentCacheKey}:${nuxtComponentName}:defineNuxtComponent`;
                const references = await this.getCachedReferences(cacheKey, String(nuxtComponentName));
                const referenceCount = references.length;

                lenses.push(
                    new vscode.CodeLens(range, {
                        title: `$(symbol-event) ${referenceCount} reference${referenceCount > 1 ? 's' : ''} | ${nuxtComponentName}`,
                        command: 'editor.action.showReferences',
                        arguments: [
                            document.uri,
                            pos,
                            references
                        ]
                    })
                );
                if (referenceCount === 0) {
                    lenses.push(TextUtils.buildSearchInWorkspaceLens(range, String(nuxtComponentName)));
                }
                hasAddedLens = true;
            }
        }

        // 2.4 Si aucune des méthodes ci-dessus n'a trouvé de balise, chercher la balise template
        if (!hasAddedLens) {
            const templateRegex = /<template[^>]*>/g;

            match = templateRegex.exec(text);

            if (match) {
                const pos = document.positionAt(match.index);
                const range = new vscode.Range(pos.line, 0, pos.line, 0);

                const cacheKey = `${documentCacheKey}:${nuxtComponentName}:template`;
                const references = await this.getCachedReferences(cacheKey, String(nuxtComponentName));

                const referenceCount = references.length;

                lenses.push(
                    new vscode.CodeLens(range, {
                        title: `$(package) ${referenceCount} reference${referenceCount > 1 ? 's' : ''} | ${nuxtComponentName}`,
                        command: 'editor.action.showReferences',
                        arguments: [
                            document.uri,
                            pos,
                            references
                        ]
                    })
                );
                if (referenceCount === 0) {
                    lenses.push(TextUtils.buildSearchInWorkspaceLens(range, String(nuxtComponentName)));
                }
            }
        }

        return lenses;
    }

    /**
     * Récupère le nom du composant depuis le cache
     */
    private getCachedComponentName(filePath: string): string | undefined {
        return this.componentNameCache.get(filePath);
    }

    /**
     * Récupère des références mises en cache ou les calcule si nécessaire
     */
    private async getCachedReferences(
        cacheKey: string,
        componentName: string
    ): Promise<vscode.Location[]> {
        const now = Date.now();
        const cachedData = this.referenceCache.get(cacheKey);

        // Retourner les références en cache si elles sont toujours valides
        if (cachedData && (now - cachedData.timestamp < this.referenceCacheTTL)) {
            return cachedData.references;
        }

        const references = await this.findComponentReferences(componentName);

        this.referenceCache.set(cacheKey, {
            references,
            timestamp: now
        });

        return references;
    }

    /**
     * Récupère les répertoires de composants mis en cache ou les calcule si nécessaire
     */
    private async getCachedComponentDirs(): Promise<string[]> {
        const now = Date.now();

        // Retourner les répertoires en cache s'ils sont toujours valides
        if (this.componentDirsCache && (now - this.componentDirsCache.timestamp < this.dirsCacheTTL)) {
            return this.componentDirsCache.dirs;
        }

        const dirs = await this.findAllComponentsDirs();

        this.componentDirsCache = {
            dirs,
            timestamp: now
        };

        return dirs;
    }

    /**
     * Récupère (avec cache) la table des noms de composants Nuxt en conflit,
     * c'est-à-dire résolus par plusieurs fichiers différents.
     */
    private async getCachedDuplicateComponentNames(): Promise<Map<string, string[]>> {
        const now = Date.now();

        if (this.duplicateNamesCache && (now - this.duplicateNamesCache.timestamp < this.duplicateNamesCacheTTL)) {
            return this.duplicateNamesCache.names;
        }

        const names = await this.computeDuplicateComponentNames();

        this.duplicateNamesCache = { names, timestamp: now };

        return names;
    }

    private async computeDuplicateComponentNames(): Promise<Map<string, string[]>> {
        const dirs = await this.getCachedComponentDirs();
        const pathsByName = new Map<string, string[]>();

        for (const dir of dirs) {
            const files = await vscode.workspace.findFiles(new vscode.RelativePattern(dir, '**/*.vue'));

            for (const file of files) {
                const name = this.getNuxtComponentName(file.fsPath, dir);
                if (!name) continue;

                const paths = pathsByName.get(name) || [];
                if (!paths.includes(file.fsPath)) {
                    paths.push(file.fsPath);
                }
                pathsByName.set(name, paths);
            }
        }

        const duplicates = new Map<string, string[]>();
        for (const [name, paths] of pathsByName) {
            if (paths.length > 1) {
                duplicates.set(name, paths);
            }
        }

        return duplicates;
    }

    /**
     * Recherche les références d'un composant spécifique
     */
    async findComponentReferences(
        componentName: string
    ): Promise<vscode.Location[]> {
        if (!componentName) {
            return [];
        }

        const kebab = PathUtils.pascalToKebabCase(componentName);

        const results: vscode.Location[] = [];

        const uris = await vscode.workspace.findFiles(
            '**/*.vue',
            FileUtils.buildExcludeGlob()
        );

        // Traiter les fichiers par lots pour éviter les problèmes de mémoire
        const batchSize = 50;
        for (let i = 0; i < uris.length; i += batchSize) {
            const batch = uris.slice(i, i + batchSize);
            const batchPromises = batch.map(async (uri) => {
                // Note : app.vue/error.vue sont exclus des CodeLens (ce ne sont pas des
                // composants réutilisables), mais ils DOIVENT rester scannés ici : ils
                // utilisent fréquemment d'autres composants (<NuxtLayout>, <NetworkStatus />...).
                let content: string;
                try {
                    content = fs.readFileSync(uri.fsPath, 'utf-8');
                } catch (error) {
                    return;
                }

                const searchPatterns = [
                    new RegExp(`<${componentName}(\\s[\\s\\S]*?)?\\s*(/?)>`, 'gs'),
                    new RegExp(`<${kebab}(\\s[\\s\\S]*?)?\\s*(/?)>`, 'gs')
                ];

                for (const regex of searchPatterns) {
                    let match;
                    while ((match = regex.exec(content)) !== null) {
                        const matchText = match[0];
                        const index = match.index;

                        // Vérifie si c'est dans une section script et potentiellement une annotation de type
                        const scriptTagMatch = /<script[^>]*>/g;
                        let insideScript = false;
                        let scriptStart: number | null = null;
                        let scriptEnd: number | null = null;
                        let scriptTag: RegExpExecArray | null;

                        while ((scriptTag = scriptTagMatch.exec(content)) !== null) {
                            const scriptOpenIndex = scriptTag.index;
                            const scriptCloseIndex = content.indexOf('</script>', scriptOpenIndex);
                            if (scriptCloseIndex !== -1 && index > scriptOpenIndex && index < scriptCloseIndex) {
                                insideScript = true;
                                scriptStart = scriptOpenIndex;
                                scriptEnd = scriptCloseIndex;
                                break;
                            }
                        }

                        if (insideScript) {
                            const surrounding = content.slice(Math.max(scriptStart! + 1, index - 100), index + 100);
                            const tsTypeContext = new RegExp(`\\b(ref|reactive|defineComponent|defineNuxtComponent)?\\s*<\\s*${componentName}\\s*>`);
                            const variableTypeContext = new RegExp(`:\\s*${componentName}\\b`);

                            if (tsTypeContext.test(surrounding) || variableTypeContext.test(surrounding)) {
                                continue; // ignorer ce faux positif
                            }
                        }

                        // position et ajout comme d’habitude
                        const before = content.slice(0, index);
                        const line = before.split('\n').length - 1;
                        const lineStartIndex = before.lastIndexOf('\n') + 1;
                        const col = index - lineStartIndex;

                        const matchLines = matchText.split('\n');
                        const endLine = line + matchLines.length - 1;
                        const endCol = matchLines.length > 1
                            ? matchLines[matchLines.length - 1].length
                            : col + matchText.length;

                        results.push(new vscode.Location(
                            uri,
                            new vscode.Range(
                                new vscode.Position(line, col),
                                new vscode.Position(endLine, endCol)
                            )
                        ));
                    }
                }
            });

            await Promise.all(batchPromises);
        }

        return results;
    }

    // Fonction pour vérifier si un chemin doit être ignoré
    private shouldIgnorePath(fullPath: string): boolean {
        const baseIgnoredDirs = new Set([
            // Dossiers système
            'node_modules',
            '.nuxt',
            '.output',
            'dist',
            '.git',
            '.github',

            // Dossiers de stores
            'store',
            'stores',

            // nuxt server
            'server',

            // Dossiers configurables (nuxt-intellisense.ignoredDirectories)
            ...FileUtils.getIgnoredDirectories()
        ]);

        const pathSegments = fullPath.split(path.sep);

        // Vérifier chaque segment du chemin
        for (const segment of pathSegments) {
            // Si un segment du chemin correspond à un dossier ignoré
            if (baseIgnoredDirs.has(segment)) {
                return true;
            }

            // Vérifier les patterns de layers (par exemple: admin/stores, client/utils, etc.)
            if (segment.endsWith('/store') ||
                segment.endsWith('/stores') ||
                segment.endsWith('/utils') ||
                segment.endsWith('/lib') ||
                segment.endsWith('/helpers') ||
                segment.endsWith('/constants') ||
                segment.endsWith('/shared') ||
                segment.endsWith('/public') ||
                segment.endsWith('/config')) {
                return true;
            }
        }

        return false;
    }

    async findAllComponentsDirs(): Promise<string[]> {
        const dirs: string[] = [];

        if (!this.nuxtProjectRoot) {
            return dirs;
        }

        const recurse = (dir: string) => {
            try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });

                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);

                    // Utiliser la nouvelle fonction de vérification
                    if (this.shouldIgnorePath(fullPath)) {
                        continue;
                    }

                    if (entry.isDirectory()) {
                        if (entry.name === 'components') {
                            dirs.push(fullPath);
                        }
                        recurse(fullPath);
                    }
                }
            } catch (error) {
            }
        };

        recurse(this.nuxtProjectRoot);

        return dirs;
    }

    private getNuxtComponentName(filePath: string, componentsDir: string): string {
        let relPath = path.relative(componentsDir, filePath).replace(/\.vue$/, '');

        const parts = relPath.split(path.sep);

        if (parts[parts.length - 1].toLowerCase() === 'index') {
            parts.pop();
        }

        const result = parts
            .filter(Boolean)
            .map(part =>
                part
                    .split('-')
                    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
                    .join('')
            )
            .join('');

        return result;
    }

    /**
     * Retrouve le fichier `.vue` correspondant à un nom de composant Nuxt résolu
     * (ex: "UiMyButton"). Utilisé par le hover provider pour savoir si un tag survolé
     * correspond réellement à un composant du projet avant d'afficher un aperçu.
     */
    public async findComponentFileByExactName(name: string): Promise<string | null> {
        const dirs = await this.getCachedComponentDirs();

        for (const dir of dirs) {
            const files = await vscode.workspace.findFiles(new vscode.RelativePattern(dir, '**/*.vue'));

            for (const file of files) {
                if (this.getNuxtComponentName(file.fsPath, dir) === name) {
                    return file.fsPath;
                }
            }
        }

        return null;
    }

    /**
     * Version mise en cache (invalidée par mtime du composant, et vidée dès qu'un
     * fichier Vue change) de {@link computeStaleProps}.
     */
    private async getCachedStaleProps(
        document: vscode.TextDocument,
        text: string,
        references: vscode.Location[]
    ): Promise<StalePropInfo[]> {
        let mtimeMs = 0;
        try {
            mtimeMs = fs.statSync(document.uri.fsPath).mtimeMs;
        } catch {
            /* fichier non enregistré : pas de mtime, on recalcule à chaque fois */
        }

        const key = document.uri.toString();
        const cached = this.stalePropsCache.get(key);
        if (cached && cached.mtimeMs === mtimeMs && mtimeMs !== 0) {
            return cached.result;
        }

        const result = await this.computeStaleProps(text, references);
        this.stalePropsCache.set(key, { mtimeMs, result });
        return result;
    }

    /**
     * Détecte les props déclarées via `defineProps` qui n'apparaissent plus nulle
     * part dans le composant (ni `<script>`, ni `<template>`) alors qu'au moins un
     * parent continue de les passer. Analyse purement textuelle : en cas de doute
     * (déstructuration, `v-bind` avec objet complet, `useAttrs`...) on préfère ne
     * rien signaler plutôt que de risquer un faux positif.
     */
    private async computeStaleProps(
        text: string,
        references: vscode.Location[]
    ): Promise<StalePropInfo[]> {
        const props = this.extractProps(text);
        if (props.length === 0 || references.length === 0) {
            return [];
        }

        const body = this.stripPropsDeclaration(text);

        const candidates = props.filter(p => !this.isIdentifierUsed(body, p.name));
        if (candidates.length === 0) {
            return [];
        }

        // Contenu des balises parentes (une seule lecture par fichier).
        const tagTextByFile = new Map<string, string[]>();
        const tagTexts: { text: string; loc: vscode.Location }[] = [];
        for (const loc of references) {
            let lines = tagTextByFile.get(loc.uri.fsPath);
            if (!lines) {
                try {
                    lines = fs.readFileSync(loc.uri.fsPath, 'utf-8').split('\n');
                } catch {
                    lines = [];
                }
                tagTextByFile.set(loc.uri.fsPath, lines);
            }
            const tag = lines.slice(loc.range.start.line, loc.range.end.line + 1).join('\n');
            tagTexts.push({ text: tag, loc });
        }

        // Si un parent utilise `v-bind="obj"` (objet entier), impossible de savoir
        // quelles props il transmet : on n'ose flaguer aucune prop.
        const hasObjectVBind = tagTexts.some(t => /v-bind\s*=\s*["'{]/.test(t.text));
        if (hasObjectVBind) {
            return [];
        }

        const result: StalePropInfo[] = [];
        for (const prop of candidates) {
            const passing = tagTexts
                .filter(t => this.tagPassesProp(t.text, prop.name))
                .map(t => t.loc);
            if (passing.length > 0) {
                result.push({ name: prop.name, locations: passing });
            }
        }
        return result;
    }

    /** Un identifiant apparaît-il comme mot entier dans le texte donné ? */
    private isIdentifierUsed(text: string, name: string): boolean {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const kebab = name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
        if (new RegExp(`\\b${escaped}\\b`).test(text)) {
            return true;
        }
        if (kebab !== name && new RegExp(`\\b${kebab.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text)) {
            return true;
        }
        return false;
    }

    /** Une balise parente passe-t-elle explicitement l'attribut/prop `name` ? */
    private tagPassesProp(tagText: string, name: string): boolean {
        const kebab = name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
        const names = name === kebab ? [name] : [name, kebab];
        for (const n of names) {
            const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // `foo=`, `:foo=`, `v-bind:foo=`, ou raccourci booléen `foo` isolé.
            const re = new RegExp(`(?:\\s)(?::|v-bind:)?${escaped}(?:\\.[\\w-]+)*(?:\\s*=|\\s|/?>)`);
            if (re.test(tagText)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Retire du contenu la déclaration des props (`defineProps<...>()` /
     * `defineProps({...})`, l'éventuel wrapper `withDefaults(...)`, la
     * déstructuration `const { ... } = defineProps` et l'`interface`/`type` de
     * props référencé en générique) afin que la recherche d'usage ne compte pas la
     * déclaration elle-même comme une utilisation.
     */
    private stripPropsDeclaration(content: string): string {
        // Neutraliser les `=>` pour ne pas fausser l'équilibrage des chevrons.
        let result = content.replace(/=>/g, '  ');

        const genericName = /defineProps\s*<\s*([A-Za-z_$][\w$]*)\s*>/.exec(result)?.[1];
        if (genericName) {
            for (const prefix of [`interface\\s+${genericName}\\s*`, `type\\s+${genericName}\\s*=\\s*`]) {
                const m = new RegExp(prefix + '\\{').exec(result);
                if (m) {
                    const braceIdx = m.index + m[0].length - 1;
                    const block = TextUtils.extractBalancedBlock(result, braceIdx);
                    if (block) {
                        result = result.slice(0, m.index) + ' '.repeat(m[0].length + block.length - 1) + result.slice(braceIdx + block.length);
                    }
                }
            }
        }

        const call = /defineProps\s*(<|\()/.exec(result);
        if (!call) {
            return result;
        }

        let start = call.index;
        const before = result.slice(0, start);
        const lhs = /(?:const|let|var)\s*(?:\{[^{}]*\}|[A-Za-z_$][\w$]*)\s*=\s*(?:withDefaults\s*\(\s*)?$/.exec(before);
        if (lhs) {
            start = lhs.index;
        }

        const openIdx = call.index + call[0].length - 1;
        const open = result[openIdx];
        const close = open === '<' ? '>' : ')';
        let depth = 0;
        let end = result.length;
        for (let i = openIdx; i < result.length; i++) {
            if (result[i] === open) {
                depth++;
            } else if (result[i] === close) {
                depth--;
                if (depth === 0) {
                    end = i + 1;
                    const rest = result.slice(end).match(/^\s*\([^()]*\)/);
                    if (open === '<' && rest) {
                        end += rest[0].length;
                    }
                    break;
                }
            }
        }

        return result.slice(0, start) + ' '.repeat(end - start) + result.slice(end);
    }

    /**
     * Récupère (avec cache invalidé par mtime) la liste des props et des slots
     * déclarés par un composant. Utilisé par le hover provider pour afficher
     * l'API d'un composant sans avoir à ouvrir son fichier.
     */
    public async getComponentMetadata(filePath: string): Promise<ComponentMetadata> {
        let mtimeMs: number;
        try {
            mtimeMs = fs.statSync(filePath).mtimeMs;
        } catch {
            return { props: [], slots: [] };
        }

        const cached = this.metadataCache.get(filePath);
        if (cached && cached.mtimeMs === mtimeMs) {
            return cached.metadata;
        }

        let content: string;
        try {
            content = fs.readFileSync(filePath, 'utf-8');
        } catch {
            return { props: [], slots: [] };
        }

        const metadata: ComponentMetadata = {
            props: this.extractProps(content),
            slots: this.extractSlots(content)
        };

        this.metadataCache.set(filePath, { metadata, mtimeMs });

        return metadata;
    }

    /**
     * Analyse par regex (pas un vrai parseur AST) des formes usuelles de
     * `defineProps` : générique typé (`defineProps<{...}>()` ou
     * `defineProps<Props>()` avec `Props` défini via `interface`/`type` dans le
     * même `<script>`), objet runtime (`defineProps({...})`) et tableau de noms
     * (`defineProps([...])`).
     */
    private extractProps(content: string): ComponentPropInfo[] {
        const definePropsMatch = /defineProps\s*(<|\()/.exec(content);
        if (!definePropsMatch) {
            return [];
        }

        if (definePropsMatch[1] === '<') {
            const genericStart = definePropsMatch.index + definePropsMatch[0].length;
            const afterOpenBracket = content.slice(genericStart).search(/\S/);
            const typeStartIndex = genericStart + (afterOpenBracket === -1 ? 0 : afterOpenBracket);

            if (content[typeStartIndex] === '{') {
                const block = TextUtils.extractBalancedBlock(content, typeStartIndex);
                if (block) {
                    return this.parseTypeLiteralProps(block.slice(1, -1));
                }
                return [];
            }

            const typeNameMatch = /^([A-Za-z_$][\w$]*)/.exec(content.slice(typeStartIndex));
            if (typeNameMatch) {
                const typeName = typeNameMatch[1];

                const interfaceRegex = new RegExp(`interface\\s+${typeName}\\s*\\{`);
                const interfaceMatch = interfaceRegex.exec(content);
                if (interfaceMatch) {
                    const braceIndex = interfaceMatch.index + interfaceMatch[0].length - 1;
                    const block = TextUtils.extractBalancedBlock(content, braceIndex);
                    if (block) {
                        return this.parseTypeLiteralProps(block.slice(1, -1));
                    }
                }

                const typeAliasRegex = new RegExp(`type\\s+${typeName}\\s*=\\s*\\{`);
                const typeAliasMatch = typeAliasRegex.exec(content);
                if (typeAliasMatch) {
                    const braceIndex = typeAliasMatch.index + typeAliasMatch[0].length - 1;
                    const block = TextUtils.extractBalancedBlock(content, braceIndex);
                    if (block) {
                        return this.parseTypeLiteralProps(block.slice(1, -1));
                    }
                }
            }

            return [];
        }

        // Forme runtime : defineProps({...}) ou defineProps([...])
        const parenStart = definePropsMatch.index + definePropsMatch[0].length;
        const afterParen = content.slice(parenStart).search(/\S/);
        const argStartIndex = parenStart + (afterParen === -1 ? 0 : afterParen);

        if (content[argStartIndex] === '{') {
            const block = TextUtils.extractBalancedBlock(content, argStartIndex);
            if (block) {
                return this.parseRuntimeObjectProps(block.slice(1, -1));
            }
        } else if (content[argStartIndex] === '[') {
            const closeIndex = content.indexOf(']', argStartIndex);
            if (closeIndex !== -1) {
                const arrayContent = content.slice(argStartIndex + 1, closeIndex);
                const names = [...arrayContent.matchAll(/(['"`])([\w-]+)\1/g)].map(m => m[2]);
                return names.map(name => ({ name, type: 'unknown', required: false }));
            }
        }

        return [];
    }

    /**
     * Parse le contenu d'un littéral de type `{ foo: string; bar?: number }`.
     */
    private parseTypeLiteralProps(objectContent: string): ComponentPropInfo[] {
        const props: ComponentPropInfo[] = [];
        let depth = 0;
        let i = 0;

        while (i < objectContent.length) {
            const char = objectContent[i];

            if (char === '{' || char === '[' || char === '(' || char === '<') {
                depth++;
                i++;
                continue;
            }
            if (char === '}' || char === ']' || char === ')' || char === '>') {
                depth--;
                i++;
                continue;
            }

            if (depth === 0) {
                const propMatch = /^([A-Za-z_$][\w$]*)(\?)?\s*:\s*/.exec(objectContent.slice(i));
                if (propMatch) {
                    const name = propMatch[1];
                    const optional = propMatch[2] === '?';
                    const valueStart = i + propMatch[0].length;

                    // La valeur (type) s'étend jusqu'à la prochaine `;`/`,` de
                    // profondeur 0, ou jusqu'à la fin du contenu.
                    let j = valueStart;
                    let valueDepth = 0;
                    while (j < objectContent.length) {
                        const c = objectContent[j];
                        if (c === '{' || c === '[' || c === '(' || c === '<') valueDepth++;
                        else if (c === '}' || c === ']' || c === ')' || c === '>') valueDepth--;
                        else if (valueDepth === 0 && (c === ';' || c === ',' || c === '\n')) break;
                        j++;
                    }

                    const type = objectContent.slice(valueStart, j).trim().replace(/,$/, '');

                    props.push({ name, type: type || 'unknown', required: !optional });

                    i = j;
                    continue;
                }
            }

            i++;
        }

        return props;
    }

    /**
     * Parse le contenu d'un objet runtime `{ foo: String, bar: { type: Number,
     * required: true } }`.
     */
    private parseRuntimeObjectProps(objectContent: string): ComponentPropInfo[] {
        const props: ComponentPropInfo[] = [];
        let depth = 0;
        let i = 0;

        while (i < objectContent.length) {
            const char = objectContent[i];

            if (char === '{' || char === '[' || char === '(') {
                depth++;
                i++;
                continue;
            }
            if (char === '}' || char === ']' || char === ')') {
                depth--;
                i++;
                continue;
            }

            if (depth === 0) {
                const keyMatch = /^(['"`]?)([A-Za-z_$][\w$]*)\1\s*:\s*/.exec(objectContent.slice(i));
                if (keyMatch) {
                    const name = keyMatch[2];
                    const valueStart = i + keyMatch[0].length;

                    if (objectContent[valueStart] === '{') {
                        const block = TextUtils.extractBalancedBlock(objectContent, valueStart);
                        if (block) {
                            const inner = block.slice(1, -1);
                            const typeMatch = /type\s*:\s*(\[[^\]]*\]|[A-Za-z_$][\w$]*)/.exec(inner);
                            const requiredMatch = /required\s*:\s*true/.exec(inner);

                            props.push({
                                name,
                                type: typeMatch ? typeMatch[1].replace(/\s+/g, ' ') : 'unknown',
                                required: !!requiredMatch
                            });

                            i = valueStart + block.length;
                            continue;
                        }
                    }

                    // Forme courte : `foo: String` ou `foo: [String, Number]`
                    let j = valueStart;
                    let valueDepth = 0;
                    while (j < objectContent.length) {
                        const c = objectContent[j];
                        if (c === '{' || c === '[' || c === '(') valueDepth++;
                        else if (c === '}' || c === ']' || c === ')') valueDepth--;
                        else if (valueDepth === 0 && c === ',') break;
                        j++;
                    }

                    const type = objectContent.slice(valueStart, j).trim();

                    props.push({ name, type: type || 'unknown', required: false });

                    i = j;
                    continue;
                }
            }

            i++;
        }

        return props;
    }

    /**
     * Repère les `<slot>` déclarés dans le `<template>` du composant (le slot
     * implicite est nommé "default").
     */
    private extractSlots(content: string): ComponentSlotInfo[] {
        const templateMatch = /<template[^>]*>/.exec(content);
        if (!templateMatch) {
            return [];
        }

        const templateStart = templateMatch.index + templateMatch[0].length;
        const templateEndMatch = /<\/template>\s*$/m.exec(content);
        const templateEnd = templateEndMatch ? templateEndMatch.index : content.length;
        const templateContent = content.slice(templateStart, templateEnd);

        const slotRegex = /<slot\b([^>]*)\/?>/g;
        const slots = new Map<string, ComponentSlotInfo>();
        let match: RegExpExecArray | null;

        while ((match = slotRegex.exec(templateContent)) !== null) {
            const attrs = match[1];
            const nameMatch = /\bname\s*=\s*(['"`])([\w-]+)\1/.exec(attrs);
            const name = nameMatch ? nameMatch[2] : 'default';

            if (!slots.has(name)) {
                slots.set(name, { name });
            }
        }

        return [...slots.values()];
    }

    /**
     * Invalide le cache complètement (à utiliser avec parcimonie)
     */
    public invalidateAllCaches(): void {
        this.referenceCache.clear();

        this.componentDirsCache = null;

        this.componentNameCache.clear();

        this.duplicateNamesCache = null;

        this.metadataCache.clear();
    }

    // S'assurer que les ressources sont libérées lorsqu'elles ne sont plus nécessaires
    public dispose(): void {
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
        }
    }
}