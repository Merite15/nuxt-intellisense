import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const DEFAULT_IGNORED_DIRECTORIES = ['utils', 'lib', 'helpers', 'constants', 'shared', 'public', 'config', 'assets'];

/**
 * @author Merite15
 * @created 2025-04-26 07:15:08
 */
export class FileUtils {
    /**
     * Dossiers exclus de la recherche de références (composants, composables, stores),
     * configurables via `nuxt-intellisense.ignoredDirectories`.
     */
    static getIgnoredDirectories(): string[] {
        const configured = vscode.workspace
            .getConfiguration('nuxt-intellisense')
            .get<string[]>('ignoredDirectories');

        return Array.isArray(configured) && configured.length > 0
            ? configured
            : DEFAULT_IGNORED_DIRECTORIES;
    }

    /**
     * Construit le glob d'exclusion standard (node_modules/.nuxt/.output/dist +
     * dossiers ignorés configurables + dossiers additionnels optionnels) à passer
     * en second argument de `vscode.workspace.findFiles`.
     */
    static buildExcludeGlob(extraDirs: string[] = []): string {
        const base = ['**/node_modules/**', '**/.nuxt/**', '**/.output/**', '**/dist/**'];
        const ignored = this.getIgnoredDirectories().map(dir => `**/${dir}/**`);
        const extras = extraDirs.map(dir => `**/${dir}/**`);

        return `{${[...base, ...ignored, ...extras].join(',')}}`;
    }

    /**
     * Find all directories with a specific name in the project
     */
    static async findAllDirsByName(nuxtProjectRoot: string, dirName: string): Promise<string[]> {
        const dirs: string[] = [];

        if (!nuxtProjectRoot) return dirs;

        const initialDirs = [
            nuxtProjectRoot,
            path.join(nuxtProjectRoot, 'app'),
            path.join(nuxtProjectRoot, 'app', 'base'),
            path.join(nuxtProjectRoot, 'app', 'modules')
        ].filter(dir => fs.existsSync(dir));

        for (const initialDir of initialDirs) {
            const recurse = (dir: string) => {
                try {
                    const entries = fs.readdirSync(dir, { withFileTypes: true });

                    for (const entry of entries) {
                        const fullPath = path.join(dir, entry.name);
                        if (entry.isDirectory()) {
                            if (entry.name === dirName) {
                                dirs.push(fullPath);
                            }

                            if (entry.name !== 'node_modules' && entry.name !== '.nuxt' && entry.name !== '.output') {
                                recurse(fullPath); // continuer la récursion
                            }
                        }
                    }
                } catch (e) {
                    // Ignore errors for directories that can't be read
                }
            };

            recurse(initialDir);
        }

        return dirs;
    }

    /**
     * Check if a file should be skipped during search
     */
    static shouldSkipFile(fsPath: string): boolean {
        return fsPath.includes('node_modules') ||
            fsPath.includes('.nuxt') ||
            fsPath.includes('.output') ||
            fsPath.includes('dist');
    }

    /**
     * Glob d'exclusion minimal (sans les dossiers configurables), utile pour les
     * catégories qui pointent elles-mêmes vers un dossier normalement ignoré (utils, ...).
     */
    static buildBaseExcludeGlob(): string {
        return '{**/node_modules/**,**/.nuxt/**,**/.output/**,**/dist/**}';
    }

    /**
     * Recherche la racine d'un projet Nuxt en remontant depuis un chemin donné.
     *
     * Remonte jusqu'à la racine du système de fichiers et retient le dossier "certain"
     * (nuxt.config + package.json/.git/pnpm-workspace.yaml) le plus externe rencontré,
     * plutôt que le premier trouvé. Un layer local imbriqué (ex: layers/blog/) a
     * souvent son propre nuxt.config.ts et parfois son propre package.json ; s'arrêter
     * au premier candidat trouverait le layer au lieu de la vraie racine du monorepo.
     */
    static findNuxtProjectRoot(startPath: string): string | null {
        let currentDir = fs.statSync(startPath, { throwIfNoEntry: false })?.isDirectory()
            ? startPath
            : path.dirname(startPath);

        const root = path.parse(currentDir).root;
        let bestCandidate: string | null = null;
        let certainRoot: string | null = null;

        while (currentDir !== root) {
            const hasNuxtConfig = fs.existsSync(path.join(currentDir, 'nuxt.config.ts')) ||
                fs.existsSync(path.join(currentDir, 'nuxt.config.js'));
            const hasPackageJson = fs.existsSync(path.join(currentDir, 'package.json'));
            const hasGit = fs.existsSync(path.join(currentDir, '.git'));
            const hasPnpmWorkspace = fs.existsSync(path.join(currentDir, 'pnpm-workspace.yaml'));

            if (hasNuxtConfig) {
                if (hasPackageJson || hasGit || hasPnpmWorkspace) {
                    certainRoot = currentDir;
                } else {
                    bestCandidate = currentDir;
                }
            }

            currentDir = path.dirname(currentDir);
        }

        return certainRoot ?? bestCandidate;
    }
}