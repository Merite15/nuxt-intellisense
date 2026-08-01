import * as vscode from 'vscode';
import { NuxtIntellisense } from './providers/NuxtIntellisense';

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

  const disposableCommands = [
    vscode.commands.registerCommand('nuxt-intellisense.refreshCodeLens', () => {
      vscode.commands.executeCommand('editor.action.triggerParameterHints');
    }),

    vscode.commands.registerCommand('nuxt-intellisense.showDocumentation', () => {
      vscode.Uri.parse('https://github.com/Merite15/Nuxt-Intellisense#readme')
    })
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
