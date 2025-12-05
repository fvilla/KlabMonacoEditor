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
    getText(): string;

    setCursorPosition(offset: number): void;

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
    pendingCalls: Array<() => void>,
    savedVersionId: number,
    dirty: boolean,
    _wheelNormalizerInstalled?: boolean
  } = {
    editor: null,
    container: null,
    ready: false,
    showLineNumbers: true,
    pendingCalls: [],
    savedVersionId: 0,
    dirty: false,
    _wheelNormalizerInstalled: false
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

  /**
   * JavaFX WebView can emit WheelEvents with deltaMode=PAGE for a mouse wheel.
   * Monaco interprets that as page-wise scrolling. Normalize such events to
   * line-wise scrolling by intercepting and applying a custom scrollTop delta.
   */
  function installWheelNormalizer() {
    if (state._wheelNormalizerInstalled) return;
    const ed: any = (state as any).editor;
    if (!ed) return;
    const node: HTMLElement | null = (ed.getDomNode ? ed.getDomNode() : null) || state.container;
    if (!node) return;

    const handler = (ev: WheelEvent) => {
      try {
        // Allow Ctrl+Wheel zoom behavior to pass through
        if ((ev as any).ctrlKey) return;
        const dm = (ev as any).deltaMode;
        // 2 === DOM_DELTA_PAGE; intercept only that mode
        if (dm === 2) {
          ev.preventDefault();
          ev.stopPropagation();
          const sign = Math.sign((ev as any).deltaY || 0) || 0;
          if (sign === 0) return;
          // Use editor's line height if available
          let lineHeight = 18;
          try {
            const opt = (monaco as any).editor?.EditorOption?.lineHeight;
            if (opt != null && ed.getOption) {
              const v = ed.getOption(opt);
              if (typeof v === 'number' && v > 0) lineHeight = v;
            }
          } catch {}
          const linesPerTick = 3; // feel-free constant; adjust as needed
          const dy = sign * lineHeight * linesPerTick;
          const cur = ed.getScrollTop ? ed.getScrollTop() : 0;
          if (ed.setScrollTop) ed.setScrollTop(cur + dy);
        }
      } catch {}
    };

    try { node.addEventListener('wheel', handler, { passive: false }); } catch { try { node.addEventListener('wheel', handler as any, false); } catch {} }
    state._wheelNormalizerInstalled = true;
  }

  // @ts-ignore
    const api: MonacoBridgeApi = {
//    editor: null,
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
            // Normalize scroll feel; JavaFX WebView may report wheel with deltaMode=PAGE
            mouseWheelScrollSensitivity: 1,
            fastScrollSensitivity: 1,
            smoothScrolling: true,
          });
          // Expose editor directly (used by Java for certain hooks)
          try { (api as any).editor = state.editor; } catch {}

          (window as any).kim_setDiagnostics = function (markers: any[]) {
            console.log("[JS] kim_setDiagnostics called with markers:", markers);

            const editor = state.editor;
            if (!editor) {
              console.warn("[JS] kim_setDiagnostics: editor not ready");
              return;
            }

            const model = editor.getModel?.();
            if (!model) {
              console.warn("[JS] kim_setDiagnostics: no model");
              return;
            }

            monaco.editor.setModelMarkers(model, "kim-lsp", markers || []);
            console.log("[JS] markers applied");
          };

          const model = state.editor.getModel();
          if (model) {
            // Track dirty status based on model version
            state.savedVersionId = model.getAlternativeVersionId();
            state.dirty = false;
            try { (window as any).JavaBridge?.onDirtyChanged(false); } catch {}

            // Listen to content changes to update dirty flag
            model.onDidChangeContent(() => {
              const newVersion = model.getAlternativeVersionId();
              const isDirty = newVersion !== state.savedVersionId;
              if (isDirty !== state.dirty) {
                state.dirty = isDirty;
                try { (window as any).JavaBridge?.onDirtyChanged(isDirty); } catch {}
              }
            });
          }

          // send modifications to Java
          state.editor.onDidChangeModelContent(function (e) {
              if ((window as any).JavaBridge && typeof (window as any).JavaBridge?.onContentChanged === 'function') {
                  (window as any).JavaBridge?.onContentChanged(state.editor.getValue());
              }
          });

          // Install save keybinding (Ctrl/Cmd + S)
          try {
            state.editor.addCommand((monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS), () => {
              try {
                const currentModel = state.editor.getModel();
                const textNow = currentModel ? currentModel.getValue() : (state.editor.getValue ? state.editor.getValue() : '');
                (window as any).JavaBridge?.onSave(textNow);
                if (currentModel) {
                  state.savedVersionId = currentModel.getAlternativeVersionId();
                  if (state.dirty) {
                    state.dirty = false;
                    (window as any).JavaBridge?.onDirtyChanged(false);
                  }
                }
              } catch {}
            });
          } catch {}

          // Clipboard: Copy (Ctrl/Cmd + C)
          try {
            state.editor.addCommand((monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyC), () => {
              try {
                const model = state.editor.getModel?.();
                if (!model) return;
                const sels0 = state.editor.getSelections?.() || (state.editor.getSelection ? [state.editor.getSelection()] : []);
                const selections = (sels0 && sels0.length) ? sels0 : (state.editor.getSelection ? [state.editor.getSelection()] : []);
                if (!selections || !selections.length) return;
                const texts: string[] = [];
                for (const sel of selections) {
                  if (!sel) continue;
                  const isEmpty = (sel.startLineNumber === sel.endLineNumber) && (sel.startColumn === sel.endColumn);
                  if (isEmpty) {
                    const line = sel.startLineNumber;
                    let t = model.getLineContent ? (model.getLineContent(line) || '') : '';
                    // Match common editor behavior: copy entire line including newline when no selection
                    t = t + '\n';
                    texts.push(t);
                  } else {
                    const t = model.getValueInRange(sel) || '';
                    texts.push(t);
                  }
                }
                const clip = texts.join('\n');
                try { (window as any).JavaBridge?.setClipboardText?.(clip); } catch {}
              } catch {}
            });
          } catch {}

          // Clipboard: Cut (Ctrl/Cmd + X)
          try {
            state.editor.addCommand((monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyX), () => {
              try {
                const model = state.editor.getModel?.();
                if (!model) return;
                const sels0 = state.editor.getSelections?.() || (state.editor.getSelection ? [state.editor.getSelection()] : []);
                const selections = (sels0 && sels0.length) ? sels0 : (state.editor.getSelection ? [state.editor.getSelection()] : []);
                if (!selections || !selections.length) return;
                // Copy first
                const texts: string[] = [];
                const edits: any[] = [];
                for (const sel of selections) {
                  if (!sel) continue;
                  const isEmpty = (sel.startLineNumber === sel.endLineNumber) && (sel.startColumn === sel.endColumn);
                  if (isEmpty) {
                    const line = sel.startLineNumber;
                    const lineText = model.getLineContent ? (model.getLineContent(line) || '') : '';
                    texts.push(lineText + '\n');
                    const lineCount = model.getLineCount ? model.getLineCount() : 0;
                    if (line < lineCount) {
                      edits.push({ range: { startLineNumber: line, startColumn: 1, endLineNumber: line + 1, endColumn: 1 }, text: '', forceMoveMarkers: true });
                    } else {
                      const maxCol = model.getLineMaxColumn ? model.getLineMaxColumn(line) : 1;
                      edits.push({ range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: maxCol }, text: '', forceMoveMarkers: true });
                    }
                  } else {
                    const t = model.getValueInRange(sel) || '';
                    texts.push(t);
                    edits.push({ range: sel, text: '', forceMoveMarkers: true });
                  }
                }
                const clip = texts.join('\n');
                try { (window as any).JavaBridge?.setClipboardText?.(clip); } catch {}
                if (edits.length) {
                  try { state.editor.pushUndoStop && state.editor.pushUndoStop(); } catch {}
                  try { state.editor.executeEdits('java-bridge', edits); } catch {}
                  try { state.editor.pushUndoStop && state.editor.pushUndoStop(); } catch {}
                }
              } catch {}
            });
          } catch {}

          // Clipboard: Paste (Ctrl/Cmd + V)
          try {
            state.editor.addCommand((monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyV), () => {
              try {
                const model = state.editor.getModel?.();
                if (!model) return;
                let text: string = '';
                try { text = (window as any).JavaBridge?.getClipboardText?.() || ''; } catch {}
                if (text == null) text = '';
                const sels = state.editor.getSelections?.() || (state.editor.getSelection ? [state.editor.getSelection()] : []);
                if (!sels || !sels.length) return;
                const edits = sels.filter(Boolean).map((sel: any) => ({ range: sel, text, forceMoveMarkers: true }));
                if (edits.length) {
                  try { state.editor.executeEdits('java-bridge', edits); } catch {}
                }
              } catch {}
            });
          } catch {}

          // Fallback: Intercept keydown at Monaco level to ensure WebView doesn't swallow clipboard shortcuts
          try {
            const KC = monaco.KeyCode;
            const doCopy = () => {
              const model = state.editor.getModel?.();
              if (!model) return;
              const sels0 = state.editor.getSelections?.() || (state.editor.getSelection ? [state.editor.getSelection()] : []);
              const selections = (sels0 && sels0.length) ? sels0 : (state.editor.getSelection ? [state.editor.getSelection()] : []);
              if (!selections || !selections.length) return;
              const texts: string[] = [];
              for (const sel of selections) {
                if (!sel) continue;
                const isEmpty = (sel.startLineNumber === sel.endLineNumber) && (sel.startColumn === sel.endColumn);
                if (isEmpty) {
                  const line = sel.startLineNumber;
                  let t = model.getLineContent ? (model.getLineContent(line) || '') : '';
                  t = t + '\n';
                  texts.push(t);
                } else {
                  const t = model.getValueInRange(sel) || '';
                  texts.push(t);
                }
              }
              const clip = texts.join('\n');
              try { (window as any).JavaBridge?.setClipboardText?.(clip); } catch {}
            };
            const doCut = () => {
              const model = state.editor.getModel?.();
              if (!model) return;
              const sels0 = state.editor.getSelections?.() || (state.editor.getSelection ? [state.editor.getSelection()] : []);
              const selections = (sels0 && sels0.length) ? sels0 : (state.editor.getSelection ? [state.editor.getSelection()] : []);
              if (!selections || !selections.length) return;
              const texts: string[] = [];
              const edits: any[] = [];
              for (const sel of selections) {
                if (!sel) continue;
                const isEmpty = (sel.startLineNumber === sel.endLineNumber) && (sel.startColumn === sel.endColumn);
                if (isEmpty) {
                  const line = sel.startLineNumber;
                  const lineText = model.getLineContent ? (model.getLineContent(line) || '') : '';
                  texts.push(lineText + '\n');
                  const lineCount = model.getLineCount ? model.getLineCount() : 0;
                  if (line < lineCount) {
                    edits.push({ range: { startLineNumber: line, startColumn: 1, endLineNumber: line + 1, endColumn: 1 }, text: '', forceMoveMarkers: true });
                  } else {
                    const maxCol = model.getLineMaxColumn ? model.getLineMaxColumn(line) : 1;
                    edits.push({ range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: maxCol }, text: '', forceMoveMarkers: true });
                  }
                } else {
                  const t = model.getValueInRange(sel) || '';
                  texts.push(t);
                  edits.push({ range: sel, text: '', forceMoveMarkers: true });
                }
              }
              const clip = texts.join('\n');
              try { (window as any).JavaBridge?.setClipboardText?.(clip); } catch {}
              if (edits.length) {
                try { state.editor.pushUndoStop && state.editor.pushUndoStop(); } catch {}
                try { state.editor.executeEdits('java-bridge', edits); } catch {}
                try { state.editor.pushUndoStop && state.editor.pushUndoStop(); } catch {}
              }
            };
            const doPaste = () => {
              const model = state.editor.getModel?.();
              if (!model) return;
              let text: string = '';
              try { text = (window as any).JavaBridge?.getClipboardText?.() || ''; } catch {}
              if (text == null) text = '';
              const sels0 = state.editor.getSelections?.() || (state.editor.getSelection ? [state.editor.getSelection()] : []);
              const selections = (sels0 && sels0.length) ? sels0 : (state.editor.getSelection ? [state.editor.getSelection()] : []);
              if (!selections || !selections.length) return;
              const edits = selections.filter(Boolean).map((sel: any) => ({ range: sel, text, forceMoveMarkers: true }));
              if (edits.length) {
                try { state.editor.pushUndoStop && state.editor.pushUndoStop(); } catch {}
                try { state.editor.executeEdits('java-bridge', edits); } catch {}
                try { state.editor.pushUndoStop && state.editor.pushUndoStop(); } catch {}
              }
            };
            state.editor.onKeyDown((e: any) => {
              const isCtrl = !!(e.ctrlKey || e.metaKey);
              const isShift = !!e.shiftKey;
              const code = e.keyCode;
              const isCopy = (isCtrl && code === KC.KeyC) || (!isCtrl && !isShift && code === KC.F6 && false);
              const isCut = (isCtrl && code === KC.KeyX);
              const isPaste = (isCtrl && code === KC.KeyV) || (isShift && !isCtrl && code === KC.Insert);
              const isCtrlInsertCopy = (isCtrl && !isShift && code === KC.Insert);
              if (isCopy || isCtrlInsertCopy) {
                doCopy(); e.preventDefault(); e.stopPropagation(); return;
              }
              if (isCut) { doCut(); e.preventDefault(); e.stopPropagation(); return; }
              if (isPaste) { doPaste(); e.preventDefault(); e.stopPropagation(); return; }
            });
          } catch {}

          // Install wheel normalizer to convert PAGE-based wheel deltas into line-based scrolling
          try {
            installWheelNormalizer();
          } catch {}

        } else {
          state.editor.updateOptions({ theme });
          const model = state.editor.getModel();
          if (model) {
            monaco.editor.setModelLanguage(model, language);
            model.setValue(text || '');
            // Reset dirty baseline when programmatically initializing
            state.savedVersionId = model.getAlternativeVersionId();
            if (state.dirty) {
              state.dirty = false;
              try { (window as any).JavaBridge?.onDirtyChanged(false); } catch {}
            }
          }

          // Keep external reference updated
          try { (api as any).editor = state.editor; } catch {}

          // Ensure wheel normalizer is installed also when reusing the editor
          try { installWheelNormalizer(); } catch {}
        }
      });
    },

    setText(text: string) {
      ensureReady(() => {
        const model = state.editor?.getModel?.();
        if (model) {
          model.setValue(text || '');
          // After programmatic set, reset the saved baseline and mark not dirty
          try {
            state.savedVersionId = model.getAlternativeVersionId();
            if (state.dirty) {
              state.dirty = false;
              (window as any).JavaBridge?.onDirtyChanged(false);
            }
          } catch {}
        }
      });
    },

    getText(): string {
      try {
        const model = state.editor?.getModel?.();
        if (model) return model.getValue() || '';
        // fallback
        return state.editor?.getValue ? (state.editor.getValue() || '') : '';
      } catch {
        return '';
      }
    },

    setCursorPosition(offset: number) {
      ensureReady(() => {
        const model = state.editor?.getModel?.();
        if (!model) return;
        const pos = model.getPositionAt(Math.max(0, Math.floor(offset || 0)));
        try { state.editor.setPosition(pos); } catch {}
        try { state.editor.revealPositionInCenter(pos); } catch {}
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
