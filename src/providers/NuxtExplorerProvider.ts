import * as vscode from 'vscode';
import * as path from 'path';
import { FileUtils } from '../utils/fileUtils';

interface CategoryDefinition {
    label: string;
    icon: string;
    include: string;
    /** Si true, seul le glob de base (node_modules/.nuxt/.output/dist) est exclu :
     *  nécessaire pour les catégories qui pointent vers un dossier normalement
     *  ignoré par `nuxt-intellisense.ignoredDirectories` (utils, server). */
    baseExcludeOnly?: boolean;
}

const CATEGORIES: CategoryDefinition[] = [
    { label: 'Components', icon: 'package', include: '**/components/**/*.vue' },
    { label: 'Composables', icon: 'sync', include: '**/composables/**/*.{ts,js}' },
    { label: 'Stores', icon: 'database', include: '**/stores/**/*.{ts,js}' },
    { label: 'Plugins', icon: 'plug', include: '**/plugins/**/*.{ts,js}' },
    { label: 'Middleware', icon: 'link', include: '**/middleware/**/*.{ts,js}' },
    { label: 'Layouts', icon: 'layout', include: '**/layouts/**/*.vue' },
    { label: 'Server API', icon: 'server', include: '**/server/{api,routes}/**/*.{ts,js}', baseExcludeOnly: true },
    { label: 'Utils', icon: 'tools', include: '**/{utils,lib,helpers,constants}/**/*.{ts,js}', baseExcludeOnly: true }
];

type NuxtExplorerItem =
    | { kind: 'category'; category: CategoryDefinition }
    | { kind: 'file'; fsPath: string; icon: string };

/**
 * Vue arborescente de navigation dans la structure d'un projet Nuxt (composants,
 * composables, stores, plugins, middleware, layouts, routes server, utils).
 *
 * Volontairement "légère" : elle liste les fichiers par catégorie sans calculer de
 * compte de références (ce calcul reste réservé aux CodeLens, à l'ouverture d'un
 * fichier, pour éviter de rescanner tout le workspace au moindre rafraîchissement).
 *
 * @author Merite15
 * @created 2026-08-01
 */
export class NuxtExplorerProvider implements vscode.TreeDataProvider<NuxtExplorerItem> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
    public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private nuxtProjectRoot: string) { }

    public refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: NuxtExplorerItem): vscode.TreeItem {
        if (element.kind === 'category') {
            const item = new vscode.TreeItem(element.category.label, vscode.TreeItemCollapsibleState.Collapsed);
            item.iconPath = new vscode.ThemeIcon(element.category.icon);
            item.contextValue = 'nuxtCategory';
            return item;
        }

        const item = new vscode.TreeItem(path.basename(element.fsPath), vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon(element.icon);
        item.resourceUri = vscode.Uri.file(element.fsPath);
        item.description = path.relative(this.nuxtProjectRoot, path.dirname(element.fsPath));
        item.tooltip = element.fsPath;
        item.command = {
            command: 'vscode.open',
            title: 'Open file',
            arguments: [vscode.Uri.file(element.fsPath)]
        };
        return item;
    }

    async getChildren(element?: NuxtExplorerItem): Promise<NuxtExplorerItem[]> {
        if (!element) {
            return CATEGORIES.map(category => ({ kind: 'category', category }));
        }

        if (element.kind === 'category') {
            const exclude = element.category.baseExcludeOnly
                ? FileUtils.buildBaseExcludeGlob()
                : FileUtils.buildExcludeGlob();

            const files = await vscode.workspace.findFiles(element.category.include, exclude);

            return files
                .map(uri => uri.fsPath)
                .sort((a, b) => path.basename(a).localeCompare(path.basename(b)))
                .map(fsPath => ({ kind: 'file' as const, fsPath, icon: element.category.icon }));
        }

        return [];
    }
}
