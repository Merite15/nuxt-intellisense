/**
 * Bootstrap Mocha : redirige `require('vscode')` vers notre mock (out/test/mocks/vscode.js)
 * avant que les services de l'extension ne soient chargés. Permet de tester la logique
 * réelle des services sans lancer un Extension Host VS Code.
 */
const path = require('path');
const Module = require('module');

const mockPath = path.join(__dirname, '..', '..', 'out', 'test', 'mocks', 'vscode.js');

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
    if (request === 'vscode') {
        return mockPath;
    }
    return originalResolveFilename.call(this, request, ...args);
};
