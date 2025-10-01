(function () {
  var state = {
    editor: null,
    container: null,
    ready: false,
    showLineNumbers: true,
    pendingCalls: []
  };

  function flush() {
    while (state.pendingCalls.length) {
      try { (state.pendingCalls.shift())(); } catch (e) { console.error(e); }
    }
  }

  function ensureReady(f) {
    if (state.ready) f(); else state.pendingCalls.push(f);
  }

  function toSeverity(s) {
    var m = (s || 'info').toLowerCase();
    switch (m) {
      case 'error': return monaco.MarkerSeverity.Error;
      case 'warning': return monaco.MarkerSeverity.Warning;
      case 'hint': return monaco.MarkerSeverity.Hint;
      case 'info':
      default: return monaco.MarkerSeverity.Info;
    }
  }

  var api = {
    _onAmdReady: function (container) {
      state.container = container;
      state.ready = true;
      flush();
      try { window.JavaBridge && window.JavaBridge.onEditorReady && window.JavaBridge.onEditorReady(); } catch (e) {}
    },

    init: function (text, language, theme) {
      language = language || 'plaintext';
      theme = theme || 'vs-dark';
      ensureReady(function () {
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
            lineNumbers: state.showLineNumbers ? 'on' : 'off'
          });
        } else {
          state.editor.updateOptions({ theme: theme });
          var model = state.editor.getModel();
          if (model) {
            monaco.editor.setModelLanguage(model, language);
            model.setValue(text || '');
          }
        }
      });
    },

    setText: function (text) {
      ensureReady(function () {
        var model = state.editor && state.editor.getModel && state.editor.getModel();
        if (model) model.setValue(text || '');
      });
    },

    setLineNumbers: function (show) {
      state.showLineNumbers = !!show;
      ensureReady(function () {
        if (state.editor) {
          state.editor.updateOptions({ lineNumbers: state.showLineNumbers ? 'on' : 'off' });
        }
      });
    },

    isLineNumbersVisible: function () {
      return !!state.showLineNumbers;
    },

    createMarker: function (line, message, severity) {
      ensureReady(function () {
        var model = state.editor && state.editor.getModel && state.editor.getModel();
        if (!model) return;
        var owner = 'java-bridge';
        var ln = Math.max(1, Math.floor(line || 1));
        var markers = [{
          startLineNumber: ln,
          endLineNumber: ln,
          startColumn: 1,
          endColumn: 1,
          message: message || '',
          severity: toSeverity(severity)
        }];
        monaco.editor.setModelMarkers(model, owner, markers);
      });
    },

    connectLsp: function (wsUrl, languageId) {
      try {
        var g = window;
        if (!g.monaco || !state.editor) { console.warn('Monaco or editor not ready'); return Promise.resolve(false); }
        if (!g.monaco_languageclient || !g.monaco_languageclient.MonacoLanguageClient) {
          console.warn('[LSP] monaco-languageclient not found on window. Please bundle and load it.');
          return Promise.resolve(false);
        }
        if (!g.reconnecting_websocket && !g.WebSocket) {
          console.warn('[LSP] WebSocket not available');
          return Promise.resolve(false);
        }
        // See monaco-bridge.ts for a complete example wiring with monaco-languageclient.
        console.warn('[LSP] connectLsp stub invoked; see monaco-bridge.ts comments to enable real client.');
        return Promise.resolve(false);
      } catch (e) {
        console.error('[LSP] Failed to connect:', e);
        return Promise.resolve(false);
      }
    }
  };

  window.MonacoBridge = api;
})();
