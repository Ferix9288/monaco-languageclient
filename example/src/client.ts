/* --------------------------------------------------------------------------------------------
 * Copyright (c) 2018 TypeFox GmbH (http://www.typefox.io). All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import {listen} from '@codingame/monaco-jsonrpc';
import * as monaco from 'monaco-editor'
import {MessageConnection} from 'vscode-jsonrpc';
import {
    MonacoLanguageClient, CloseAction, ErrorAction,
    MonacoServices, createConnection
} from 'monaco-languageclient';
import normalizeUrl = require('normalize-url');
// import {DidChangeConfigurationNotification} from "vscode-languageserver-protocol";

const ReconnectingWebSocket = require('reconnecting-websocket');

// register Monaco languages
// monaco.languages.register({
//     id: 'json',
//     extensions: ['.json', '.bowerrc', '.jshintrc', '.jscsrc', '.eslintrc', '.babelrc'],
//     aliases: ['JSON', 'json'],
//     mimetypes: ['application/json'],
// });

monaco.languages.register({
    id: 'lua',
    extensions: ['.lua'],
    aliases: ['LUA', 'lua'],
});

// create Monaco editor
// const value = `{
//     "$schema": "http://json.schemastore.org/coffeelint",
//     "line_endings": "unix"
// }`;
const editor = monaco.editor.create(document.getElementById("container")!, {
    model: monaco.editor.createModel("-- comment", 'lua', monaco.Uri.parse("file:///Users/fli/fetch-lua/blank/blank.lua")),
    glyphMargin: true,
    lightbulb: {
        enabled: true
    }
});
console.log(editor)
// install Monaco language client services
MonacoServices.install(monaco, {rootUri: "file:///Users/fli/fetch-lua/blank"});

// create the web socket
// const url = createUrl('/sampleServer')
const url = createUrl('ws://localhost:3010/lua')
const webSocket = createWebSocket(url);
// listen when the web socket is opened
listen({
    webSocket,
    onConnection: connection => {
        // create and start the language client
        const languageClient = createLanguageClient(connection);
        const disposable = languageClient.start();
        // languageClient.sendNotification(DidChangeConfigurationNotification.type,
        //     {
        //         settings: {
        //             Lua: {
        //                 runtime: {version: "Lua 5.1"},
        //                 completion: {
        //                     callSnippet: "Both",
        //                     enable: true
        //                 },
        //                 workspace: {
        //                     library: {
        //                         "file:///Users/fli/fetch-lua/api": true,
        //                     }
        //                 },
        //             }
        //         }
        //     }
        // )
        connection.onClose(() => disposable.dispose());
    }
});

function createLanguageClient(connection: MessageConnection): MonacoLanguageClient {
    return new MonacoLanguageClient({
        name: "Sample Language Client",
        clientOptions: {
            // use a language id as a document selector
            // documentSelector: ['json'],
            documentSelector: ['lua'],
            middleware: {
                workspace: {
                    configuration: (params, token, configuration) => {
                        return [{
                            Lua: {
                                runtime: {version: "Lua 5.1"},
                                completion: {
                                    callSnippet: "Both",
                                    enable: true
                                },
                                workspace: {
                                    library: {
                                        "file:///Users/fli/fetch-lua/api": true,
                                    }
                                },
                            }
                        }];
                    },
                },
            },
            // disable the default error handler
            errorHandler: {
                error: () => ErrorAction.Continue,
                closed: () => CloseAction.DoNotRestart
            }
        },
        // create a language client connection from the JSON RPC connection on demand
        connectionProvider: {
            get: (errorHandler, closeHandler) => {
                return Promise.resolve(createConnection(connection, errorHandler, closeHandler))
            }
        }
    });
}

function createUrl(url: string): string {
    return normalizeUrl(url);
}

// function createUrl(path: string): string {
//     const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
//     return normalizeUrl(`${protocol}://${location.host}${location.pathname}${path}`);
// }

function createWebSocket(url: string): WebSocket {
    const socketOptions = {
        maxReconnectionDelay: 10000,
        minReconnectionDelay: 1000,
        reconnectionDelayGrowFactor: 1.3,
        connectionTimeout: 10000,
        maxRetries: Infinity,
        debug: false
    };
    return new ReconnectingWebSocket(url, [], socketOptions);
}
