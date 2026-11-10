import * as vscode from 'vscode';
import * as path from 'path';
import { FileUtils } from '../utils/fileUtils';
import { TextUtils } from '../utils/textUtils';

interface NamesCache {
    names: Set<string>;
    timestamp: number;
}

// Clés "coeur" documentées de definePageMeta. Volontairement non exhaustif : de
// nombreux modules Nuxt (i18n, sécurité, ...) ajoutent leurs propres clés via
// augmentation de types, donc on ne signale QUE les quasi-doublons d'une clé connue
// (faute de frappe probable), jamais une clé simplement absente de cette liste.
const KNOWN_PAGE_META_KEYS = new Set([
    'alias', 'key', 'keepalive', 'layout', 'layoutTransition', 'middleware',
    'name', 'path', 'pageTransition', 'redirect', 'scrollToTop', 'validate'
]);

/**
 * Détecte les références "fantômes" dans `definePageMeta({...})` : un middleware ou
 * un layout référencé par son nom, mais qui ne correspond à aucun fichier existant
 * dans le projet (typo la plupart du temps). Signalé comme diagnostic (squiggle) dans
 * le fichier de page lui-même — l'inverse de la détection de code mort : ici c'est la
 * référence qui est incorrecte, pas la définition qui est inutilisée.
 *
 * @author Merite15
 * @created 2026-08-01
 */
export class PageMetaValidationService {
    private middlewareNamesCache: NamesCache | null = null;
    private layoutNamesCache: NamesCache | null = null;
    private readonly cacheTTL: number = 300000; // 5 minutes
    private fileWatcher: vscode.FileSystemWatcher | undefined;

    constructor(private nuxtProjectRoot: string) {
        this.setupFileWatcher();
    }

    private setupFileWatcher() {
        this.fileWatcher = vscode.workspace.createFileSystemWatcher(
            '**/{middleware,layouts}/**/*.{ts,js,vue}',
            false,
            false,
            false
        );

        const onFileEvent = (uri: vscode.Uri) => {
            if (!FileUtils.shouldSkipFile(uri.fsPath)) {
                this.middlewareNamesCache = null;
                this.layoutNamesCache = null;
            }
        };

        this.fileWatcher.onDidChange(onFileEvent);
        this.fileWatcher.onDidCreate(onFileEvent);
        this.fileWatcher.onDidDelete(onFileEvent);

        vscode.Disposable.from(this.fileWatcher);
    }

    async validateDocument(document: vscode.TextDocument): Promise<vscode.Diagnostic[]> {
        const text = document.getText();
        const diagnostics: vscode.Diagnostic[] = [];

        const definePageMetaStartRegex = /definePageMeta\s*\(\s*\{/g;
        let match: RegExpExecArray | null;

        while ((match = definePageMetaStartRegex.exec(text)) !== null) {
            const braceOpenIndex = match.index + match[0].length - 1;
            const metaContent = TextUtils.extractBalancedBlock(text, braceOpenIndex);

            if (!metaContent) {
                continue;
            }

            const middlewareNames = await this.getCachedMiddlewareNames();
            const layoutNames = await this.getCachedLayoutNames();

            this.checkStringOrArrayProperty(text, metaContent, braceOpenIndex, 'middleware', middlewareNames, 'middleware', diagnostics);
            this.checkStringOrArrayProperty(text, metaContent, braceOpenIndex, 'layout', layoutNames, 'layout', diagnostics);
            this.checkLayoutObjectForm(text, metaContent, braceOpenIndex, layoutNames, diagnostics);
            this.checkUnknownKeys(text, metaContent, braceOpenIndex, diagnostics);
        }

        return diagnostics;
    }

    /**
     * Signale une clé de premier niveau qui n'est ni une clé connue de
     * `definePageMeta`, ni assez différente d'une clé connue pour être un choix
     * délibéré (clé personnalisée d'un module) — c'est-à-dire une faute de frappe
     * probable (`midleware` au lieu de `middleware`).
     */
    private checkUnknownKeys(
        fullText: string,
        metaContent: string,
        blockStart: number,
        diagnostics: vscode.Diagnostic[]
    ): void {
        // `metaContent` inclut ses accolades englobantes (extractBalancedBlock renvoie
        // le bloc complet) : on les retire pour que la profondeur 0 corresponde bien
        // au premier niveau de l'objet, et on décale les index en conséquence.
        const innerContent = metaContent.slice(1, -1);
        const topLevelKeys = TextUtils.extractTopLevelKeys(innerContent).map(k => ({ name: k.name, index: k.index + 1 }));

        for (const { name, index } of topLevelKeys) {
            if (KNOWN_PAGE_META_KEYS.has(name)) {
                continue;
            }

            let closestKey: string | null = null;
            let closestDistance = Infinity;

            for (const knownKey of KNOWN_PAGE_META_KEYS) {
                const distance = this.levenshteinDistance(name, knownKey);
                if (distance < closestDistance) {
                    closestDistance = distance;
                    closestKey = knownKey;
                }
            }

            // Distance courte par rapport à la longueur du mot : probable typo.
            // Une clé réellement personnalisée (ex: "requiresAuth") est généralement
            // beaucoup plus éloignée de toute clé connue.
            if (closestKey && closestDistance > 0 && closestDistance <= 2 && name.length > 2) {
                const absoluteIndex = blockStart + index;
                const start = TextUtils.indexToPosition(fullText, absoluteIndex);
                const end = TextUtils.indexToPosition(fullText, absoluteIndex + name.length);

                diagnostics.push(new vscode.Diagnostic(
                    new vscode.Range(
                        new vscode.Position(start.line, start.character),
                        new vscode.Position(end.line, end.character)
                    ),
                    `Nuxt Intellisense : "${name}" n'est pas une clé connue de definePageMeta — vouliez-vous dire "${closestKey}" ?`,
                    vscode.DiagnosticSeverity.Warning
                ));
            }
        }
    }

    private levenshteinDistance(a: string, b: string): number {
        const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));

        for (let i = 0; i <= a.length; i++) dp[i][0] = i;
        for (let j = 0; j <= b.length; j++) dp[0][j] = j;

        for (let i = 1; i <= a.length; i++) {
            for (let j = 1; j <= b.length; j++) {
                dp[i][j] = a[i - 1] === b[j - 1]
                    ? dp[i - 1][j - 1]
                    : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
            }
        }

        return dp[a.length][b.length];
    }

    /**
     * Vérifie `propertyName: 'name'` et `propertyName: ['name', ...]`.
     */
    private checkStringOrArrayProperty(
        fullText: string,
        metaContent: string,
        blockStart: number,
        propertyName: string,
        knownNames: Set<string>,
        kind: 'middleware' | 'layout',
        diagnostics: vscode.Diagnostic[]
    ): void {
        const singleRegex = new RegExp(`${propertyName}\\s*:\\s*(['"\`])([\\w-]+)\\1`, 'g');
        let match: RegExpExecArray | null;

        while ((match = singleRegex.exec(metaContent)) !== null) {
            const name = match[2];
            if (knownNames.has(name)) {
                continue;
            }

            const quotedValue = match[1] + name + match[1];
            const relativeIndex = match.index + match[0].indexOf(quotedValue) + 1;

            this.pushDiagnostic(fullText, blockStart + relativeIndex, name, kind, diagnostics);
        }

        const arrayRegex = new RegExp(`${propertyName}\\s*:\\s*\\[([^\\]]*)\\]`, 'g');
        let arrayMatch: RegExpExecArray | null;

        while ((arrayMatch = arrayRegex.exec(metaContent)) !== null) {
            const arrayContent = arrayMatch[1];
            const itemRegex = /(['"`])([\w-]+)\1/g;
            let itemMatch: RegExpExecArray | null;

            while ((itemMatch = itemRegex.exec(arrayContent)) !== null) {
                const name = itemMatch[2];
                if (knownNames.has(name)) {
                    continue;
                }

                const arrayStartInBlock = arrayMatch.index + arrayMatch[0].indexOf(arrayContent);
                const relativeIndex = arrayStartInBlock + itemMatch.index + 1;

                this.pushDiagnostic(fullText, blockStart + relativeIndex, name, kind, diagnostics);
            }
        }
    }

    /**
     * Vérifie la forme objet `layout: { name: 'name', props: {...} }`.
     */
    private checkLayoutObjectForm(
        fullText: string,
        metaContent: string,
        blockStart: number,
        knownLayoutNames: Set<string>,
        diagnostics: vscode.Diagnostic[]
    ): void {
        const objectStartRegex = /layout\s*:\s*\{/g;
        let objectMatch: RegExpExecArray | null;

        while ((objectMatch = objectStartRegex.exec(metaContent)) !== null) {
            const braceOpenIndexInBlock = objectMatch.index + objectMatch[0].length - 1;
            const layoutBlock = TextUtils.extractBalancedBlock(metaContent, braceOpenIndexInBlock);

            if (!layoutBlock) {
                continue;
            }

            const nameRegex = /name\s*:\s*(['"`])([\w-]+)\1/g;
            const nameMatch = nameRegex.exec(layoutBlock);

            if (!nameMatch) {
                continue;
            }

            const name = nameMatch[2];
            if (knownLayoutNames.has(name)) {
                continue;
            }

            const quotedValue = nameMatch[1] + name + nameMatch[1];
            const relativeIndex = braceOpenIndexInBlock + nameMatch.index + nameMatch[0].indexOf(quotedValue) + 1;

            this.pushDiagnostic(fullText, blockStart + relativeIndex, name, 'layout', diagnostics);
        }
    }

    private pushDiagnostic(
        fullText: string,
        absoluteIndex: number,
        name: string,
        kind: 'middleware' | 'layout',
        diagnostics: vscode.Diagnostic[]
    ): void {
        const start = TextUtils.indexToPosition(fullText, absoluteIndex);
        const end = TextUtils.indexToPosition(fullText, absoluteIndex + name.length);

        const range = new vscode.Range(
            new vscode.Position(start.line, start.character),
            new vscode.Position(end.line, end.character)
        );

        diagnostics.push(new vscode.Diagnostic(
            range,
            `Nuxt Intellisense : aucun ${kind} nommé "${name}" n'a été trouvé dans le projet (faute de frappe ?).`,
            vscode.DiagnosticSeverity.Warning
        ));
    }

    private async getCachedMiddlewareNames(): Promise<Set<string>> {
        const now = Date.now();

        if (this.middlewareNamesCache && (now - this.middlewareNamesCache.timestamp < this.cacheTTL)) {
            return this.middlewareNamesCache.names;
        }

        const names = await this.computeMiddlewareNames();
        this.middlewareNamesCache = { names, timestamp: now };

        return names;
    }

    private async computeMiddlewareNames(): Promise<Set<string>> {
        const names = new Set<string>();
        const dirs = await FileUtils.findAllDirsByName(this.nuxtProjectRoot, 'middleware');

        for (const dir of dirs) {
            const files = await vscode.workspace.findFiles(new vscode.RelativePattern(dir, '**/*.{ts,js}'));

            for (const file of files) {
                if (FileUtils.isTestFile(file.fsPath, this.nuxtProjectRoot)) {
                    continue;
                }

                const base = path.basename(file.fsPath).replace(/\.(ts|js)$/, '');

                // Un middleware .global.ts s'applique automatiquement : il n'est jamais
                // référencé par son nom dans definePageMeta.
                if (base.endsWith('.global')) {
                    continue;
                }

                names.add(base);
            }
        }

        return names;
    }

    private async getCachedLayoutNames(): Promise<Set<string>> {
        const now = Date.now();

        if (this.layoutNamesCache && (now - this.layoutNamesCache.timestamp < this.cacheTTL)) {
            return this.layoutNamesCache.names;
        }

        const names = await this.computeLayoutNames();
        this.layoutNamesCache = { names, timestamp: now };

        return names;
    }

    private async computeLayoutNames(): Promise<Set<string>> {
        const names = new Set<string>();
        const dirs = await FileUtils.findAllDirsByName(this.nuxtProjectRoot, 'layouts');

        for (const dir of dirs) {
            const files = await vscode.workspace.findFiles(new vscode.RelativePattern(dir, '**/*.vue'));

            for (const file of files) {
                names.add(path.basename(file.fsPath, '.vue'));
            }
        }

        return names;
    }

    public dispose(): void {
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
        }
    }
}
