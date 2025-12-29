// Typescript bridge for Monaco editor embedded in JavaFX WebView
// This file is accompanied by a compiled JS version: monaco-bridge.js
// The Java side exposes window.JavaBridge (see MonacoEditorView). We expose window.MonacoBridge
// which Java calls to control the editor.
// Typescript bridge for Monaco editor embedded in JavaFX WebView
declare const monaco: any;

interface MonacoOpenDoc {
  uri: string;
  text: string;
  language?: string;
  theme?: string;
}

interface MonacoBridgeApi {
  // New preferred API
  openDocument(doc: MonacoOpenDoc): void;

  // Backwards compatible (optional) - you can remove later
  init(text: string, language?: string, theme?: string): void;

  setText(text: string): void;
  getText(): string;

  setCursorPosition(offset: number): void;

  setLineNumbers(show: boolean): void;
  isLineNumbersVisible(): boolean;

  // Diagnostics API (replaces window.kim_setDiagnostics)
  setDiagnostics(markers: any[]): void;
  clearDiagnostics(): void;

  createMarker(line: number, message: string, severity?: 'info' | 'warning' | 'error' | 'hint'): void;
  createMarkerByOffset(offset: number, length: number, message: string, severity?: 'info' | 'warning' | 'error' | 'hint'): void;

  connectLsp(wsUrl: string, languageId?: string): Promise<boolean>; // unused in klab-ide integration
  _onAmdReady(container: HTMLElement): void;
}

function logError(context: string, e: any) {
  try {
    console.error(`[MonacoBridge] ${context}`, e);
  } catch {}
}

function logWarn(msg: string) {
  try {
    console.warn(`[MonacoBridge] ${msg}`);
  } catch {}
}

function logInfo(msg: string) {
  try {
    console.log(`[MonacoBridge] ${msg}`);
  } catch {}
}

function isCopyCutPaste(e: any) {
  const isCtrl = !!(e.ctrlKey || e.metaKey);
  if (!isCtrl) return null;

  switch (e.keyCode) {
    case monaco.KeyCode.KeyC: return "copy";
    case monaco.KeyCode.KeyX: return "cut";
    case monaco.KeyCode.KeyV: return "paste";
    default: return null;
  }
}



(function () {
  const OWNER_DIAGNOSTICS = "kim-lsp";

  const state: {
    editor: any | null,
    container: HTMLElement | null,
    ready: boolean,
    showLineNumbers: boolean,
    pendingCalls: Array<() => void>,
    savedVersionId: number,
    dirty: boolean,
    _contentDisposable?: any,
    _wheelNormalizerInstalled?: boolean,
    _currentUri?: any | null
  } = {
    editor: null,
    container: null,
    ready: false,
    showLineNumbers: true,
    pendingCalls: [],
    savedVersionId: 0,
    dirty: false,
    _contentDisposable: null as any,
    _wheelNormalizerInstalled: false,
    _currentUri: null
  };

  function flush() {
    while (state.pendingCalls.length) {
      try { (state.pendingCalls.shift()!)(); } catch (e) { console.error(e); }
    }
  }

  function ensureReady(f: () => void) {
    if (state.ready) f(); else state.pendingCalls.push(f);
  }

  function attachContentChanged(model: any) {
    try {
      if (state._contentDisposable?.dispose) {
        state._contentDisposable.dispose();
      }
    } catch {}

    try {
      state._contentDisposable = model.onDidChangeContent(() => {
        try {
          const val = model.getValue?.() || '';
          (window as any).JavaBridge?.onContentChanged?.(val);
        } catch (e) {
          console.error("[MonacoBridge] onContentChanged failed", e);
        }
      });
      logInfo("Bound onContentChanged to active model");
    } catch (e) {
      logError("Failed binding onDidChangeContent", e);
    }
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

  function registerKimLanguage() {
    // Avoid double-registration
    try {
      const existing = (monaco as any).languages.getLanguages()
        .some((l: any) => l.id === 'org.integratedmodelling.languages.Kim');
      if (existing) return;
    } catch (e) {
      console.warn('Unable to inspect languages, registering kim anyway:', e);
    }

    monaco.languages.register({
      id: 'org.integratedmodelling.languages.Kim',
      aliases: ['k.IM', 'kim'],
      extensions: ['.kim']
    });

    monaco.languages.setMonarchTokensProvider('org.integratedmodelling.languages.Kim', {
      defaultToken: '',
      tokenPostfix: '.kim',
      keywords: ['model', 'define', 'import', 'observing', 'using', 'as', 'private', 'namespace', 'when', 'where', 'with', 'from'],
      operators: ['=', '>', '<', '==', '!=', '>=', '<=', '&&', '||', '+', '-', '*', '/', '!'],
      symbols: /[=><!~?:&|+\-*\/\^%]+/,
      tokenizer: {
        root: [
          // [/(?s)/\\*[^*]*\\*+(?:[^/*][^*]*\\*+)*\\*/, 'comment'],
          // [/\/\*.*\*\//, 'comment'],
          [/\/\/.*$/, 'comment'],
          [/"([^"\\]|\\.)*"/, 'string'],
          [/'([^'\\]|\\.)*'/, 'string'],
          [/\d+(\.\d+)?/, 'number'],
          [/@\s*[a-zA-Z_\$][\w\$]*/, 'annotation'],
          [/[a-zA-Z_][\w]*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
          [/@symbols/, { cases: { '@operators': 'operator', '@default': '' } }],
          [/[{}()[\]]/, '@brackets'],
          [/[;,]/, 'delimiter']
        ]
      }
    });

    monaco.languages.setLanguageConfiguration('org.integratedmodelling.languages.Kim', {
      comments: { lineComment: '//', blockComment: ['/*', '*/'] },
      brackets: [['{', '}'], ['[', ']'], ['(', ')'], ['{{', '}}']],
      autoClosingPairs: [
        { open: '{{', close: '}}' },
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
        { open: '\'', close: '\'' }
      ],
      surroundingPairs: [
        { open: '{{', close: '}}' },
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
        { open: '\'', close: '\'' }
      ]
    });
  }

  /// Worldview language registration


  function registerWorldviewLanguage() {
    // Avoid double-registration
    try {
      const existing = (monaco as any).languages.getLanguages()
          .some((l: any) => l.id === 'org.integratedmodelling.languages.Worldview');
      if (existing) return;
    } catch (e) {
      console.warn('Unable to inspect languages, registering kwv anyway:', e);
    }

    monaco.languages.register({
      id: 'org.integratedmodelling.languages.Worldview',
      aliases: ['k.Worldview', 'kwv'],
      extensions: ['.kwv']
    });

    monaco.languages.setMonarchTokensProvider('org.integratedmodelling.languages.Worldview', {
      defaultToken: '',
      tokenPostfix: '.kwv',
      keywords: ['abstract', 'thing', 'identity', 'attribute', 'as', 'when', 'where', 'with', 'from'],
      operators: ['=', '>', '<', '==', '!=', '>=', '<=', '&&', '||', '+', '-', '*', '/', '!'],
      symbols: /[=><!~?:&|+\-*\/\^%]+/,
      tokenizer: {
        root: [
          // [/#.*$/, 'comment'],
          [/\/\/.*$/, 'comment'],
          [/"([^"\\]|\\.)*"/, 'string'],
          [/'([^'\\]|\\.)*'/, 'string'],
          [/\d+(\.\d+)?/, 'number'],
          [/[a-zA-Z_][\w]*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
          [/@symbols/, { cases: { '@operators': 'operator', '@default': '' } }],
          [/[{}()[\]]/, '@brackets'],
          [/[;,]/, 'delimiter']
        ]
      }
    });

    monaco.languages.setLanguageConfiguration('org.integratedmodelling.languages.Worldview', {
      comments: { lineComment: '#' },
      brackets: [['{', '}'], ['[', ']'], ['(', ')']],
      autoClosingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
        { open: '\'', close: '\'' }
      ],
      surroundingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
        { open: '\'', close: '\'' }
      ]
    });
  }
  ///

  // This never worked
  // function installWheelNormalizer() {
  //   if (state._wheelNormalizerInstalled) return;
  //   const ed: any = state.editor;
  //   if (!ed) return;
  //   const node: HTMLElement | null = (ed.getDomNode ? ed.getDomNode() : null) || state.container;
  //   if (!node) return;
  //
  //   const handler = (ev: WheelEvent) => {
  //     try {
  //       if ((ev as any).ctrlKey) return; // keep zoom behavior
  //       const dm = (ev as any).deltaMode;
  //       if (dm === 2) { // DOM_DELTA_PAGE
  //         ev.preventDefault();
  //         ev.stopPropagation();
  //         const sign = Math.sign((ev as any).deltaY || 0) || 0;
  //         if (sign === 0) return;
  //
  //         let lineHeight = 18;
  //         try {
  //           const opt = (monaco as any).editor?.EditorOption?.lineHeight;
  //           if (opt != null && ed.getOption) {
  //             const v = ed.getOption(opt);
  //             if (typeof v === 'number' && v > 0) lineHeight = v;
  //           }
  //         } catch { }
  //
  //         const linesPerTick = 3;
  //         const dy = sign * lineHeight * linesPerTick;
  //         const cur = ed.getScrollTop ? ed.getScrollTop() : 0;
  //         if (ed.setScrollTop) ed.setScrollTop(cur + dy);
  //       }
  //     } catch { }
  //   };
  //
  //   try { node.addEventListener('wheel', handler, { passive: false }); }
  //   catch { try { node.addEventListener('wheel', handler as any, false); } catch { } }
  //
  //   state._wheelNormalizerInstalled = true;
  // }

  function ensureEditorCreated(theme: string, language: string) {
    if (!state.container) {
      console.error('Monaco container not available');
      return;
    }
    if (state.editor) return;

    state.editor = monaco.editor.create(state.container, {
      value: '',
      language: language || 'plaintext',
      theme: theme || 'vs-dark',
      automaticLayout: true,
      lineNumbers: state.showLineNumbers ? 'on' : 'off',
      mouseWheelScrollSensitivity: 1,
      fastScrollSensitivity: 1,
      smoothScrolling: true,
    });

    // Keep external reference (some Java code may still use it)
    try { (api as any).editor = state.editor; } catch { }

    // Cursor -> Java (if Java wants it)
    try {
      state.editor.onDidChangeCursorPosition((e: any) => {
        try {
          const model = state.editor.getModel?.();
          if (!model) return;
          const offset = model.getOffsetAt(e.position);
          (window as any).JavaBridge?.onCursorPositionChanged?.(offset);
        } catch { }
      });
    } catch { }

    // Content changes -> Java
//     try {
//       state.editor.onDidChangeModelContent(() => {
//         try {
//           const val = state.editor.getValue ? state.editor.getValue() : (state.editor.getModel?.()?.getValue?.() || '');
//           (window as any).JavaBridge?.onContentChanged?.(val);
//         } catch { }
//       });
//     } catch { }

    // Save keybinding
    try {
      state.editor.addCommand((monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS), () => {
        try {
          const model = state.editor.getModel?.();
          const textNow = model ? (model.getValue?.() || '') : (state.editor.getValue?.() || '');
          (window as any).JavaBridge?.onSave?.(textNow);

          if (model) {
            state.savedVersionId = model.getAlternativeVersionId();
            if (state.dirty) {
              state.dirty = false;
              (window as any).JavaBridge?.onDirtyChanged?.(false);
            }
          }
        } catch (e) {
          logError("Copy command failed", e);
        }
      });
    } catch (e) {
      logError("Failed to register Copy command", e);
    }

    // Copy
    try {
      state.editor.addCommand((monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyC), () => {
        try {
          const model = state.editor.getModel?.();
          if (!model) return;
          const sels = state.editor.getSelections?.() || (state.editor.getSelection ? [state.editor.getSelection()] : []);
          if (!sels || !sels.length) return;

          const texts: string[] = [];
          for (const sel of sels) {
            if (!sel) continue;
            const isEmpty = (sel.startLineNumber === sel.endLineNumber) && (sel.startColumn === sel.endColumn);
            if (isEmpty) {
              const line = sel.startLineNumber;
              let t = model.getLineContent ? (model.getLineContent(line) || '') : '';
              t = t + '\n';
              texts.push(t);
            } else {
              texts.push(model.getValueInRange(sel) || '');
            }
          }
          (window as any).JavaBridge?.setClipboardText?.(texts.join('\n'));
        } catch { }
      });
    } catch { }

    // Cut
    try {
      state.editor.addCommand((monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyX), () => {
        try {
          const model = state.editor.getModel?.();
          if (!model) return;
          const sels = state.editor.getSelections?.() || (state.editor.getSelection ? [state.editor.getSelection()] : []);
          if (!sels || !sels.length) return;

          const texts: string[] = [];
          const edits: any[] = [];
          for (const sel of sels) {
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
              texts.push(model.getValueInRange(sel) || '');
              edits.push({ range: sel, text: '', forceMoveMarkers: true });
            }
          }
          (window as any).JavaBridge?.setClipboardText?.(texts.join('\n'));
          if (edits.length) {
            try { state.editor.pushUndoStop?.(); } catch { }
            try { state.editor.executeEdits?.('java-bridge', edits); } catch { }
            try { state.editor.pushUndoStop?.(); } catch { }
          }
        } catch { }
      });
    } catch { }

    // Paste
    try {
      state.editor.addCommand((monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyV), () => {
        try {
          const model = state.editor.getModel?.();
          if (!model) return;
          let text: string = '';
          try { text = (window as any).JavaBridge?.getClipboardText?.() || ''; } catch { text = ''; }
          const sels = state.editor.getSelections?.() || (state.editor.getSelection ? [state.editor.getSelection()] : []);
          if (!sels || !sels.length) return;
          const edits = sels.filter(Boolean).map((sel: any) => ({ range: sel, text, forceMoveMarkers: true }));
          if (edits.length) state.editor.executeEdits?.('java-bridge', edits);
        } catch { }
      });
    } catch { }

    // Fallback
    try {
      state.editor.onKeyDown((e: any) => {
        try {
          const action = isCopyCutPaste(e);
          if (!action) return;

          const model = state.editor.getModel?.();
          if (!model) return;

          if (action === "copy") {
            doCopy(model);
          } else if (action === "cut") {
            doCut(model);
          } else if (action === "paste") {
            doPaste(model);
          }

          e.preventDefault();
          e.stopPropagation();
        } catch (err) {
          console.error("[MonacoBridge] keydown clipboard failed", err);
        }
      });
    } catch (e) {
      console.error("[MonacoBridge] Failed to install keydown handler", e);
    }

    function doCopy(model: any) {
      const sels = state.editor.getSelections?.() || [];
      if (!sels.length) return;

      const texts: string[] = [];
      for (const sel of sels) {
        if (!sel) continue;
        const empty = sel.startLineNumber === sel.endLineNumber &&
                      sel.startColumn === sel.endColumn;
        if (empty) {
          const line = sel.startLineNumber;
          texts.push((model.getLineContent(line) || "") + "\n");
        } else {
          texts.push(model.getValueInRange(sel) || "");
        }
      }
      console.log("[MonacoBridge] copied text:", texts.join("\\n"));
      (window as any).JavaBridge?.setClipboardText?.(texts.join("\n"));
    }

    function doCut(model: any) {
      doCopy(model);

      const sels = state.editor.getSelections?.() || [];
      if (!sels.length) return;

      const edits = sels.map((sel: any) => ({
        range: sel,
        text: "",
        forceMoveMarkers: true
      }));

      state.editor.executeEdits("java-bridge", edits);
    }

    function doPaste(model: any) {
      let text = "";
      try {
        text = (window as any).JavaBridge?.getClipboardText?.() || "";
      } catch {}

      if (!text) return;

      const sels = state.editor.getSelections?.() || [];
      if (!sels.length) return;

      const edits = sels.map((sel: any) => ({
        range: sel,
        text,
        forceMoveMarkers: true
      }));

      state.editor.executeEdits("java-bridge", edits);
    }

    // installWheelNormalizer();
  }

  function attachDirtyTracking(model: any) {
    try {
      state.savedVersionId = model.getAlternativeVersionId();
      state.dirty = false;
      (window as any).JavaBridge?.onDirtyChanged?.(false);

      model.onDidChangeContent(() => {
        const newVersion = model.getAlternativeVersionId();
        const isDirty = newVersion !== state.savedVersionId;
        if (isDirty !== state.dirty) {
          state.dirty = isDirty;
          (window as any).JavaBridge?.onDirtyChanged?.(isDirty);
        }
      });
    } catch { }
  }

  // @ts-ignore
  const api: MonacoBridgeApi = {
    _onAmdReady(container: HTMLElement) {
      state.container = container;

      // FIXME only the relevant language should be registered (?)
      try {
        registerKimLanguage();
        logInfo("AMD ready, KIM language registered");
      } catch (e) {
        logError("Failed to register KIM language", e);
      }

      // Add this too for now. Seems like it only wants one
      try {
        registerWorldviewLanguage();
        logInfo("AMD ready, Worldview language registered");
      } catch (e) {
        logError("Failed to register Worldview language", e);
      }
      flush();
      state.ready = true;
      try {
        (window as any).JavaBridge?.onEditorReady?.();
        logInfo("JavaBridge.onEditorReady() called (AMD ready)");
      } catch (e) {
        logWarn("JavaBridge not available at AMD ready");
      }
    },

    openDocument(doc: MonacoOpenDoc) {
      ensureReady(() => {
        try {
          if (!doc || !doc.uri) {
            logWarn("openDocument called without URI");
            return;
          }

          logInfo(`Opening document ${doc.uri}`);

          const language = doc.language || 'plaintext';
          const theme = doc.theme || 'vs-dark';

          ensureEditorCreated(theme, language);

          if (!state.editor) {
            logError("Editor creation failed", null);
            return;
          }

          const uri = monaco.Uri.parse(doc.uri);
          state._currentUri = uri;

          let model = monaco.editor.getModel(uri);
          if (!model) {
            model = monaco.editor.createModel(doc.text || '', language, uri);
            logInfo(`Created new model for ${doc.uri}`);
          } else {
            model.setValue(doc.text || '');
            monaco.editor.setModelLanguage(model, language);
            logInfo(`Reused existing model for ${doc.uri}`);
          }

          state.editor.setModel(model);
          attachContentChanged(model);

          try {
            monaco.editor.setTheme(theme);
          } catch (e) {
            logWarn(`Failed to set theme ${theme}`);
          }

          // Clear old diagnostics when switching document
          try {
            monaco.editor.setModelMarkers(model, "kim-lsp", []);
          } catch (e) {
            logWarn("Failed to clear diagnostics on openDocument");
          }

          attachDirtyTracking(model);

          try {
            (window as any).JavaBridge?.onEditorReady?.();
            logInfo(`Editor ready for ${doc.uri}`);
          } catch (e) {
            logWarn("JavaBridge.onEditorReady failed after openDocument");
          }

        } catch (e) {
          logError("openDocument failed", e);
        }
      });
    },

    // Backwards compatible - routes to openDocument with a synthetic URI
    init(text: string, language = 'plaintext', theme = 'vs-dark') {
      api.openDocument({
        uri: 'inmemory:///legacy',
        text: text || '',
        language,
        theme
      });
    },

    setText(text: string) {
      ensureReady(() => {
        const model = state.editor?.getModel?.();
        if (!model) return;
        model.setValue(text || '');

        // programmatic set => reset dirty baseline
        state.savedVersionId = model.getAlternativeVersionId();
        if (state.dirty) {
          state.dirty = false;
          (window as any).JavaBridge?.onDirtyChanged?.(false);
        }
      });
    },

    getText(): string {
      try {
        const model = state.editor?.getModel?.();
        if (model) return model.getValue() || '';
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
        try { state.editor.setPosition(pos); } catch { }
        try { state.editor.revealPositionInCenter(pos); } catch { }
      });
    },

    setLineNumbers(show: boolean) {
      state.showLineNumbers = !!show;
      ensureReady(() => {
        if (state.editor) state.editor.updateOptions({ lineNumbers: state.showLineNumbers ? 'on' : 'off' });
      });
    },

    isLineNumbersVisible(): boolean {
      return !!state.showLineNumbers;
    },

    // Diagnostics API
    setDiagnostics(markers: any[]) {
      ensureReady(() => {
        try {
          const model = state.editor?.getModel?.();
          if (!model) {
            logWarn("setDiagnostics called but no model is active");
            return;
          }

          logInfo(`Applying ${markers?.length ?? 0} diagnostics to ${model.uri?.toString()}`);

          monaco.editor.setModelMarkers(model, "kim-lsp", markers || []);
        } catch (e) {
          logError("Failed to apply diagnostics", e);
        }
      });
    },

    clearDiagnostics() {
      ensureReady(() => {
        const model = state.editor?.getModel?.();
        if (!model) return;
        monaco.editor.setModelMarkers(model, OWNER_DIAGNOSTICS, []);
      });
    },

    createMarker(line: number, message: string, severity: 'info' | 'warning' | 'error' | 'hint' = 'info') {
      ensureReady(() => {
        const model = state.editor?.getModel?.();
        if (!model) return;
        const markers = [{
          startLineNumber: Math.max(1, Math.floor(line || 1)),
          endLineNumber: Math.max(1, Math.floor(line || 1)),
          startColumn: 1,
          endColumn: 1,
          message: message || '',
          severity: toSeverity(severity)
        }];
        monaco.editor.setModelMarkers(model, 'java-bridge', markers);
      });
    },

    createMarkerByOffset(offset: number, length: number, message: string, severity: 'info' | 'warning' | 'error' | 'hint' = 'info') {
      ensureReady(() => {
        const model = state.editor?.getModel?.();
        if (!model) return;
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
        monaco.editor.setModelMarkers(model, 'java-bridge', markers);
      });
    },

    async connectLsp(wsUrl: string, languageId?: string): Promise<boolean> {
      console.warn('[LSP] connectLsp is not used in klab-ide integration (LSP is handled in Java).', wsUrl, languageId);
      return false;
    }
  };

  (window as any).MonacoBridge = api;
})();
