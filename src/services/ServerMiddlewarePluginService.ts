import * as vscode from 'vscode';
import * as path from 'path';
import { FileUtils } from '../utils/fileUtils';

type ServerCategory = 'middleware' | 'plugins';

interface DuplicatesCache {
    names: Map<string, string[]>;
    timestamp: number;
}

/**
 * Nitro `server/middleware` et `server/plugins` s'appliquent automatiquement (pas de
 * référence explicite par nom comme pour le middleware Nuxt applicatif ou les
 * composants), donc le comptage de références n'a pas de sens ici. En revanche, deux
 * fichiers portant le même nom dans l'un de ces dossiers (souvent un résidu de
 * refactor) trahissent généralement une confusion — c'est ce qu'on signale.
 *
 * @author Merite15
 * @created 2026-08-01
 */
export class ServerMiddlewarePluginService {
    private duplicatesCache: Map<ServerCategory, DuplicatesCache> = new Map();
    private readonly cacheTTL: number = 600000; // 10 minutes
    private fileWatcher: vscode.FileSystemWatcher | undefined;

    constructor(private nuxtProjectRoot: string) {
        this.setupFileWatcher();
    }

    private setupFileWatcher() {
        this.fileWatcher = vscode.workspace.createFileSystemWatcher(
            '**/server/{middleware,plugins}/**/*.{ts,js}',
            false,
            false,
            false
        );

        const onFileEvent = (uri: vscode.Uri) => {
            if (!FileUtils.shouldSkipFile(uri.fsPath)) {
                this.duplicatesCache.clear();
            }
        };

        this.fileWatcher.onDidChange(onFileEvent);
        this.fileWatcher.onDidCreate(onFileEvent);
        this.fileWatcher.onDidDelete(onFileEvent);

        vscode.Disposable.from(this.fileWatcher);
    }

    async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        const category = this.getCategory(document.fileName);
        if (!category) {
            return [];
        }

        const duplicates = await this.getCachedDuplicates(category);
        const baseName = path.basename(document.fileName).replace(/\.(ts|js)$/, '');

        const conflictingPaths = (duplicates.get(baseName) || []).filter(p => p !== document.uri.fsPath);
        if (conflictingPaths.length === 0) {
            return [];
        }

        const conflictLocations = conflictingPaths.map(
            p => new vscode.Location(vscode.Uri.file(p), new vscode.Position(0, 0))
        );

        const label = category === 'middleware' ? 'middleware serveur' : 'plugin serveur';

        return [
            new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
                title: `$(warning) Nom de ${label} "${baseName}" en conflit avec ${conflictingPaths.length} autre${conflictingPaths.length > 1 ? 's' : ''} fichier${conflictingPaths.length > 1 ? 's' : ''}`,
                command: 'editor.action.showReferences',
                arguments: [
                    document.uri,
                    new vscode.Position(0, 0),
                    conflictLocations
                ]
            })
        ];
    }

    private getCategory(fileName: string): ServerCategory | null {
        const segments = fileName.split(path.sep);
        const serverIndex = segments.lastIndexOf('server');

        if (serverIndex === -1 || serverIndex + 1 >= segments.length) {
            return null;
        }

        const kind = segments[serverIndex + 1];

        return kind === 'middleware' || kind === 'plugins' ? kind : null;
    }

    private async getCachedDuplicates(category: ServerCategory): Promise<Map<string, string[]>> {
        const now = Date.now();
        const cached = this.duplicatesCache.get(category);

        if (cached && (now - cached.timestamp < this.cacheTTL)) {
            return cached.names;
        }

        const names = await this.computeDuplicates(category);
        this.duplicatesCache.set(category, { names, timestamp: now });

        return names;
    }

    private async computeDuplicates(category: ServerCategory): Promise<Map<string, string[]>> {
        const pathsByName = new Map<string, string[]>();

        const uris = await vscode.workspace.findFiles(
            new vscode.RelativePattern(this.nuxtProjectRoot, `**/server/${category}/**/*.{ts,js}`),
            FileUtils.buildBaseExcludeGlob()
        );

        for (const uri of uris) {
            const baseName = path.basename(uri.fsPath).replace(/\.(ts|js)$/, '');
            const paths = pathsByName.get(baseName) || [];

            if (!paths.includes(uri.fsPath)) {
                paths.push(uri.fsPath);
            }

            pathsByName.set(baseName, paths);
        }

        const duplicates = new Map<string, string[]>();
        for (const [name, paths] of pathsByName) {
            if (paths.length > 1) {
                duplicates.set(name, paths);
            }
        }

        return duplicates;
    }

    public dispose(): void {
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
        }
    }
}
