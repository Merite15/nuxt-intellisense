import * as vscode from 'vscode';
import { NuxtIntellisense } from './providers/NuxtIntellisense';
import { NuxtExplorerProvider } from './providers/NuxtExplorerProvider';
import { NuxtHoverProvider } from './providers/NuxtHoverProvider';
import { ComponentService } from './services/ComponentService';
import { FileUtils } from './utils/fileUtils';

export async function activate(context: vscode.ExtensionContext) {
  const codeLensProvider = new NuxtIntellisense();

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      [
        { language: 'vue' },
        { language: 'typescript' },
        { language: 'javascript' }
      ],
      codeLensProvider
    ),
    codeLensProvider
  );

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

  if (workspaceFolder) {
    const detectedNuxtRoot = FileUtils.findNuxtProjectRoot(workspaceFolder.uri.fsPath);

    // Contrôle la visibilité de la vue "Nuxt Structure" (clause `when` dans package.json) :
    // elle ne doit apparaître que sur un vrai projet Nuxt, pas sur n'importe quel dossier
    // ouvert faute de nuxt.config détecté.
    vscode.commands.executeCommand('setContext', 'nuxtIntellisense.isNuxtProject', detectedNuxtRoot !== null);

    const explorerProvider = new NuxtExplorerProvider(detectedNuxtRoot ?? workspaceFolder.uri.fsPath);

    context.subscriptions.push(
      vscode.window.registerTreeDataProvider('nuxtIntellisenseExplorer', explorerProvider),
      vscode.commands.registerCommand('nuxt-intellisense.refreshExplorer', () => explorerProvider.refresh())
    );

    // Instance dédiée (indépendante de celle du CodeLensProvider, qui n'est créée que
    // lazily au premier fichier ouvert) pour que le survol fonctionne dès l'activation.
    const hoverComponentService = new ComponentService(detectedNuxtRoot ?? workspaceFolder.uri.fsPath);

    context.subscriptions.push(
      vscode.languages.registerHoverProvider('vue', new NuxtHoverProvider(hoverComponentService)),
      hoverComponentService
    );
  }

  const disposableCommands = [
    vscode.commands.registerCommand('nuxt-intellisense.refreshCodeLens', () => {
      vscode.commands.executeCommand('editor.action.triggerParameterHints');
    }),

    vscode.commands.registerCommand('nuxt-intellisense.showDocumentation', () => {
      vscode.Uri.parse('https://github.com/Merite15/Nuxt-Intellisense#readme')
    }),

    vscode.commands.registerCommand(
      'nuxt-intellisense.showStaleProps',
      async (props: { name: string; locations: vscode.Location[] }[]) => {
        if (!props || props.length === 0) {
          return;
        }

        const items = props.map(p => ({
          label: `$(symbol-property) ${p.name}`,
          description: `${p.locations.length} parent${p.locations.length > 1 ? 's' : ''} la transmet${p.locations.length > 1 ? 'tent' : ''} encore`,
          prop: p
        }));

        const picked = await vscode.window.showQuickPick(items, {
          placeHolder: 'Prop déclarée mais inutilisée — voir les parents qui la passent encore'
        });

        if (!picked) {
          return;
        }

        const locations = picked.prop.locations.map(
          (l: any) => new vscode.Location(vscode.Uri.file(l.uri.fsPath ?? l.uri.path), new vscode.Range(
            l.range.start.line, l.range.start.character,
            l.range.end.line, l.range.end.character
          ))
        );

        await vscode.commands.executeCommand(
          'editor.action.showReferences',
          locations[0].uri,
          locations[0].range.start,
          locations
        );
      }
    )
  ];

  context.subscriptions.push(...disposableCommands);

  const config = vscode.workspace.getConfiguration('nuxt-intellisense');
  const showWelcomeMessage = config.get('showWelcomeMessage', true);

  if (showWelcomeMessage) {
    vscode.window.showInformationMessage(
      'Nuxt Intellisense is now active! Start working with in your Nuxt project.',
      'Show Documentation',
      'Don\'t Show Again'
    ).then(selection => {
      if (selection === 'Show Documentation') {
        vscode.commands.executeCommand('nuxt-intellisense.showDocumentation');
      } else if (selection === 'Don\'t Show Again') {
        config.update('showWelcomeMessage', false, true);
      }
    });
  }

  const currentVersion = vscode.extensions.getExtension('MeriteK.nuxt-intellisense')?.packageJSON.version;

  const previousVersion = context.globalState.get<string>('nuxt-intellisense-version');

  if (currentVersion && currentVersion !== previousVersion) {
    context.globalState.update('nuxt-intellisense-version', currentVersion);

    const changelogUri = vscode.Uri.joinPath(context.extensionUri, 'CHANGELOG.md');
    try {
      await vscode.commands.executeCommand('markdown.showPreview', changelogUri);
    } catch (error) {
      vscode.window.showWarningMessage('Failed to open changelog preview.');
    }
  }

  console.log('Extension "nuxt-intellisense" is now active!');
}

export function deactivate() {
  console.log('Extension "nuxt-intellisense" is now deactivated!');
}
