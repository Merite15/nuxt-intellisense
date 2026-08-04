import * as vscode from 'vscode';
import * as path from 'path';
import { ComponentService } from '../services/ComponentService';

/**
 * Survoler un tag de composant dans un template (`<MyButton>` ou `<my-button>`)
 * affiche son nombre de références sans avoir besoin d'ouvrir son fichier de
 * définition. Réutilise directement `ComponentService` pour rester cohérent avec le
 * CodeLens (même cache, même logique de comptage).
 *
 * @author Merite15
 * @created 2026-08-01
 */
export class NuxtHoverProvider implements vscode.HoverProvider {
    constructor(private componentService: ComponentService) { }

    async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
        if (path.extname(document.fileName) !== '.vue') {
            return undefined;
        }

        const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z][\w-]*/);
        if (!wordRange) {
            return undefined;
        }

        const word = document.getText(wordRange);
        const line = document.lineAt(position.line).text;
        const charBeforeWord = line.charAt(wordRange.start.character - 1);
        const twoCharsBeforeWord = line.charAt(wordRange.start.character - 2);

        // Ne réagir que sur un nom de balise (`<Foo` ou `</Foo`), pas sur un mot
        // quelconque dans le template ou le script.
        const isTagPosition = charBeforeWord === '<' || (charBeforeWord === '/' && twoCharsBeforeWord === '<');
        if (!isTagPosition) {
            return undefined;
        }

        const pascalName = this.toPascalCase(word);

        const filePath = await this.componentService.findComponentFileByExactName(pascalName);
        if (!filePath) {
            return undefined;
        }

        const references = await this.componentService.findComponentReferences(pascalName);
        const count = references.length;
        const { props, slots } = await this.componentService.getComponentMetadata(filePath);

        const markdown = new vscode.MarkdownString();
        markdown.appendMarkdown(`**$(package) ${pascalName}** — ${count} reference${count > 1 ? 's' : ''}\n\n`);

        if (props.length > 0) {
            markdown.appendMarkdown(`**Props**\n\n`);
            for (const prop of props) {
                markdown.appendMarkdown(`- \`${prop.name}\`${prop.required ? '' : '?'}: \`${prop.type}\`\n`);
            }
            markdown.appendMarkdown('\n');
        }

        if (slots.length > 0) {
            markdown.appendMarkdown(`**Slots**\n\n`);
            for (const slot of slots) {
                markdown.appendMarkdown(`- \`${slot.name}\`\n`);
            }
            markdown.appendMarkdown('\n');
        }

        markdown.appendMarkdown(`[Open definition](${vscode.Uri.file(filePath)})`);
        markdown.isTrusted = true;
        markdown.supportThemeIcons = true;

        return new vscode.Hover(markdown, wordRange);
    }

    private toPascalCase(word: string): string {
        return word
            .split('-')
            .map(part => part.charAt(0).toUpperCase() + part.slice(1))
            .join('');
    }
}
