import * as path from 'path';
import * as fs from 'fs';

/**
 * @author Merite15
 * @created 2025-04-26 07:13:46
 */
export class PathUtils {
    /**
     * Convert PascalCase to kebab-case
     */
    static pascalToKebabCase(str: string): string {
        return str
            .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
            .replace(/([A-Z])([A-Z])(?=[a-z])/g, '$1-$2')
            .toLowerCase();
    }

    /**
     * Vérifie si un chemin d'import pointe vers notre fichier
     */
    static isImportPointingToFile(importPath: string, importingFile: string, targetFile: string, nuxtProjectRoot: string): boolean {
        if (importPath.startsWith('./') || importPath.startsWith('../')) {
            const importingDir = path.dirname(importingFile);

            const resolvedPath = path.resolve(importingDir, importPath);

            const resolvedWithExt = this.resolveWithExtension(resolvedPath);

            return resolvedWithExt === targetFile;
        } else if (importPath.startsWith('~/') || importPath.startsWith('@/')) {
            const aliasPath = importPath.substring(2);

            // Nuxt 3 résout ~/ et @/ depuis la racine du projet ; Nuxt 4 les résout
            // depuis app/ (nouveau srcDir par défaut). On essaie les deux.
            const candidateBases = [nuxtProjectRoot!, path.join(nuxtProjectRoot!, 'app')];

            return candidateBases.some(base => {
                const resolvedPath = path.join(base, aliasPath);
                const resolvedWithExt = this.resolveWithExtension(resolvedPath);
                return resolvedWithExt === targetFile;
            });
        }
        return false;
    }

    /**
     * Résoudre le chemin avec l'extension correcte
     */
    static resolveWithExtension(filePath: string): string {
        const extensions = ['.ts', '.js', '.vue'];

        // Si le chemin a déjà une extension valide
        if (extensions.includes(path.extname(filePath))) {
            return filePath;
        }

        // Essayer chaque extension
        for (const ext of extensions) {
            const pathWithExt = filePath + ext;
            if (fs.existsSync(pathWithExt)) {
                return pathWithExt;
            }
        }

        // Essayer avec /index
        for (const ext of extensions) {
            const indexPath = path.join(filePath, `index${ext}`);

            if (fs.existsSync(indexPath)) {
                return indexPath;
            }
        }

        return filePath;
    }
}