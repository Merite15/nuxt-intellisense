import * as vscode from 'vscode';
import * as path from 'path';
import { ComponentService } from '../services/ComponentService';
import { ComposableService } from '../services/ComposableService';
import { PluginService } from '../services/PluginService';
import { MiddlewareService } from '../services/MiddlewareService';
import { LayoutService } from '../services/LayoutService';
import { StoreService } from '../services/StoreService';
import { UtilsService } from '../services/UtilsService';
import { ServerApiService } from '../services/ServerApiService';
import { FileUtils } from '../utils/fileUtils';
import { NuxtComponentInfo } from '../types';

export class NuxtIntellisense implements vscode.CodeLensProvider, vscode.Disposable {
    private nuxtProjectRoot: string | null = null;
    private autoImportCache: Map<string, NuxtComponentInfo[]> = new Map();
    private lastCacheUpdate: number = 0;
    private cacheUpdateInterval: number = 30000;

    private readonly unusedDiagnostics: vscode.DiagnosticCollection =
        vscode.languages.createDiagnosticCollection('nuxt-intellisense-unused');

    private componentService?: ComponentService;

    private composableService?: ComposableService;

    private pluginService?: PluginService;

    private middlewareService?: MiddlewareService;

    private layoutService?: LayoutService;

    private storeService?: StoreService;

    private utilsService?: UtilsService;

    private serverApiService?: ServerApiService;

    private initializeServices() {
        if (this.nuxtProjectRoot) {
            this.componentService = new ComponentService(this.nuxtProjectRoot);
            this.composableService = new ComposableService();
            this.pluginService = new PluginService();
            this.middlewareService = new MiddlewareService();
            this.layoutService = new LayoutService();
            this.storeService = new StoreService(this.autoImportCache);
            this.utilsService = new UtilsService(this.nuxtProjectRoot);
            this.serverApiService = new ServerApiService();
        }
    }

    async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        const lenses: vscode.CodeLens[] = [];

        // Trouver la racine du projet Nuxt si pas encore fait
        if (!this.nuxtProjectRoot) {
            this.nuxtProjectRoot = FileUtils.findNuxtProjectRoot(document.uri.fsPath);

            this.initializeServices();
        }

        if (!this.nuxtProjectRoot) {
            return [];
        }

        const fileInfo = this.getFileInfo(document);

        await this.updateAutoImportCacheIfNeeded(fileInfo);

        // Déléguer aux services appropriés
        try {
            if (fileInfo.isComponent && this.componentService) {
                const componentLenses = await this.componentService.provideCodeLenses(document);

                lenses.push(...componentLenses);
            }

            if (fileInfo.isComposable && this.composableService) {
                const composableLenses = await this.composableService.provideCodeLenses(document);

                lenses.push(...composableLenses);
            }

            if (fileInfo.isPlugin && this.pluginService) {
                const pluginLenses = await this.pluginService.provideCodeLenses(document);

                lenses.push(...pluginLenses);
            }

            if (fileInfo.isMiddleware && this.middlewareService) {
                const middlewareLenses = await this.middlewareService.provideCodeLenses(document);

                lenses.push(...middlewareLenses);
            }

            if (fileInfo.isLayout && this.layoutService) {
                const layoutLenses = await this.layoutService.provideCodeLenses(document);

                lenses.push(...layoutLenses);
            }

            if (fileInfo.isStore && this.storeService) {
                const storeLenses = await this.storeService.provideCodeLenses(document);

                lenses.push(...storeLenses);
            }

            if (fileInfo.isServerApi && this.serverApiService) {
                const serverApiLenses = await this.serverApiService.provideCodeLenses(document);

                lenses.push(...serverApiLenses);
            }

            if (fileInfo.isUtil && this.utilsService) {
                const text = document.getText();

                const utilsRegex = /export\s+(const|function|async function|interface|type|enum|class)\s+(\w+)/g;

                let match: RegExpExecArray | null;

                const exportsFound: { exportType: string, name: string, pos: vscode.Position, matchText: string }[] = [];

                while ((match = utilsRegex.exec(text))) {
                    exportsFound.push({
                        exportType: match[1],
                        name: match[2],
                        pos: document.positionAt(match.index),
                        matchText: match[0]
                    });
                }

                // Une seule passe sur le workspace pour tous les exports du fichier
                // (au lieu d'un scan complet par export).
                const referencesByName = await this.utilsService.findUtilsReferencesForExports(
                    document,
                    exportsFound.map(e => ({ name: e.name, position: e.pos }))
                );

                for (const { exportType, name, pos, matchText } of exportsFound) {
                    const range = new vscode.Range(pos.line, 0, pos.line, 0);

                    // Icône selon le type d'export
                    let icon = '$(tools)'; // Par défaut pour les utilitaires

                    if (exportType === 'interface') {
                        icon = '$(symbol-interface)';
                    } else if (exportType === 'type') {
                        icon = '$(symbol-property)';
                    } else if (exportType === 'const') {
                        icon = '$(symbol-constant)';
                    } else if (exportType === 'class') {
                        icon = '$(symbol-class)';
                    }

                    const references = referencesByName.get(name) || [];

                    const referenceCount = references.length;

                    lenses.push(
                        new vscode.CodeLens(range, {
                            title: `${icon} ${referenceCount} reference${referenceCount > 1 ? 's' : ''}`,
                            command: 'editor.action.showReferences',
                            arguments: [
                                document.uri,
                                new vscode.Position(pos.line, matchText.indexOf(name)),
                                references
                            ]
                        })
                    );
                }
            }
        } catch (error) {
            console.error('Error providing code lenses:', error);
        }

        this.updateUnusedDiagnostics(document, lenses);

        return lenses;
    }

    /**
     * Signale dans le panneau Problems les symboles dont le CodeLens annonce
     * "0 reference(s)" : ils sont probablement du code mort. On réutilise le texte déjà
     * calculé par les services plutôt que de refaire un calcul dédié.
     */
    private updateUnusedDiagnostics(document: vscode.TextDocument, lenses: vscode.CodeLens[]): void {
        const config = vscode.workspace.getConfiguration('nuxt-intellisense');
        if (!config.get('showUnusedWarnings', true)) {
            this.unusedDiagnostics.delete(document.uri);
            return;
        }

        const zeroReferencePattern = /\b0 references?\b/;
        const diagnostics: vscode.Diagnostic[] = [];

        for (const lens of lenses) {
            const title = lens.command?.title;
            if (!title || !zeroReferencePattern.test(title)) {
                continue;
            }

            const line = lens.range.start.line;
            const lineLength = line < document.lineCount ? document.lineAt(line).text.length : 0;
            const range = new vscode.Range(line, 0, line, lineLength);

            diagnostics.push(new vscode.Diagnostic(
                range,
                'Nuxt Intellisense : aucune référence trouvée dans le projet pour ce symbole.',
                vscode.DiagnosticSeverity.Hint
            ));
        }

        this.unusedDiagnostics.set(document.uri, diagnostics);
    }

    private getFileInfo(document: vscode.TextDocument) {
        const fileDir = path.dirname(document.fileName);

        const fileExtension = path.extname(document.fileName);

        const segments = fileDir.split(path.sep);

        const hasSegment = (...names: string[]) => segments.some(segment => names.includes(segment));

        return {
            isVueFile: fileExtension === '.vue',
            isComponent: hasSegment('components'),
            isComposable: hasSegment('composables'),
            isPlugin: hasSegment('plugins'),
            isMiddleware: hasSegment('middleware'),
            isLayout: hasSegment('layouts'),
            isStore: hasSegment('stores', 'store'),
            isServerApi: hasSegment('server') && hasSegment('api', 'routes'),
            isUtil: hasSegment('utils', 'lib', 'services', 'types', 'helpers', 'constants', 'schemas', 'validationSchemas')
        };
    }

    private async updateAutoImportCacheIfNeeded(fileInfo: any): Promise<void> {
        const now = Date.now();

        if (now - this.lastCacheUpdate < this.cacheUpdateInterval) {
            return;
        }

        if (fileInfo.isStore && this.storeService) {
            const storeDirs = await FileUtils.findAllDirsByName(this.nuxtProjectRoot!, 'stores');

            for (const dir of storeDirs) {
                await this.storeService.scanStoresDirectory(dir);
            }
        }

        this.lastCacheUpdate = now;
    }

    /**
     * Libère les watchers et caches détenus par chaque service
     */
    public dispose(): void {
        this.componentService?.dispose();
        this.composableService?.dispose();
        this.pluginService?.dispose();
        this.middlewareService?.dispose();
        this.layoutService?.dispose();
        this.storeService?.dispose();
        this.utilsService?.dispose();
        this.serverApiService?.dispose();
        this.unusedDiagnostics.dispose();
    }
}