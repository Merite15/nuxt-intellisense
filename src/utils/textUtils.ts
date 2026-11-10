import * as vscode from 'vscode';

export class TextUtils {
    /**
       * Converts a character index in a string to a VSCode Position
       */
    static indexToPosition(content: string, index: number): { line: number, character: number } {
        const lines = content.slice(0, index).split('\n');
        const line = lines.length - 1;
        const character = lines[lines.length - 1].length;
        return { line, character };
    }

    /**
     * Find all matches for a regex in content starting from a specific position
     */
    static findMatches(regex: RegExp, content: string, uri: vscode.Uri, results: vscode.Location[]): void {
        let match;
        while ((match = regex.exec(content)) !== null) {
            const start = this.indexToPosition(content, match.index);
            const end = this.indexToPosition(content, match.index + match[0].length);

            results.push(new vscode.Location(
                uri,
                new vscode.Range(
                    new vscode.Position(start.line, start.character),
                    new vscode.Position(end.line, end.character)
                )
            ));
        }
    }

    /**
     * Heuristique : détermine si l'index donné se trouve à l'intérieur d'une chaîne
     * de caractères ('...', "...", `...`) en comptant les guillemets non échappés
     * depuis le début de la ligne contenant cet index.
     */
    static isInsideStringLiteral(content: string, index: number): boolean {
        const lineStart = content.lastIndexOf('\n', index - 1) + 1;
        const before = content.slice(lineStart, index);

        let inSingle = false;
        let inDouble = false;
        let inBacktick = false;

        for (let i = 0; i < before.length; i++) {
            if (before[i] === '\\') {
                i++; // ignorer le caractère échappé
                continue;
            }

            const char = before[i];

            if (char === "'" && !inDouble && !inBacktick) inSingle = !inSingle;
            else if (char === '"' && !inSingle && !inBacktick) inDouble = !inDouble;
            else if (char === '`' && !inSingle && !inDouble) inBacktick = !inBacktick;
        }

        return inSingle || inDouble || inBacktick;
    }

    /**
     * Extrait le bloc `{...}` qui commence à `openBraceIndex` en gérant les accolades
     * imbriquées (contrairement à une regex du type `\{[^}]*\}` qui s'arrête à la
     * première accolade fermante rencontrée, même si elle appartient à un objet
     * imbriqué comme `layout: { props: { ... } }`).
     */
    static extractBalancedBlock(content: string, openBraceIndex: number): string | null {
        if (content[openBraceIndex] !== '{') {
            return null;
        }

        let depth = 0;

        for (let i = openBraceIndex; i < content.length; i++) {
            if (content[i] === '{') {
                depth++;
            } else if (content[i] === '}') {
                depth--;
                if (depth === 0) {
                    return content.slice(openBraceIndex, i + 1);
                }
            }
        }

        return null;
    }

    /**
     * CodeLens complémentaire affiché à côté d'un "0 reference" : notre détection
     * est basée sur des regex, pas un vrai parseur — avant de supprimer quoi que ce
     * soit, mieux vaut permettre à l'utilisateur de vérifier lui-même via la
     * recherche globale de VS Code plutôt que de faire confiance aveuglément.
     */
    /**
     * `regexQuery`, si fourni, restreint la recherche à des usages plausibles du
     * membre (accès `.member`, déstructuration `{ member }`) plutôt qu'une
     * recherche du mot brut — utile pour les noms de variable/méthode génériques
     * (ex: `loading`, `error`) qui apparaissent ailleurs dans le projet sans
     * rapport avec ce store/composable précis.
     */
    static buildSearchInWorkspaceLens(range: vscode.Range, name: string, regexQuery?: string, filesToInclude?: string[]): vscode.CodeLens {
        const scoped = !!filesToInclude && filesToInclude.length > 0;
        const args: Record<string, unknown> = regexQuery
            ? { query: regexQuery, isRegex: true, triggerSearch: true }
            : { query: name, triggerSearch: true };
        if (scoped) {
            // Restreint la recherche aux fichiers qui utilisent réellement le store
            args.filesToInclude = filesToInclude!.join(',');
        }
        return new vscode.CodeLens(range, {
            title: scoped
                ? `$(search) Rechercher "${name}" dans les ${filesToInclude!.length} fichier${filesToInclude!.length > 1 ? 's' : ''} utilisant ce store`
                : `$(search) Rechercher "${name}" dans le projet`,
            command: 'workbench.action.findInFiles',
            arguments: [args]
        });
    }

    /**
     * Construit une regex de recherche scopée pour un membre de store/composable :
     * accès par point (`store.member`, `store.value.member`) ou déstructuration
     * (`const { member } = ...`), afin d'éviter le bruit d'une simple recherche
     * texte pour des noms courants comme `loading` ou `error`.
     */
    static buildMemberSearchRegex(memberName: string): string {
        return `\\.${memberName}\\b|\\{[^}]*\\b${memberName}\\b[^}]*\\}\\s*=`;
    }

    /**
     * Énumère les clés `nom:` situées directement au premier niveau du contenu d'un
     * objet (pas dans un objet/tableau/fonction imbriqué), en ignorant le contenu
     * des chaînes de caractères pour éviter les faux positifs. `objectContent` ne
     * doit pas inclure les accolades englobantes.
     */
    static extractTopLevelKeys(objectContent: string): { name: string; index: number }[] {
        const keys: { name: string; index: number }[] = [];
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

            // Essayer une clé (quotée ou non) avant le skip générique de chaîne
            // ci-dessous : sinon le guillemet ouvrant d'une clé quotée ("kebab-key": 1)
            // serait consommé comme une chaîne quelconque avant d'atteindre ce test.
            if (depth === 0) {
                const keyMatch = /^(?:([A-Za-z_$][\w$]*)|(['"`])([^'"`]+)\2)\s*:/.exec(objectContent.slice(i));
                if (keyMatch) {
                    const name = keyMatch[1] ?? keyMatch[3];
                    keys.push({ name, index: i });
                    i += keyMatch[0].length;
                    continue;
                }
            }

            if (char === "'" || char === '"' || char === '`') {
                const quote = char;
                i++;
                while (i < objectContent.length && objectContent[i] !== quote) {
                    if (objectContent[i] === '\\') i++;
                    i++;
                }
                i++;
                continue;
            }

            i++;
        }

        return keys;
    }

    static removeDuplicateReferences(references: vscode.Location[]): vscode.Location[] {
        const uniqueRefs: vscode.Location[] = [];
        const seen = new Set<string>();

        for (const ref of references) {
            const key = `${ref.uri.fsPath}:${ref.range.start.line}:${ref.range.start.character}`;
            if (!seen.has(key)) {
                seen.add(key);
                uniqueRefs.push(ref);
            }
        }

        return uniqueRefs;
    }
}