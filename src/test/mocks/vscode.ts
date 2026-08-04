/**
 * Mock minimal de l'API `vscode` utilisée par cette extension, pour pouvoir exécuter
 * les services en dehors d'un Extension Host réel (tests unitaires/intégration rapides,
 * sans télécharger ni lancer VS Code).
 *
 * N'implémente que le sous-ensemble de l'API réellement consommé par le code source.
 */
import * as fs from 'fs';
import * as path from 'path';

export class Position {
    constructor(public line: number, public character: number) { }
}

export class Range {
    public start: Position;
    public end: Position;

    constructor(startLine: number | Position, startChar?: number | Position, endLine?: number, endChar?: number) {
        if (startLine instanceof Position) {
            this.start = startLine;
            this.end = startChar as Position;
        } else {
            this.start = new Position(startLine, startChar as number);
            this.end = new Position(endLine as number, endChar as number);
        }
    }
}

export class Location {
    constructor(public uri: Uri, public range: Range) { }
}

export class CodeLens {
    constructor(public range: Range, public command?: any) { }
}

export class MarkdownString {
    public value: string = '';
    public isTrusted: boolean = false;
    public supportThemeIcons: boolean = false;

    appendMarkdown(value: string): MarkdownString {
        this.value += value;
        return this;
    }
}

export class Hover {
    constructor(public contents: MarkdownString | string, public range?: Range) { }
}

export class Uri {
    private constructor(public fsPath: string) { }

    static file(fsPath: string): Uri {
        return new Uri(fsPath);
    }

    toString(): string {
        return 'file://' + this.fsPath.split(path.sep).join('/');
    }
}

export class RelativePattern {
    public base: string;
    public pattern: string;

    constructor(base: string | { fsPath: string }, pattern: string) {
        this.base = typeof base === 'string' ? base : base.fsPath;
        this.pattern = pattern;
    }
}

export class Disposable {
    static from(..._items: any[]): Disposable {
        return new Disposable();
    }
    dispose(): void { }
}

export class ThemeIcon {
    constructor(public id: string) { }
}

export enum TreeItemCollapsibleState {
    None = 0,
    Collapsed = 1,
    Expanded = 2
}

export class TreeItem {
    public iconPath?: ThemeIcon;
    public resourceUri?: Uri;
    public description?: string;
    public tooltip?: string;
    public contextValue?: string;
    public command?: any;

    constructor(public label: string, public collapsibleState: TreeItemCollapsibleState) { }
}

export class EventEmitter<T> {
    private listeners: Array<(value: T) => void> = [];

    event = (listener: (value: T) => void): Disposable => {
        this.listeners.push(listener);
        return new Disposable();
    };

    fire(value: T): void {
        for (const listener of this.listeners) {
            listener(value);
        }
    }

    dispose(): void {
        this.listeners = [];
    }
}

export enum DiagnosticSeverity {
    Error = 0,
    Warning = 1,
    Information = 2,
    Hint = 3
}

export class Diagnostic {
    constructor(public range: Range, public message: string, public severity: DiagnosticSeverity) { }
}

// ---- État mutable du mock, contrôlable par les tests ----

interface MockState {
    fixtureRoot: string;
    config: Record<string, any>;
}

export const __mockState: MockState = {
    fixtureRoot: process.cwd(),
    config: {}
};

export function setFixtureRoot(dir: string): void {
    __mockState.fixtureRoot = dir;
}

export function setConfig(overrides: Record<string, any>): void {
    __mockState.config = overrides;
}

export function resetMock(): void {
    __mockState.fixtureRoot = process.cwd();
    __mockState.config = {};
}

// ---- Résolution de glob minimaliste (**, *, ?, {a,b,c}) ----

function globToRegExp(glob: string): RegExp {
    let out = '';
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === '*') {
            if (glob[i + 1] === '*') {
                out += '.*';
                i++;
                if (glob[i + 1] === '/') i++;
            } else {
                out += '[^/]*';
            }
        } else if (c === '?') {
            out += '[^/]';
        } else if (c === '{') {
            const close = glob.indexOf('}', i);
            const inner = glob.slice(i + 1, close);
            out += '(?:' + inner.split(',').map(s => globToRegExp(s.trim()).source.slice(1, -1)).join('|') + ')';
            i = close;
        } else if ('.+^$()|[]\\'.includes(c)) {
            out += '\\' + c;
        } else {
            out += c;
        }
    }
    return new RegExp('^' + out + '$');
}

function walk(dir: string, results: string[]): void {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(full, results);
        } else {
            results.push(full);
        }
    }
}

function toPosix(p: string): string {
    return p.split(path.sep).join('/');
}

export const workspace = {
    workspaceFolders: undefined as { uri: Uri; name: string; index: number }[] | undefined,

    async findFiles(include: string | RelativePattern, exclude?: string): Promise<Uri[]> {
        let base = __mockState.fixtureRoot;
        let pattern: string;

        if (include instanceof RelativePattern) {
            base = include.base;
            pattern = include.pattern;
        } else {
            pattern = include;
        }

        const all: string[] = [];
        walk(base, all);

        const includeRe = globToRegExp(pattern);
        const excludeRe = exclude ? globToRegExp(exclude) : null;

        return all
            .filter(fullPath => {
                const rel = toPosix(path.relative(__mockState.fixtureRoot, fullPath));
                if (!includeRe.test(rel)) return false;
                if (excludeRe && excludeRe.test(rel)) return false;
                return true;
            })
            .map(p => Uri.file(p));
    },

    createFileSystemWatcher() {
        return {
            onDidChange() { return new Disposable(); },
            onDidCreate() { return new Disposable(); },
            onDidDelete() { return new Disposable(); },
            dispose() { }
        };
    },

    getConfiguration(section?: string) {
        return {
            get<T>(key: string, defaultValue?: T): T {
                const full = section ? `${section}.${key}` : key;
                return full in __mockState.config ? __mockState.config[full] : (defaultValue as T);
            },
            update() {
                return Promise.resolve();
            }
        };
    }
};

export const commands = {
    async executeCommand<T>(): Promise<T | undefined> {
        return undefined;
    }
};

export const languages = {
    createDiagnosticCollection() {
        return {
            set() { },
            delete() { },
            dispose() { }
        };
    }
};

export const window = {
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined
};

export const extensions = {
    getExtension: () => undefined
};
