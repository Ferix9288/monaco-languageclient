/* --------------------------------------------------------------------------------------------
 * Copyright (c) 2018 TypeFox GmbH (http://www.typefox.io). All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import {listen} from '@codingame/monaco-jsonrpc';
import * as monaco from 'monaco-editor'
import {MessageConnection} from 'vscode-jsonrpc';
import {
    MonacoLanguageClient,
    CloseAction,
    ErrorAction,
    MonacoServices,
    createConnection,
    Configurations,
    WorkspaceConfiguration,
    MonacoProvideCompletionItemsSignature,
    TextDocumentDidChangeEvent,
} from 'monaco-languageclient';
import normalizeUrl = require('normalize-url');
import {Event} from "vscode-languageclient";
import {
    ConfigurationChangeEvent,
    EventEmitter,
} from "vscode";
import {editor, IRange} from "monaco-editor";
import IModel = editor.IModel;
import {Emitter} from "monaco-languageclient/lib/services";
import {setInterval} from "timers";
import {TextDocument} from "vscode-languageserver-textdocument";
import ITextModel = editor.ITextModel;

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
    model: monaco.editor.createModel("-- comment", 'lua', monaco.Uri.parse("inmemory://blank.lua")), //monaco.Uri.parse("file:///Users/fli/fetch-lua/blank/blank.lua")),
    glyphMargin: true,
    lightbulb: {
        enabled: true
    }
});
// install Monaco language client services
MonacoServices.install(monaco, {rootUri: "file:///Users/fli/fetch-lua/blank"});

// create the web socket
// const url = createUrl('/sampleServer')
// const url = createUrl('ws://localhost:3010/lua')
const url = createUrl('ws://5bc8a4e58bd1.ngrok.io/lua')
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
MonacoServices.get().languages.middleware = {
    provideCompletionItemsProxy: (model: monaco.editor.ITextModel, position: monaco.Position, context: monaco.languages.CompletionContext, token: monaco.CancellationToken, next: MonacoProvideCompletionItemsSignature): monaco.languages.ProviderResult<monaco.languages.CompletionList> => {
        if (!model) {
            return undefined
        }
        var potentialTriggerWord = model.getLineContent(position.lineNumber)
        var matchIdx = potentialTriggerWord.indexOf("FETCH_POSE")
        if (matchIdx < 0) {
            return next(model, position, context, token)
        }
        // TODO: fix why this doesn't show when in paren
        // Also, need to figure out how to correctly merge
        var word = model.getWordUntilPosition(position);
        var range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: matchIdx,
            endColumn: word.endColumn
        };

        const fromNextResult = next(model, position, context, token)
        if (fromNextResult && "suggestions" in fromNextResult) {
            return {
                ...fromNextResult,
                suggestions: {...poseProposals(range), ...fromNextResult.suggestions}
            };
        } else return {
            suggestions: poseProposals(range)
        }
    },
}

class EditorToServerSyncer {

    protected intervalThread: NodeJS.Timeout | undefined
    private uri: string
    private model: ITextModel | undefined
    private readonly syncFrequencyMS: number
    private readonly idleTimeTriggerMS: number
    private lastUpdated: number

    constructor(protected documentChangeEmitter: Emitter<TextDocumentDidChangeEvent>,
                uri?: string,
                model?: ITextModel,
                syncFrequencyMS?: number,
                idleTimeTriggerMS?: number,
    ) {
        this.model = model ? model : undefined
        this.uri = uri ? uri : ""
        this.syncFrequencyMS = syncFrequencyMS ? syncFrequencyMS : 5000
        this.idleTimeTriggerMS = idleTimeTriggerMS ? idleTimeTriggerMS : 3000
        this.lastUpdated = Date.now()
    }

    syncLatestChange(uri: string, m: IModel) {
        this.uri = uri
        this.model = m
        this.lastUpdated = Date.now()
    }

    start() {
        this.intervalThread = setInterval(() => {
            if (!this.model) return
            if (Date.now() - this.lastUpdated >= this.idleTimeTriggerMS) {
                const textDocument = this.createTextDocument()
                if (textDocument) {
                    console.log("firing / refreshing:", textDocument)
                    const fullRange = this.model.getFullModelRange()
                    const fullText = this.model.getValue()
                    const contentChanges = [{
                        range: {
                            start: {
                                line: fullRange.startLineNumber,
                                character: fullRange.startColumn,
                            },
                            end: {
                                line: fullRange.endLineNumber,
                                character: fullRange.endColumn,
                            }
                        },
                        text: fullText,
                    }]
                    this.documentChangeEmitter.fire({textDocument, contentChanges})
                }
            }
        }, this.syncFrequencyMS)
    }

    stop() {
        if (this.intervalThread) clearInterval(this.intervalThread)
    }

    private createTextDocument(): TextDocument | undefined {
        if (!this.model) return undefined
        return TextDocument.create(this.uri, this.model.getModeId(), this.model.getVersionId(), this.model.getValue())
    }
}

const wsEmitters = MonacoServices.get().workspace.getEmitters()
const syncer = new EditorToServerSyncer(wsEmitters.onDidChangeTextDocumentEmitter)
MonacoServices.get().workspace.middleware = {
    onDidChangeContentProxy: (uri, model, event, next) => {
        syncer.syncLatestChange(uri, model)
        next(uri, model, event)
    }
}
syncer.start()

listen({
    webSocket,
    onConnection: connection => {
        // create and start the language client
        const languageClient = createLanguageClient(connection);
        const disposable = languageClient.start();
        connection.onClose(() => disposable.dispose());
    },
});

function createLanguageClient(connection: MessageConnection): MonacoLanguageClient {
    return new MonacoLanguageClient({
        name: "Sample Language Client",
        clientOptions: {
            // use a language id as a document selector
            // documentSelector: ['json'],
            documentSelector: ['lua'],
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

function poseProposals(range: IRange): monaco.languages.CompletionItem[] {
    return [
        {
            label: 'Position 1',
            kind: monaco.languages.CompletionItemKind.Value,
            documentation: "Inserts this pose's UUID.",
            insertText: "3b12b5ba-026d-4983-9087-bfa4125c5afd",
            range: range,
            filterText: 'FETCH_POSE Position 1',
        },
        {
            label: 'Position 2',
            kind: monaco.languages.CompletionItemKind.Value,
            documentation: "Inserts this pose's UUID.",
            insertText: "3b12b5ba-026d-4983-9087-bfa4125c5afd",
            range: range,
            filterText: 'FETCH_POSE Position 2',
        },
    ]
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
