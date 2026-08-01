import * as vscode from 'vscode';
import * as fs from 'fs';
import { FileUtils } from '../utils/fileUtils';
import { TextUtils } from '../utils/textUtils';
import type { NuxtComponentInfo } from '../types';

interface ReferenceCache {
    references: vscode.Location[];
    timestamp: number;
}

export class StoreService {
    private referenceCache: Map<string, ReferenceCache> = new Map();

    private referenceCacheTTL: number = 300000;

    private fileWatcher: vscode.FileSystemWatcher | undefined;

    constructor(private autoImportCache: Map<string, NuxtComponentInfo[]>) {
        this.setupFileWatcher();
    }

    private setupFileWatcher() {
        this.fileWatcher = vscode.workspace.createFileSystemWatcher(
            '**/*.{vue,ts,js}',
            false,
            false,
            false
        );

        this.fileWatcher.onDidChange(() => this.invalidateReferenceCache());

        this.fileWatcher.onDidCreate(() => this.invalidateReferenceCache());

        this.fileWatcher.onDidDelete(() => this.invalidateReferenceCache());

        vscode.Disposable.from(this.fileWatcher);
    }

    async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        const lenses: vscode.CodeLens[] = [];

        const text = document.getText();

        const defineStoreRegex = /defineStore\s*\(\s*(['"`])(.*?)\1/g;

        let match: RegExpExecArray | null;

        while ((match = defineStoreRegex.exec(text))) {
            const storeName = match[2];
            const pos = document.positionAt(match.index);
            const range = new vscode.Range(pos.line, 0, pos.line, 0);

            const cacheKey = `${document.uri.toString()}:${storeName}`;
            const preciseReferences = await this.getCachedReferences(cacheKey, storeName);
            const uniqueReferences = TextUtils.removeDuplicateReferences(preciseReferences);
            const referenceCount = uniqueReferences.length;

            // Trouver les informations du store dans le cache
            const storeInfo = this.autoImportCache.get('stores')?.find(s => s.name === storeName);


            let memberDetails = [];

            // Dans provideCodeLenses, modifiez la partie qui ajoute les CodeLens pour les membres :
            if (storeInfo?.members) {
                const { methods, variables, getters } = storeInfo.members;

                if (methods?.length) {
                    memberDetails.push(`$(symbol-method) ${methods.length} method${methods.length > 1 ? 's' : ''}`);
                }
                if (variables?.length) {
                    memberDetails.push(`$(symbol-variable) ${variables.length} var${variables.length > 1 ? 's' : ''}`);
                }
                if (getters?.length) {
                    memberDetails.push(`$(symbol-property) ${getters.length} getter${getters.length > 1 ? 's' : ''}`);
                }
                // Pour les méthodes
                for (const method of methods || []) {

                    const methodRegex = new RegExp(`(?:async\\s+)?function\\s+${method}\\s*\\(|const\\s+${method}\\s*=\\s*(?:async\\s*)?\\(?([^)=]*)\\)?\\s*=>`);
                    const methodMatch = text.match(methodRegex);
                    if (methodMatch) {
                        const methodPos = text.indexOf(methodMatch[0]);
                        const methodLine = document.positionAt(methodPos).line;
                        const methodRange = new vscode.Range(methodLine, 0, methodLine, 0);

                        // Trouver les références de cette méthode
                        const references = await this.getCachedMemberReferences(storeName, method);
                        const uniqueReferences = TextUtils.removeDuplicateReferences(references);

                        lenses.push(new vscode.CodeLens(methodRange, {
                            title: `$(symbol-method) ${method}() • ${uniqueReferences.length} reference${uniqueReferences.length !== 1 ? 's' : ''}`,
                            command: 'editor.action.showReferences',
                            arguments: [
                                document.uri,
                                document.positionAt(methodPos),
                                uniqueReferences
                            ],
                            tooltip: `Method of ${storeName} store\nClick to show references`
                        }));
                    }
                }

                // Pour les variables
                for (const variable of variables || []) {
                    const varRegex = new RegExp(`(const|let|var)\\s+${variable}\\s*=[^=]`);
                    const varMatch = text.match(varRegex);
                    if (varMatch) {
                        const varPos = text.indexOf(varMatch[0]);
                        const varLine = document.positionAt(varPos).line;
                        const varRange = new vscode.Range(varLine, 0, varLine, 0);

                        const references = await this.getCachedMemberReferences(storeName, variable);
                        const uniqueReferences = TextUtils.removeDuplicateReferences(references);

                        lenses.push(new vscode.CodeLens(varRange, {
                            title: `$(symbol-variable) ${variable} • ${uniqueReferences.length} reference${uniqueReferences.length !== 1 ? 's' : ''}`,
                            command: 'editor.action.showReferences',
                            arguments: [
                                document.uri,
                                document.positionAt(varPos),
                                uniqueReferences
                            ],
                            tooltip: `Variable of ${storeName} store\nClick to show references`
                        }));
                    }
                }

                // Pour les getters
                for (const getter of getters || []) {
                    const getterRegex = new RegExp(`const\\s+${getter}\\s*=\\s*computed\\s*\\(`);
                    const getterMatch = text.match(getterRegex);
                    if (getterMatch) {
                        const getterPos = text.indexOf(getterMatch[0]);
                        const getterLine = document.positionAt(getterPos).line;
                        const getterRange = new vscode.Range(getterLine, 0, getterLine, 0);

                        const references = await this.getCachedMemberReferences(storeName, getter);
                        const uniqueReferences = TextUtils.removeDuplicateReferences(references);

                        lenses.push(new vscode.CodeLens(getterRange, {
                            title: `$(symbol-property) ${getter} • ${uniqueReferences.length} reference${uniqueReferences.length !== 1 ? 's' : ''}`,
                            command: 'editor.action.showReferences',
                            arguments: [
                                document.uri,
                                document.positionAt(getterPos),
                                uniqueReferences
                            ],
                            tooltip: `Getter of ${storeName} store\nClick to show references`
                        }));
                    }
                }
            }

            const memberInfo = memberDetails.length > 0 ? ` [${memberDetails.join(' | ')}]` : '';

            lenses.push(
                new vscode.CodeLens(range, {
                    title: `$(database) ${storeName}${memberInfo} • ${referenceCount} reference${referenceCount > 1 ? 's' : ''}`,
                    command: 'editor.action.showReferences',
                    arguments: [
                        document.uri,
                        new vscode.Position(pos.line, match[0].indexOf(storeName)),
                        uniqueReferences
                    ]
                })
            );
        }

        return lenses;
    }

    private async getCachedReferences(cacheKey: string, storeName: string): Promise<vscode.Location[]> {
        const now = Date.now();

        const cachedData = this.referenceCache.get(cacheKey);

        if (cachedData && (now - cachedData.timestamp < this.referenceCacheTTL)) {
            return cachedData.references;
        }

        const references = await this.findStoreReferences(storeName);

        this.referenceCache.set(cacheKey, {
            references,
            timestamp: now
        });

        return references;
    }

    async findStoreReferences(storeName: string): Promise<vscode.Location[]> {
        try {
            const normalizedName = storeName
                .split(/[-_\s]/)
                .map(s => s.charAt(0).toUpperCase() + s.slice(1))
                .join('');

            const storeHookName = `use${normalizedName}Store`;

            const possibleStoreIds = [
                storeName,
                storeName.replace(/-/g, ' '),
                storeName.replace(/-/g, '_'),
                `${storeName}s`,
                `${storeName.replace(/-/g, ' ')}s`,
                `${storeName.replace(/-/g, '_')}s`
            ];

            const uris = await vscode.workspace.findFiles(
                '**/*.{vue,js,ts}',
                '{**/node_modules/**,**/.nuxt/**,**/.output/**,**/dist/**,, **/utils/**,**/lib/**,**/helpers/**,**/constants/**,**/shared/**, **/public/**,**/config/**, **/assets/**}'
            );

            const results: vscode.Location[] = [];

            const storeDefinitions: Map<string, string> = new Map();

            const storeDefinitionFiles: Set<string> = new Set();

            for (const uri of uris) {
                if (FileUtils.shouldSkipFile(uri.fsPath)) {
                    continue;
                }

                let content: string;

                try {
                    content = fs.readFileSync(uri.fsPath, 'utf-8');
                } catch (e) {
                    continue;
                }

                const defineStoreRegex = /defineStore\s*\(\s*['"]([^'"]+)['"]/g;

                let defineMatch;

                while ((defineMatch = defineStoreRegex.exec(content)) !== null) {
                    const storeId = defineMatch[1];

                    if (possibleStoreIds.includes(storeId)) {
                        storeDefinitionFiles.add(uri.fsPath);
                    }

                    const hookNameRegex = /const\s+(\w+)\s*=\s*defineStore\s*\(\s*['"]([^'"]+)['"]/g;

                    hookNameRegex.lastIndex = 0;

                    let hookMatch;
                    while ((hookMatch = hookNameRegex.exec(content)) !== null) {
                        if (hookMatch[2] === storeId) {
                            storeDefinitions.set(storeId, hookMatch[1]);

                            break;
                        }
                    }
                }
            }

            for (const uri of uris) {
                if (FileUtils.shouldSkipFile(uri.fsPath) || storeDefinitionFiles.has(uri.fsPath)) {
                    continue;
                }

                let content: string;

                try {
                    content = fs.readFileSync(uri.fsPath, 'utf-8');
                } catch (e) {
                    continue;
                }

                const hookRegex = new RegExp(`\\b${storeHookName}\\b`, 'g');

                TextUtils.findMatches(hookRegex, content, uri, results);

                for (const storeId of possibleStoreIds) {
                    const storeIdRegex = new RegExp(`useStore\\s*\\(\\s*['"]${storeId}['"]\\s*\\)`, 'g');

                    TextUtils.findMatches(storeIdRegex, content, uri, results);

                    if (storeDefinitions.has(storeId)) {
                        const hookName = storeDefinitions.get(storeId)!;

                        const customHookRegex = new RegExp(`\\b${hookName}\\b`, 'g');

                        TextUtils.findMatches(customHookRegex, content, uri, results);
                    }
                }
            }

            return results;
        } catch (e) {
            return [];
        }
    }

    private async findMemberReferences(storeName: string, memberName: string): Promise<vscode.Location[]> {
        const normalizedName = storeName
            .split(/[-_\s]/)
            .map(s => s.charAt(0).toUpperCase() + s.slice(1))
            .join('');

        const storeHookName = `use${normalizedName}Store`;
        const results: vscode.Location[] = [];

        const uris = await vscode.workspace.findFiles(
            '**/*.{vue,js,ts}',
            '{**/node_modules/**,**/.nuxt/**,**/.output/**,**/dist/**,**/utils/**,**/lib/**,**/helpers/**,**/constants/**,**/shared/**,**/public/**,**/config/**,**/assets/**}'
        );

        // Nouveau: Détection des alias de store
        const storeAliasPatterns: string[] = [];

        for (const uri of uris) {
            if (FileUtils.shouldSkipFile(uri.fsPath)) {
                continue;
            }

            let content: string;
            try {
                content = fs.readFileSync(uri.fsPath, 'utf-8');
            } catch (e) {
                continue;
            }

            // Pattern 1: store.member (avec le hook direct)
            const dotPattern = new RegExp(`\\b${storeHookName}\\(\\).${memberName}\\b`, 'g');
            TextUtils.findMatches(dotPattern, content, uri, results);

            // Pattern 2: const { member } = useStore()
            const destructuringPattern = new RegExp(`const\\s*\\{\\s*${memberName}\\s*\\}\\s*=\\s*${storeHookName}\\(\\\)`, 'g');
            TextUtils.findMatches(destructuringPattern, content, uri, results);

            // Pattern 3: store.value.member (pour les stores en composition API)
            const valuePattern = new RegExp(`\\b${storeHookName}\\(\\).value.${memberName}\\b`, 'g');
            TextUtils.findMatches(valuePattern, content, uri, results);

            // Nouveau: Détection des alias de store (const adminStore = useAdminStore())
            const storeAliasRegex = new RegExp(`const\\s+(\\w+)\\s*=\\s*${storeHookName}\\(\\\)`, 'g');
            let aliasMatch;
            while ((aliasMatch = storeAliasRegex.exec(content)) !== null) {
                const alias = aliasMatch[1];
                if (!storeAliasPatterns.includes(alias)) {
                    storeAliasPatterns.push(alias);
                }
            }

            // Nouveau: Détection des références via storeToRefs
            // Pattern: const { member } = storeToRefs(store)
            const storeToRefsPattern = new RegExp(`const\\s*\\{\\s*${memberName}\\s*\\}\\s*=\\s*storeToRefs\\(\\s*\\w+Store\\s*\\)`, 'g');
            TextUtils.findMatches(storeToRefsPattern, content, uri, results);

            // Pattern spécifique pour les aliases + storeToRefs
            for (const alias of storeAliasPatterns) {
                const aliasStoreToRefsPattern = new RegExp(`const\\s*\\{\\s*${memberName}\\s*\\}\\s*=\\s*storeToRefs\\(\\s*${alias}\\s*\\)`, 'g');
                TextUtils.findMatches(aliasStoreToRefsPattern, content, uri, results);
            }
        }

        // Nouveau: Recherche des références via les alias détectés
        if (storeAliasPatterns.length > 0) {
            for (const uri of uris) {
                if (FileUtils.shouldSkipFile(uri.fsPath)) {
                    continue;
                }

                let content: string;
                try {
                    content = fs.readFileSync(uri.fsPath, 'utf-8');
                } catch (e) {
                    continue;
                }

                for (const alias of storeAliasPatterns) {
                    // Pattern 4: alias.member (adminStore.get())
                    const aliasDotPattern = new RegExp(`\\b${alias}\\.${memberName}\\b`, 'g');
                    TextUtils.findMatches(aliasDotPattern, content, uri, results);

                    // Pattern 5: alias.value.member (pour les stores en composition API)
                    const aliasValuePattern = new RegExp(`\\b${alias}\\.value\\.${memberName}\\b`, 'g');
                    TextUtils.findMatches(aliasValuePattern, content, uri, results);
                }
            }
        }

        return results;
    }

    private memberReferenceCache: Map<string, ReferenceCache> = new Map();

    private async getCachedMemberReferences(storeName: string, memberName: string): Promise<vscode.Location[]> {
        const cacheKey = `${storeName}:${memberName}`;
        const now = Date.now();

        const cachedData = this.memberReferenceCache.get(cacheKey);
        if (cachedData && (now - cachedData.timestamp < this.referenceCacheTTL)) {
            return cachedData.references;
        }

        const references = await this.findMemberReferences(storeName, memberName);
        this.memberReferenceCache.set(cacheKey, {
            references,
            timestamp: now
        });

        return references;
    }

    async scanStoresDirectory(dir: string): Promise<void> {
        if (!fs.existsSync(dir)) {
            return;
        }

        const storeInfos: NuxtComponentInfo[] = [];

        const files = await vscode.workspace.findFiles(
            '**/*.{ts,js}',
            '{**/node_modules/**,**/.nuxt/**,**/.output/**,**/dist/**,, **/utils/**,**/lib/**,**/helpers/**,**/constants/**,**/shared/**, **/public/**,**/config/**, **/assets/**}'
        );

        for (const file of files) {
            try {
                const content = fs.readFileSync(file.fsPath, 'utf-8');

                const defineStoreRegex = /defineStore\s*\(\s*(['"`])(.*?)\1/g;

                let match: RegExpExecArray | null;

                while ((match = defineStoreRegex.exec(content))) {
                    const storeInfo: NuxtComponentInfo = {
                        name: match[2],
                        path: file.fsPath,
                        isAutoImported: true,
                        members: {
                            state: [],
                            getters: [],
                            actions: [],
                            methods: [],
                            variables: []
                        }
                    };

                    // Détection pour API Options
                    if (content.includes('state:') || content.includes('getters:') || content.includes('actions:')) {
                        // Détection des états (state)
                        const stateRegex = /state\s*\(\s*\)\s*:\s*\(\s*\)\s*=>\s*{([^}]*)}/s;
                        const stateMatch = content.match(stateRegex);
                        if (stateMatch && stateMatch[1]) {
                            const stateContent = stateMatch[1];
                            const stateVars = stateContent.split('\n')
                                .map(line => line.trim())
                                .filter(line => line && !line.startsWith('//') && line.includes(':'))
                                .map(line => line.split(':')[0].trim());
                            storeInfo.members!.state = stateVars;
                        }

                        // Détection des getters
                        const gettersRegex = /getters\s*:\s*{([^}]*)}/s;
                        const gettersMatch = content.match(gettersRegex);
                        if (gettersMatch && gettersMatch[1]) {
                            const gettersContent = gettersMatch[1];
                            const getters = gettersContent.split('\n')
                                .map(line => line.trim())
                                .filter(line => line && !line.startsWith('//') && line.includes('('))
                                .map(line => line.split('(')[0].trim());
                            storeInfo.members!.getters = getters;
                        }

                        // Détection des actions
                        const actionsRegex = /actions\s*:\s*{([^}]*)}/s;
                        const actionsMatch = content.match(actionsRegex);
                        if (actionsMatch && actionsMatch[1]) {
                            const actionsContent = actionsMatch[1];
                            const actions = actionsContent.split('\n')
                                .map(line => line.trim())
                                .filter(line => line && !line.startsWith('//') && line.includes('('))
                                .map(line => line.split('(')[0].trim());
                            storeInfo.members!.actions = actions;
                        }
                    }

                    // Détection pour API Composition
                    else {
                        // Détection des variables (const, let, var)
                        const variableRegex = /(const|let|var)\s+([a-zA-Z_$][0-9a-zA-Z_$]*)\s*(?=[:=])/g;
                        let varMatch;
                        while ((varMatch = variableRegex.exec(content)) !== null) {
                            if (!storeInfo.members!.variables!.includes(varMatch[2])) {
                                storeInfo.members!.variables!.push(varMatch[2]);
                            }
                        }

                        // Détection des méthodes (function, async function, arrow)
                        const functionRegex = /(?:async\s+)?function\s+([a-zA-Z_$][0-9a-zA-Z_$]*)\s*\(|const\s+([a-zA-Z_$][0-9a-zA-Z_$]*)\s*=\s*(?:async\s*)?\(?([^)=]*)\)?\s*=>/g;
                        let funcMatch;
                        while ((funcMatch = functionRegex.exec(content)) !== null) {
                            const methodName = funcMatch[1] || funcMatch[2];
                            if (methodName && !storeInfo.members!.methods!.includes(methodName)) {
                                storeInfo.members!.methods!.push(methodName);
                            }
                        }

                        // Détection des computed (getters)
                        const computedRegex = /const\s+([a-zA-Z_$][0-9a-zA-Z_$]*)\s*=\s*computed\s*\(/g;
                        let computedMatch;
                        while ((computedMatch = computedRegex.exec(content)) !== null) {
                            if (!storeInfo.members!.getters!.includes(computedMatch[1])) {
                                storeInfo.members!.getters!.push(computedMatch[1]);
                            }
                        }

                        // Analyse du return pour vérifier ce qui est exposé
                        const returnRegex = /return\s*{([^}]*)}/s;
                        const returnMatch = content.match(returnRegex);
                        if (returnMatch && returnMatch[1]) {
                            const returnContent = returnMatch[1];
                            const returnedMembers = returnContent.split(',')
                                .map(line => line.trim())
                                .filter(line => line && !line.startsWith('//') && !line.startsWith('...'))
                                .map(line => line.split(':')[0].trim());

                            // Filtrer les membres non exposés
                            storeInfo.members!.variables = storeInfo.members!.variables!.filter(v => returnedMembers.includes(v));
                            storeInfo.members!.methods = storeInfo.members!.methods!.filter(m => returnedMembers.includes(m));
                            storeInfo.members!.getters = storeInfo.members!.getters!.filter(g => returnedMembers.includes(g));
                        }
                    }

                    storeInfos.push(storeInfo);
                }
            } catch (e) {
                console.error(`Error parsing store file ${file.fsPath}:`, e);
            }
        }

        this.autoImportCache.set('stores', storeInfos);
        this.invalidateReferenceCache();
    }

    public invalidateReferenceCache(): void {
        this.referenceCache.clear();
        this.memberReferenceCache.clear();
    }

    public dispose(): void {
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
        }
    }
}
