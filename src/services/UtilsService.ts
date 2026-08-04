import * as vscode from 'vscode';
import * as fs from 'fs';
import { PathUtils } from '../utils/pathUtils';
import { TextUtils } from '../utils/textUtils';
import { FileUtils } from '../utils/fileUtils';

export interface UtilsExport {
    name: string;
    position: vscode.Position;
}

interface DocumentReferenceCache {
    references: Map<string, vscode.Location[]>;
    timestamp: number;
}

export class UtilsService {
    private referenceCacheTTL: number = 300000; // 5 minutes
    private documentReferenceCache: Map<string, DocumentReferenceCache> = new Map();
    private fileWatcher: vscode.FileSystemWatcher | undefined;

    constructor(
        private nuxtProjectRoot: string
    ) {
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

    /**
     * Recherche les références de plusieurs exports d'un même fichier utils en une
     * seule passe sur le workspace : chaque fichier n'est lu qu'une fois, quel que
     * soit le nombre d'exports (auparavant : un scan + une lecture complète du
     * workspace par export).
     */
    async findUtilsReferencesForExports(document: vscode.TextDocument, exports: UtilsExport[]): Promise<Map<string, vscode.Location[]>> {
        const resultsByName = new Map<string, vscode.Location[]>();
        for (const exp of exports) {
            resultsByName.set(exp.name, []);
        }

        if (exports.length === 0) {
            return resultsByName;
        }

        const cacheKey = document.uri.toString();
        const now = Date.now();
        const cached = this.documentReferenceCache.get(cacheKey);
        if (cached && (now - cached.timestamp < this.referenceCacheTTL)) {
            return cached.references;
        }

        try {
            // Première passe : provider de références natif de VS Code (un appel par export,
            // servi par le langage-server, pas de lecture disque supplémentaire).
            for (const exp of exports) {
                const nativeReferences = await vscode.commands.executeCommand<vscode.Location[]>(
                    'vscode.executeReferenceProvider',
                    document.uri,
                    new vscode.Position(exp.position.line, exp.position.character + exp.name.length - 1)
                ) || [];

                const results = resultsByName.get(exp.name)!;
                for (const ref of nativeReferences) {
                    if (!(ref.uri.fsPath === document.uri.fsPath && ref.range.start.line === exp.position.line) &&
                        !ref.uri.fsPath.includes('/.nuxt/') &&
                        !ref.uri.fsPath.includes('\\.nuxt\\')) {
                        results.push(ref);
                    }
                }
            }

            // Deuxième passe : recherche par regex dans tous les fichiers du workspace,
            // chaque fichier lu une seule fois pour tous les exports.
            const uris = await vscode.workspace.findFiles(
                '**/*.{vue,js,ts}',
                '{**/node_modules/**,**/.nuxt/**,**/.output/**,**/dist/**}'
            );

            for (const uri of uris) {
                if (uri.fsPath === document.uri.fsPath) continue;

                let content: string;
                try {
                    content = fs.readFileSync(uri.fsPath, 'utf-8');
                } catch {
                    continue;
                }

                for (const exp of exports) {
                    this.findExportReferencesInFile(content, uri, document, exp.name, resultsByName.get(exp.name)!);
                }
            }
        } catch (e) {
            console.error('Error finding utils references:', e);
        }

        this.documentReferenceCache.set(cacheKey, { references: resultsByName, timestamp: now });

        return resultsByName;
    }

    private findExportReferencesInFile(content: string, uri: vscode.Uri, document: vscode.TextDocument, name: string, results: vscode.Location[]): void {
        const importRegex = new RegExp(`import\\s+{[^}]*\\b${name}\\b[^}]*}\\s+from\\s+(['"\`][^'\`"]*['"\`])`, 'g');

        let match;

        // Partagé avec les passes suivantes pour éviter de compter deux fois
        // le même identifiant (ex: le `name` d'un import matché à la fois ici
        // et par usageRegex plus bas).
        const seen = new Set<string>();

        while ((match = importRegex.exec(content)) !== null) {
            const importPath = match[1].slice(1, -1); // Enlever les guillemets

            if (PathUtils.isImportPointingToFile(importPath, uri.fsPath, document.uri.fsPath, this.nuxtProjectRoot)) {
                const nameIndex = content.indexOf(name, match.index);

                if (nameIndex !== -1) {
                    const start = TextUtils.indexToPosition(content, nameIndex);

                    const end = TextUtils.indexToPosition(content, nameIndex + name.length);

                    const locationKey = `${uri.fsPath}:${start.line}:${start.character}`;
                    seen.add(locationKey);

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

        const typeUsageRegex = new RegExp(`[:<]\\s*${name}(\\[\\])?\\b`, 'g');

        const usageRegex = new RegExp(`(?<!['"\`<>])\\b${name}\\b(?!\\s*:)`, 'g');

        const templateBindingRegex = new RegExp(`[:@\\w\\-]+=['"]\\s*[^'"]*\\b${name}\\b[^'"]*['"]`, 'g');

        while ((match = typeUsageRegex.exec(content)) !== null) {
            const matchStart = match.index + match[0].indexOf(name);
            const start = TextUtils.indexToPosition(content, matchStart);
            const end = TextUtils.indexToPosition(content, matchStart + name.length);

            const locationKey = `${uri.fsPath}:${start.line}:${start.character}`;
            if (!seen.has(locationKey)) {
                seen.add(locationKey);
                results.push(new vscode.Location(
                    uri,
                    new vscode.Range(
                        new vscode.Position(start.line, start.character),
                        new vscode.Position(end.line, end.character)
                    )
                ));
            }
        }


        while ((match = usageRegex.exec(content)) !== null) {
            const matchStart = match.index + (match[0].length - name.length);

            const lineStart = content.lastIndexOf('\n', matchStart) + 1;

            const lineEnd = content.indexOf('\n', matchStart);

            const line = content.substring(lineStart, lineEnd !== -1 ? lineEnd : content.length);

            if (line.includes('<') && line.includes('>')) { // HTML
                continue;
            }

            // Ignorer les occurrences situées à l'intérieur d'une chaîne de caractères
            // (ex: "use const here" ne doit pas compter comme une référence à `const`)
            if (TextUtils.isInsideStringLiteral(content, matchStart)) {
                continue;
            }

            const start = TextUtils.indexToPosition(content, matchStart);

            const end = TextUtils.indexToPosition(content, matchStart + name.length);

            const locationKey = `${uri.fsPath}:${start.line}:${start.character}`;
            if (!seen.has(locationKey)) {
                seen.add(locationKey);

                results.push(new vscode.Location(
                    uri,
                    new vscode.Range(
                        new vscode.Position(start.line, start.character),
                        new vscode.Position(end.line, end.character)
                    )
                ));
            }
        }

        while ((match = templateBindingRegex.exec(content)) !== null) {
            const matchStart = match.index + match[0].indexOf(name);

            const start = TextUtils.indexToPosition(content, matchStart);

            const end = TextUtils.indexToPosition(content, matchStart + name.length);

            const locationKey = `${uri.fsPath}:${start.line}:${start.character}`;
            if (!seen.has(locationKey)) {
                seen.add(locationKey);
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

    private objectMemberReferenceCache: Map<string, { references: Map<string, vscode.Location[]>, timestamp: number }> = new Map();

    /**
     * Compte les usages `NAME.membre` / `NAME['membre']` d'un objet exporté (ex:
     * `export const Routes = { Dashboard: '/dashboard', ... } as const`), une seule
     * passe sur le workspace pour tous les membres à la fois — même logique que
     * `findUtilsReferencesForExports`, mais au niveau propriété plutôt qu'export.
     */
    async findObjectMemberReferences(objectName: string, memberNames: string[]): Promise<Map<string, vscode.Location[]>> {
        const resultsByMember = new Map<string, vscode.Location[]>();
        for (const memberName of memberNames) {
            resultsByMember.set(memberName, []);
        }

        if (memberNames.length === 0) {
            return resultsByMember;
        }

        const cacheKey = `${objectName}:${memberNames.join(',')}`;
        const now = Date.now();
        const cached = this.objectMemberReferenceCache.get(cacheKey);
        if (cached && (now - cached.timestamp < this.referenceCacheTTL)) {
            return cached.references;
        }

        const uris = await vscode.workspace.findFiles(
            '**/*.{vue,js,ts}',
            FileUtils.buildExcludeGlob()
        );

        for (const uri of uris) {
            let content: string;
            try {
                content = fs.readFileSync(uri.fsPath, 'utf-8');
            } catch {
                continue;
            }

            for (const memberName of memberNames) {
                const results = resultsByMember.get(memberName)!;

                const dotPattern = new RegExp(`\\b${objectName}\\.${memberName}\\b`, 'g');
                TextUtils.findMatches(dotPattern, content, uri, results);

                const bracketPattern = new RegExp(`\\b${objectName}\\[\\s*(['"\`])${memberName}\\1\\s*\\]`, 'g');
                TextUtils.findMatches(bracketPattern, content, uri, results);
            }
        }

        this.objectMemberReferenceCache.set(cacheKey, { references: resultsByMember, timestamp: now });

        return resultsByMember;
    }

    public invalidateReferenceCache(): void {
        this.documentReferenceCache.clear();
        this.objectMemberReferenceCache.clear();
    }

    public dispose(): void {
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
        }
    }
}