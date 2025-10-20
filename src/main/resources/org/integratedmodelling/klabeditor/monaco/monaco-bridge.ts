// Typescript bridge for Monaco editor embedded in JavaFX WebView
// This file is accompanied by a compiled JS version: monaco-bridge.js
// The Java side exposes window.JavaBridge (see MonacoEditorView). We expose window.MonacoBridge
// which Java calls to control the editor.

// IMPORTANT on LSP integration
// ----------------------------
// A working LSP hookup in Monaco needs the JSON-RPC plumbing provided by
//  - vscode-ws-jsonrpc
//  - monaco-languageclient
// as explained in: https://github.com/Barahlush/monaco-lsp-guide
// Merely opening a WebSocket is not enough; you must create a MessageConnection
// and a MonacoLanguageClient, then call client.start() and listenUntilClosed.
//
// To enable LSP here, bundle the UMD builds (or webpack-bundle) of these libraries
// alongside this file and reference them from index.html BEFORE calling connectLsp.
// Example (pseudo, not included here by default):
//   <script src="lib/vscode-ws-jsonrpc.js"></script>
//   <script src="lib/monaco-languageclient.js"></script>
// Then implement the commented section in connectLsp(..) below.

// Minimal ambient declarations for global AMD monaco
declare const monaco: any;

interface MarkerOptions {
    message: string;
    severity?: 'info' | 'warning' | 'error' | 'hint';
}

interface MonacoBridgeApi {
    init(text: string, language?: string, theme?: string): void;

    setText(text: string): void;

    setLineNumbers(show: boolean): void;

    isLineNumbersVisible(): boolean;

    createMarker(line: number, message: string, severity?: 'info' | 'warning' | 'error' | 'hint'): void;

    createMarkerByOffset(offset: number, length: number, message: string, severity?: 'info' | 'warning' | 'error' | 'hint'): void;

    connectLsp(wsUrl: string, languageId?: string): Promise<boolean>;
  _onAmdReady(container: HTMLElement): void; // internal, called from index.html after AMD loads
}

(function () {
  const state: {
    editor: any | null,
    container: HTMLElement | null,
    ready: boolean,
    showLineNumbers: boolean,
    pendingCalls: Array<() => void>
  } = {
    editor: null,
    container: null,
    ready: false,
    showLineNumbers: true,
    pendingCalls: []
  };

  function flush() {
    while (state.pendingCalls.length) {
      try { (state.pendingCalls.shift()!)(); } catch (e) { console.error(e); }
    }
  }

  function ensureReady(f: () => void) {
    if (state.ready) f(); else state.pendingCalls.push(f);
  }

  function toSeverity(s?: string) {
    const m = (s || 'info').toLowerCase();
    switch (m) {
      case 'error': return monaco.MarkerSeverity.Error;
      case 'warning': return monaco.MarkerSeverity.Warning;
      case 'hint': return monaco.MarkerSeverity.Hint;
      case 'info':
      default: return monaco.MarkerSeverity.Info;
    }
  }

  const api: MonacoBridgeApi = {
    _onAmdReady(container: HTMLElement) {
      state.container = container;
      // Do nothing else here; init() will create the editor. Mark as soft-ready so queued init runs.
      state.ready = true;
      flush();
      // Notify Java if present
      try { (window as any).JavaBridge?.onEditorReady(); } catch {}
    },

    init(text: string, language = 'plaintext', theme = 'vs-dark') {
      ensureReady(() => {
        if (!state.container) {
          console.error('Monaco container not available');
          return;
        }
        if (!state.editor) {
          state.editor = monaco.editor.create(state.container, {
            value: text || '',
            language: language || 'plaintext',
            theme: theme || 'vs-dark',
            automaticLayout: true,
            lineNumbers: state.showLineNumbers ? 'on' : 'off',
          });
        } else {
          state.editor.updateOptions({ theme });
          const model = state.editor.getModel();
          if (model) {
            monaco.editor.setModelLanguage(model, language);
            model.setValue(text || '');
          }
        }
      });
    },

    setText(text: string) {
      ensureReady(() => {
        const model = state.editor?.getModel?.();
        if (model) model.setValue(text || '');
      });
    },

    setLineNumbers(show: boolean) {
      state.showLineNumbers = !!show;
      ensureReady(() => {
        if (state.editor) {
          state.editor.updateOptions({ lineNumbers: state.showLineNumbers ? 'on' : 'off' });
        }
      });
    },

    isLineNumbersVisible(): boolean {
      return !!state.showLineNumbers;
    },

    createMarker(line: number, message: string, severity: 'info'|'warning'|'error'|'hint' = 'info') {
      ensureReady(() => {
        const model = state.editor?.getModel?.();
        if (!model) return;
        const owner = 'java-bridge';
        const markers = [{
          startLineNumber: Math.max(1, Math.floor(line || 1)),
          endLineNumber: Math.max(1, Math.floor(line || 1)),
          startColumn: 1,
          endColumn: 1,
          message: message || '',
          severity: toSeverity(severity)
        }];
        monaco.editor.setModelMarkers(model, owner, markers);
      });
    },

      createMarkerByOffset(offset: number, length: number, message: string, severity: 'info' | 'warning' | 'error' | 'hint' = 'info') {
          ensureReady(() => {
              const model = state.editor?.getModel?.();
              if (!model) return;
              const owner = 'java-bridge';
              const startPosition = model.getPositionAt(offset);
              const endPosition = model.getPositionAt(offset + length);
              const markers = [{
                  startLineNumber: startPosition.lineNumber,
                  endLineNumber: endPosition.lineNumber,
                  startColumn: startPosition.column,
                  endColumn: endPosition.column,
                  message: message || '',
                  severity: toSeverity(severity)
              }];
              monaco.editor.setModelMarkers(model, owner, markers);
          });
      },

      async connectLsp(wsUrl: string, languageId?: string): Promise<boolean> {
      // See https://github.com/Barahlush/monaco-lsp-guide for a complete wiring.
      // The high-level steps are:
      // 1) Create a WebSocket to the LSP server (e.g., ws://localhost:PORT/your-lang)
      // 2) Wrap it with a MessageReader/MessageWriter from vscode-ws-jsonrpc
      // 3) Create and configure a MonacoLanguageClient with services and languageId
      // 4) Start the client and establish the connection
      // This stub returns false unless the necessary libraries are present globally.
      try {
        const g: any = window as any;
        if (!g.monaco || !state.editor) { console.warn('Monaco or editor not ready'); return false; }
        if (!g.monaco_languageclient || !g.monaco_languageclient.MonacoLanguageClient) {
          console.warn('[LSP] monaco-languageclient not found on window. Please bundle and load it.');
          return false;
        }
        if (!g.reconnecting_websocket && !g.WebSocket) {
          console.warn('[LSP] WebSocket not available');
          return false;
        }
        // Example skeleton (commented out):
        // const url = wsUrl;
        // const socket = new WebSocket(url, 'jsonrpc');
        // const reader = new g.VSCodeWebSocketMessageReader(socket);
        // const writer = new g.VSCodeWebSocketMessageWriter(socket);
        // const connection = g.createMessageConnection(reader, writer);
        // const client = new g.monaco_languageclient.MonacoLanguageClient({
        //   name: 'LSP',
        //   clientOptions: { documentSelector: [languageId || 'plaintext'],
        //     workspaceFolder: { uri: window.location.href, name: 'root', index: 0 } },
        //   connectionProvider: { get: () => Promise.resolve({ reader, writer }) }
        // });
        // client.start();
        // reader.onClose(() => client.stop());
        console.warn('[LSP] connectLsp stub invoked; see monaco-bridge.ts comments to enable real client.');
        return false;
      } catch (e) {
        console.error('[LSP] Failed to connect:', e);
        return false;
      }
    }
  };

  (window as any).MonacoBridge = api;
})();
