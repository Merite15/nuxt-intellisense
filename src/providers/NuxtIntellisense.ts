import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ComponentService } from '../services/ComponentService';
import { ComposableService } from '../services/ComposableService';
import { PluginService } from '../services/PluginService';
import { MiddlewareService } from '../services/MiddlewareService';
import { LayoutService } from '../services/LayoutService';
import { StoreService } from '../services/StoreService';
import { UtilsService } from '../services/UtilsService';
import { FileUtils } from '../utils/fileUtils';
import { NuxtComponentInfo } from '../types';

export class NuxtIntellisense implements vscode.CodeLensProvider, vscode.Disposable {
    private nuxtProjectRoot: string | null = null;
    private autoImportCache: Map<string, NuxtComponentInfo[]> = new Map();
    private lastCacheUpdate: number = 0;
    private cacheUpdateInterval: number = 30000;

    private componentService?: ComponentService;

    private composableService?: ComposableService;

    private pluginService?: PluginService;

    private middlewareService?: MiddlewareService;

    private layoutService?: LayoutService;

    private storeService?: StoreService;

    private utilsService?: UtilsService;

    private initializeServices() {
        if (this.nuxtProjectRoot) {
            this.componentService = new ComponentService(this.nuxtProjectRoot);
            this.composableService = new ComposableService();
            this.pluginService = new PluginService();
            this.middlewareService = new MiddlewareService();
            this.layoutService = new LayoutService();
            this.storeService = new StoreService(this.autoImportCache);
            this.utilsService = new UtilsService(this.nuxtProjectRoot);
        }
    }

    async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        const lenses: vscode.CodeLens[] = [];

        // Trouver la racine du projet Nuxt si pas encore fait
        if (!this.nuxtProjectRoot) {
            this.nuxtProjectRoot = await this.findNuxtProjectRoot(document.uri);

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

            if (fileInfo.isUtil && this.utilsService) {
                const text = document.getText();

                const utilsRegex = /export\s+(const|function|async function|interface|type|enum|class)\s+(\w+)/g;

                let match: RegExpExecArray | null;

                while ((match = utilsRegex.exec(text))) {
                    const exportType = match[1];
                    const name = match[2];
                    const pos = document.positionAt(match.index);
                    const range = new vscode.Range(pos.line, 0, pos.line, 0);

                    // Icône et libellé selon le type d'export
                    let icon = '$(tools)'; // Par défaut pour les utilitaires
                    let typeLabel = 'utilitaire';

                    if (exportType === 'interface') {
                        icon = '$(symbol-interface)';
                        typeLabel = 'interface';
                    } else if (exportType === 'type') {
                        icon = '$(symbol-property)';
                        typeLabel = 'type';
                    } else if (exportType === 'const') {
                        icon = '$(symbol-constant)';
                        typeLabel = 'constante';
                    } else if (exportType === 'class') {
                        icon = '$(symbol-class)';
                        typeLabel = 'classe';
                    }

                    // Rechercher les références
                    const references = await this.utilsService.findUtilsReferences(document, name, pos);

                    const referenceCount = references.length;

                    lenses.push(
                        new vscode.CodeLens(range, {
                            title: `${icon} ${referenceCount} reference${referenceCount > 1 ? 's' : ''}`,
                            command: 'editor.action.showReferences',
                            arguments: [
                                document.uri,
                                new vscode.Position(pos.line, match[0].indexOf(name)),
                                references
                            ]
                        })
                    );
                }
            }
        } catch (error) {
            console.error('Error providing code lenses:', error);
        }

        return lenses;
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
            isUtil: hasSegment('utils', 'lib', 'services', 'types', 'helpers', 'constants', 'schemas', 'validationSchemas')
        };
    }

    private async findNuxtProjectRoot(uri: vscode.Uri): Promise<string | null> {
        let currentDir = path.dirname(uri.fsPath);
        const root = path.parse(currentDir).root;
        let bestCandidate: string | null = null;

        while (currentDir !== root) {
            const nuxtConfigTsPath = path.join(currentDir, 'nuxt.config.ts');
            const nuxtConfigJsPath = path.join(currentDir, 'nuxt.config.js');

            const hasNuxtConfig = fs.existsSync(nuxtConfigTsPath) || fs.existsSync(nuxtConfigJsPath);
            const hasPackageJson = fs.existsSync(path.join(currentDir, 'package.json'));
            const hasGit = fs.existsSync(path.join(currentDir, '.git'));
            const hasPnpmWorkspace = fs.existsSync(path.join(currentDir, 'pnpm-workspace.yaml'));

            if (hasNuxtConfig) {
                // On marque ce dossier comme un candidat potentiel
                if (hasPackageJson || hasGit || hasPnpmWorkspace) {
                    return currentDir; // Racine trouvée avec certitude
                }

                // Sinon on garde en mémoire comme fallback
                bestCandidate = currentDir;
            }

            currentDir = path.dirname(currentDir);
        }

        // Si aucun dossier avec git/package.json mais un layer avec nuxt.config trouvé
        return bestCandidate;
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
    }
}