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

        // (en ignorant node_modules/.nuxt/.output/dist, régénérés en continu par Nuxt en dev)
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
            const allStores = this.autoImportCache.get('stores') || [];
            const storeInfo = allStores.find(s => s.name === storeName);

            // Deux fichiers différents peuvent appeler defineStore avec le même id ;
            // Pinia n'en garderait qu'un seul en pratique (collision d'auto-import).
            const conflictingPaths = [...new Set(
                allStores
                    .filter(s => s.name === storeName && s.path !== document.uri.fsPath)
                    .map(s => s.path)
            )];

            if (conflictingPaths.length > 0) {
                const conflictLocations = conflictingPaths.map(
                    p => new vscode.Location(vscode.Uri.file(p), new vscode.Position(0, 0))
                );

                lenses.push(
                    new vscode.CodeLens(range, {
                        title: `$(warning) Store "${storeName}" en conflit avec ${conflictingPaths.length} autre${conflictingPaths.length > 1 ? 's' : ''} fichier${conflictingPaths.length > 1 ? 's' : ''}`,
                        command: 'editor.action.showReferences',
                        arguments: [
                            document.uri,
                            pos,
                            conflictLocations
                        ]
                    })
                );
            }

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

                // Une seule passe sur le workspace pour tous les membres du store
                // (au lieu d'un scan complet par méthode/variable/getter).
                const allMemberNames = [...(methods || []), ...(variables || []), ...(getters || [])];
                const memberReferencesByName = await this.getCachedAllMemberReferences(storeName, allMemberNames);

                // Pour les méthodes
                for (const method of methods || []) {

                    const methodRegex = new RegExp(`(?:async\\s+)?function\\s+${method}\\s*\\(|const\\s+${method}\\s*=\\s*(?:async\\s*)?\\(?([^)=]*)\\)?\\s*=>`);
                    const methodMatch = text.match(methodRegex);
                    if (methodMatch) {
                        const methodPos = text.indexOf(methodMatch[0]);
                        const methodLine = document.positionAt(methodPos).line;
                        const methodRange = new vscode.Range(methodLine, 0, methodLine, 0);

                        // Trouver les références de cette méthode
                        const references = memberReferencesByName.get(method) || [];
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
                        if (uniqueReferences.length === 0) {
                            lenses.push(TextUtils.buildSearchInWorkspaceLens(methodRange, method));
                        }
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

                        const references = memberReferencesByName.get(variable) || [];
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
                        if (uniqueReferences.length === 0) {
                            lenses.push(TextUtils.buildSearchInWorkspaceLens(varRange, variable));
                        }
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

                        const references = memberReferencesByName.get(getter) || [];
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
                        if (uniqueReferences.length === 0) {
                            lenses.push(TextUtils.buildSearchInWorkspaceLens(getterRange, getter));
                        }
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
            if (referenceCount === 0) {
                lenses.push(TextUtils.buildSearchInWorkspaceLens(range, storeName));
            }
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
                FileUtils.buildExcludeGlob()
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

    /**
     * Recherche les références de plusieurs membres d'un store en une seule passe sur
     * le workspace : chaque fichier n'est lu et parcouru qu'une fois, quel que soit le
     * nombre de membres (auparavant : un scan + une lecture complète du workspace par
     * membre, soit un coût multiplié par le nombre de méthodes/variables/getters).
     */
    private async findAllMemberReferences(storeName: string, memberNames: string[]): Promise<Map<string, vscode.Location[]>> {
        const resultsByMember = new Map<string, vscode.Location[]>();
        for (const memberName of memberNames) {
            resultsByMember.set(memberName, []);
        }

        if (memberNames.length === 0) {
            return resultsByMember;
        }

        const normalizedName = storeName
            .split(/[-_\s]/)
            .map(s => s.charAt(0).toUpperCase() + s.slice(1))
            .join('');

        const storeHookName = `use${normalizedName}Store`;

        const uris = await vscode.workspace.findFiles(
            '**/*.{vue,js,ts}',
            FileUtils.buildExcludeGlob()
        );

        const storeAliasPatterns: string[] = [];
        const fileContents = new Map<string, string>();

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
            fileContents.set(uri.fsPath, content);

            // Détection des alias de store (const adminStore = useAdminStore()), indépendante du membre
            const storeAliasRegex = new RegExp(`const\\s+(\\w+)\\s*=\\s*${storeHookName}\\(\\)`, 'g');
            let aliasMatch;
            while ((aliasMatch = storeAliasRegex.exec(content)) !== null) {
                const alias = aliasMatch[1];
                if (!storeAliasPatterns.includes(alias)) {
                    storeAliasPatterns.push(alias);
                }
            }

            for (const memberName of memberNames) {
                const results = resultsByMember.get(memberName)!;

                // Pattern 1: store.member (avec le hook direct)
                const dotPattern = new RegExp(`\\b${storeHookName}\\(\\)\\.${memberName}\\b`, 'g');
                TextUtils.findMatches(dotPattern, content, uri, results);

                // Pattern 2: const { member } = useStore()
                const destructuringPattern = new RegExp(`const\\s*\\{\\s*${memberName}\\s*\\}\\s*=\\s*${storeHookName}\\(\\)`, 'g');
                TextUtils.findMatches(destructuringPattern, content, uri, results);

                // Pattern 3: store.value.member (pour les stores en composition API)
                const valuePattern = new RegExp(`\\b${storeHookName}\\(\\)\\.value\\.${memberName}\\b`, 'g');
                TextUtils.findMatches(valuePattern, content, uri, results);

                // Pattern: const { member } = storeToRefs(store)
                const storeToRefsPattern = new RegExp(`const\\s*\\{\\s*${memberName}\\s*\\}\\s*=\\s*storeToRefs\\(\\s*\\w+Store\\s*\\)`, 'g');
                TextUtils.findMatches(storeToRefsPattern, content, uri, results);
            }
        }

        // Pattern spécifique pour les aliases + storeToRefs, et pour les usages alias.member,
        // une fois tous les alias détectés (nécessite l'ensemble du fichier déjà lu ci-dessus).
        for (const [fsPath, content] of fileContents) {
            const uri = vscode.Uri.file(fsPath);

            for (const memberName of memberNames) {
                const results = resultsByMember.get(memberName)!;

                for (const alias of storeAliasPatterns) {
                    const aliasStoreToRefsPattern = new RegExp(`const\\s*\\{\\s*${memberName}\\s*\\}\\s*=\\s*storeToRefs\\(\\s*${alias}\\s*\\)`, 'g');
                    TextUtils.findMatches(aliasStoreToRefsPattern, content, uri, results);

                    // Pattern 4: alias.member (adminStore.get())
                    const aliasDotPattern = new RegExp(`\\b${alias}\\.${memberName}\\b`, 'g');
                    TextUtils.findMatches(aliasDotPattern, content, uri, results);

                    // Pattern 5: alias.value.member (pour les stores en composition API)
                    const aliasValuePattern = new RegExp(`\\b${alias}\\.value\\.${memberName}\\b`, 'g');
                    TextUtils.findMatches(aliasValuePattern, content, uri, results);
                }
            }
        }

        return resultsByMember;
    }

    private storeMembersReferenceCache: Map<string, { references: Map<string, vscode.Location[]>, timestamp: number }> = new Map();

    private async getCachedAllMemberReferences(storeName: string, memberNames: string[]): Promise<Map<string, vscode.Location[]>> {
        const now = Date.now();

        const cachedData = this.storeMembersReferenceCache.get(storeName);
        if (cachedData && (now - cachedData.timestamp < this.referenceCacheTTL)) {
            return cachedData.references;
        }

        const references = await this.findAllMemberReferences(storeName, memberNames);
        this.storeMembersReferenceCache.set(storeName, {
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
            new vscode.RelativePattern(dir, '**/*.{ts,js}'),
            FileUtils.buildExcludeGlob()
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

                        // functionRegex capture aussi `const NAME = computed(() => ...)` comme méthode
                        // (l'appel englobant n'est pas exclu par la regex) : les computed restent
                        // uniquement des getters.
                        storeInfo.members!.methods = storeInfo.members!.methods!.filter(
                            m => !storeInfo.members!.getters!.includes(m)
                        );

                        // variableRegex capture tout `const/let/var NAME =`, y compris les méthodes
                        // fléchées et les computed déjà classés ailleurs : dédupliquer.
                        storeInfo.members!.variables = storeInfo.members!.variables!.filter(
                            v => !storeInfo.members!.methods!.includes(v) && !storeInfo.members!.getters!.includes(v)
                        );

                        // Analyse du return pour vérifier ce qui est exposé (forme explicite
                        // `return { ... }` ou retour implicite d'une fléchée `=> ({ ... })`).
                        const explicitReturnRegex = /return\s*{([^}]*)}/s;
                        const implicitReturnRegex = /=>\s*\(\s*{([^}]*)}\s*\)/s;
                        const returnMatch = content.match(explicitReturnRegex) || content.match(implicitReturnRegex);
                        if (returnMatch) {
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

        // Fusionner avec les stores déjà connus des autres répertoires "stores"
        // (layers/monorepo) plutôt que d'écraser tout le cache à chaque appel.
        const otherStores = (this.autoImportCache.get('stores') || []).filter(s => !s.path.startsWith(dir));
        this.autoImportCache.set('stores', [...otherStores, ...storeInfos]);
        this.invalidateReferenceCache();
    }

    public invalidateReferenceCache(): void {
        this.referenceCache.clear();
        this.storeMembersReferenceCache.clear();
    }

    public dispose(): void {
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
        }
    }
}
