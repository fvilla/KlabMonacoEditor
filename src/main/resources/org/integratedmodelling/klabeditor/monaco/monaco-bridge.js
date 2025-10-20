var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
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
            try {
                (state.pendingCalls.shift())();
            }
            catch (e) {
                console.error(e);
            }
        }
    }
    function ensureReady(f) {
        if (state.ready)
            f();
        else
            state.pendingCalls.push(f);
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
            var _a;
            state.container = container;
            state.ready = true;
            flush();
            try {
                (_a = window.JavaBridge) === null || _a === void 0 ? void 0 : _a.onEditorReady();
            }
            catch (_b) { }
        },
        init: function (text, language, theme) {
            if (language === void 0) { language = 'plaintext'; }
            if (theme === void 0) { theme = 'vs-dark'; }
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
                        lineNumbers: state.showLineNumbers ? 'on' : 'off',
                    });
                }
                else {
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
                var _a, _b;
                var model = (_b = (_a = state.editor) === null || _a === void 0 ? void 0 : _a.getModel) === null || _b === void 0 ? void 0 : _b.call(_a);
                if (model)
                    model.setValue(text || '');
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
            if (severity === void 0) { severity = 'info'; }
            ensureReady(function () {
                var _a, _b;
                var model = (_b = (_a = state.editor) === null || _a === void 0 ? void 0 : _a.getModel) === null || _b === void 0 ? void 0 : _b.call(_a);
                if (!model)
                    return;
                var owner = 'java-bridge';
                var markers = [{
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
        createMarkerByOffset: function (offset, length, message, severity) {
            if (severity === void 0) { severity = 'info'; }
            ensureReady(function () {
                var _a, _b;
                var model = (_b = (_a = state.editor) === null || _a === void 0 ? void 0 : _a.getModel) === null || _b === void 0 ? void 0 : _b.call(_a);
                if (!model)
                    return;
                var owner = 'java-bridge';
                var startPosition = model.getPositionAt(offset);
                var endPosition = model.getPositionAt(offset + length);
                var markers = [{
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
        connectLsp: function (wsUrl, languageId) {
            return __awaiter(this, void 0, void 0, function () {
                var g;
                return __generator(this, function (_a) {
                    try {
                        g = window;
                        if (!g.monaco || !state.editor) {
                            console.warn('Monaco or editor not ready');
                            return [2, false];
                        }
                        if (!g.monaco_languageclient || !g.monaco_languageclient.MonacoLanguageClient) {
                            console.warn('[LSP] monaco-languageclient not found on window. Please bundle and load it.');
                            return [2, false];
                        }
                        if (!g.reconnecting_websocket && !g.WebSocket) {
                            console.warn('[LSP] WebSocket not available');
                            return [2, false];
                        }
                        console.warn('[LSP] connectLsp stub invoked; see monaco-bridge.ts comments to enable real client.');
                        return [2, false];
                    }
                    catch (e) {
                        console.error('[LSP] Failed to connect:', e);
                        return [2, false];
                    }
                    return [2];
                });
            });
        }
    };
    window.MonacoBridge = api;
})();
