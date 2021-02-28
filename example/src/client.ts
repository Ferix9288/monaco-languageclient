/* --------------------------------------------------------------------------------------------
 * Copyright (c) 2018 TypeFox GmbH (http://www.typefox.io). All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import {listen} from '@codingame/monaco-jsonrpc';
import * as monaco from 'monaco-editor'
import {MessageConnection} from 'vscode-jsonrpc';
import {
    MonacoLanguageClient, CloseAction, ErrorAction,
    MonacoServices, createConnection, Configurations, WorkspaceConfiguration
} from 'monaco-languageclient';
import normalizeUrl = require('normalize-url');
// import {DidChangeConfigurationNotification} from "vscode-languageserver-protocol";
import {Event} from "vscode-languageclient"; //state
import {ConfigurationChangeEvent, EventEmitter} from "vscode";

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
monaco.editor.create(document.getElementById("container")!, {
    model: monaco.editor.createModel("-- comment", 'lua', monaco.Uri.parse("file:///Users/fli/fetch-lua/blank/blank.lua")),
    glyphMargin: true,
    lightbulb: {
        enabled: true
    }
});
// install Monaco language client services
MonacoServices.install(monaco, {rootUri: "file:///Users/fli/fetch-lua/blank"});

// create the web socket
// const url = createUrl('/sampleServer')
const url = createUrl('ws://localhost:3010/lua')
const webSocket = createWebSocket(url);

class WorkspaceConfigurations implements Configurations {
    protected configs: { [key: string]: any } = {}
    protected onChangeEmitter: EventEmitter<ConfigurationChangeEvent> = new EventEmitter<ConfigurationChangeEvent>()

    constructor(c: { [key: string]: any }) {
        this.configs = c
    }

    getConfiguration(section?: string, resource?: string): WorkspaceConfiguration {
        if (!section) {
            return new Configuration(this.configs)
        }

        return section in this.configs ? new Configuration(this.configs[section]) : new Configuration(this.configs)
    }

    readonly onDidChangeConfiguration: Event<ConfigurationChangeEvent> = this.onChangeEmitter.event
}

class Configuration implements WorkspaceConfiguration {
    [key: string]: any;

    protected config: { [key: string]: any } = {}

    constructor(c: { [key: string]: any }) {
        this.config = c
    }

    get(section: string, defaultValue?: any) {
        return section in this.config ? this.config[section] : defaultValue;
    }

    has(section: string) {
        return section in this.config
    }

    toJSON() {
        return JSON.stringify(this.config)
    }

}

// listen when the web socket is opened
const workspaceConfiguration: { [key: string]: any } = {
    files: {
        associations: {},
        exclude: {},
    },
    "editor.semanticHighlighting": {enabled: true},
    Lua: {
        runtime: {version: "Lua 5.1"},
        completion: {
            callSnippet: "Both",
            enable: true
        },
        workspace: {
            library: {
                "/Users/fli/fetch-lua/api": true,
            }
        },
    },
}

MonacoServices.get().workspace.configurations = new WorkspaceConfigurations(workspaceConfiguration)

listen({
    webSocket,
    onConnection: connection => {
        // create and start the language client
        const languageClient = createLanguageClient(connection);
        const disposable = languageClient.start();
        connection.onClose(() => disposable.dispose());
        // languageClient.onDidChangeState((e) => {
        //     if (e.newState === State.Running) {
        //         setTimeout(() => {
        //             console.log("send workspace configuration")
        //             languageClient.sendNotification(DidChangeConfigurationNotification.type,
        //                 {
        //                     settings: {
        //                         workspaceConfiguration
        //                     }
        //                 })
        //         }, 10 * 1000)
        //     }
        // })
    },
});

function createLanguageClient(connection: MessageConnection): MonacoLanguageClient {
    return new MonacoLanguageClient({
        name: "Sample Language Client",
        clientOptions: {
            // use a language id as a document selector
            // documentSelector: ['json'],
            documentSelector: ['lua'],
            // middleware: {
            //     workspace: {
            //         configuration: (params, token, configuration) => {
            //             return configuration(params, token)
            //         },
            //     },
            // },
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
