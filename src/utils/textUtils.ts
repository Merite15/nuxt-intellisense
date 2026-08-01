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