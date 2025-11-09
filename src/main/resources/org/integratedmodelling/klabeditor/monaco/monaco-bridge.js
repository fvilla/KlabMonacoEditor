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
        pendingCalls: [],
        savedVersionId: 0,
        dirty: false
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
                var _a, _b;
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
                    try {
                        api.editor = state.editor;
                    }
                    catch (_c) { }
                    var model_1 = state.editor.getModel();
                    if (model_1) {
                        state.savedVersionId = model_1.getAlternativeVersionId();
                        state.dirty = false;
                        try {
                            (_a = window.JavaBridge) === null || _a === void 0 ? void 0 : _a.onDirtyChanged(false);
                        }
                        catch (_d) { }
                        model_1.onDidChangeContent(function () {
                            var _a;
                            var newVersion = model_1.getAlternativeVersionId();
                            var isDirty = newVersion !== state.savedVersionId;
                            if (isDirty !== state.dirty) {
                                state.dirty = isDirty;
                                try {
                                    (_a = window.JavaBridge) === null || _a === void 0 ? void 0 : _a.onDirtyChanged(isDirty);
                                }
                                catch (_b) { }
                            }
                        });
                    }
                    try {
                        state.editor.addCommand((monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS), function () {
                            var _a, _b;
                            try {
                                var currentModel = state.editor.getModel();
                                var textNow = currentModel ? currentModel.getValue() : (state.editor.getValue ? state.editor.getValue() : '');
                                (_a = window.JavaBridge) === null || _a === void 0 ? void 0 : _a.onSave(textNow);
                                if (currentModel) {
                                    state.savedVersionId = currentModel.getAlternativeVersionId();
                                    if (state.dirty) {
                                        state.dirty = false;
                                        (_b = window.JavaBridge) === null || _b === void 0 ? void 0 : _b.onDirtyChanged(false);
                                    }
                                }
                            }
                            catch (_c) { }
                        });
                    }
                    catch (_e) { }
                    try {
                        state.editor.addCommand((monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyC), function () {
                            var _a, _b, _c, _d, _e, _f;
                            try {
                                var model_2 = (_b = (_a = state.editor).getModel) === null || _b === void 0 ? void 0 : _b.call(_a);
                                if (!model_2)
                                    return;
                                var sels0 = ((_d = (_c = state.editor).getSelections) === null || _d === void 0 ? void 0 : _d.call(_c)) || (state.editor.getSelection ? [state.editor.getSelection()] : []);
                                var selections = (sels0 && sels0.length) ? sels0 : (state.editor.getSelection ? [state.editor.getSelection()] : []);
                                if (!selections || !selections.length)
                                    return;
                                var texts = [];
                                for (var _i = 0, selections_1 = selections; _i < selections_1.length; _i++) {
                                    var sel = selections_1[_i];
                                    if (!sel)
                                        continue;
                                    var isEmpty = (sel.startLineNumber === sel.endLineNumber) && (sel.startColumn === sel.endColumn);
                                    if (isEmpty) {
                                        var line = sel.startLineNumber;
                                        var t = model_2.getLineContent ? (model_2.getLineContent(line) || '') : '';
                                        t = t + '\n';
                                        texts.push(t);
                                    }
                                    else {
                                        var t = model_2.getValueInRange(sel) || '';
                                        texts.push(t);
                                    }
                                }
                                var clip = texts.join('\n');
                                try {
                                    (_f = (_e = window.JavaBridge) === null || _e === void 0 ? void 0 : _e.setClipboardText) === null || _f === void 0 ? void 0 : _f.call(_e, clip);
                                }
                                catch (_g) { }
                            }
                            catch (_h) { }
                        });
                    }
                    catch (_f) { }
                    try {
                        state.editor.addCommand((monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyX), function () {
                            var _a, _b, _c, _d, _e, _f;
                            try {
                                var model_3 = (_b = (_a = state.editor).getModel) === null || _b === void 0 ? void 0 : _b.call(_a);
                                if (!model_3)
                                    return;
                                var sels0 = ((_d = (_c = state.editor).getSelections) === null || _d === void 0 ? void 0 : _d.call(_c)) || (state.editor.getSelection ? [state.editor.getSelection()] : []);
                                var selections = (sels0 && sels0.length) ? sels0 : (state.editor.getSelection ? [state.editor.getSelection()] : []);
                                if (!selections || !selections.length)
                                    return;
                                var texts = [];
                                var edits = [];
                                for (var _i = 0, selections_2 = selections; _i < selections_2.length; _i++) {
                                    var sel = selections_2[_i];
                                    if (!sel)
                                        continue;
                                    var isEmpty = (sel.startLineNumber === sel.endLineNumber) && (sel.startColumn === sel.endColumn);
                                    if (isEmpty) {
                                        var line = sel.startLineNumber;
                                        var lineText = model_3.getLineContent ? (model_3.getLineContent(line) || '') : '';
                                        texts.push(lineText + '\n');
                                        var lineCount = model_3.getLineCount ? model_3.getLineCount() : 0;
                                        if (line < lineCount) {
                                            edits.push({ range: { startLineNumber: line, startColumn: 1, endLineNumber: line + 1, endColumn: 1 }, text: '', forceMoveMarkers: true });
                                        }
                                        else {
                                            var maxCol = model_3.getLineMaxColumn ? model_3.getLineMaxColumn(line) : 1;
                                            edits.push({ range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: maxCol }, text: '', forceMoveMarkers: true });
                                        }
                                    }
                                    else {
                                        var t = model_3.getValueInRange(sel) || '';
                                        texts.push(t);
                                        edits.push({ range: sel, text: '', forceMoveMarkers: true });
                                    }
                                }
                                var clip = texts.join('\n');
                                try {
                                    (_f = (_e = window.JavaBridge) === null || _e === void 0 ? void 0 : _e.setClipboardText) === null || _f === void 0 ? void 0 : _f.call(_e, clip);
                                }
                                catch (_g) { }
                                if (edits.length) {
                                    try {
                                        state.editor.pushUndoStop && state.editor.pushUndoStop();
                                    }
                                    catch (_h) { }
                                    try {
                                        state.editor.executeEdits('java-bridge', edits);
                                    }
                                    catch (_j) { }
                                    try {
                                        state.editor.pushUndoStop && state.editor.pushUndoStop();
                                    }
                                    catch (_k) { }
                                }
                            }
                            catch (_l) { }
                        });
                    }
                    catch (_g) { }
                    try {
                        state.editor.addCommand((monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyV), function () {
                            var _a, _b, _c, _d, _e, _f;
                            try {
                                var model_4 = (_b = (_a = state.editor).getModel) === null || _b === void 0 ? void 0 : _b.call(_a);
                                if (!model_4)
                                    return;
                                var text_1 = '';
                                try {
                                    text_1 = ((_d = (_c = window.JavaBridge) === null || _c === void 0 ? void 0 : _c.getClipboardText) === null || _d === void 0 ? void 0 : _d.call(_c)) || '';
                                }
                                catch (_g) { }
                                if (text_1 == null)
                                    text_1 = '';
                                var sels = ((_f = (_e = state.editor).getSelections) === null || _f === void 0 ? void 0 : _f.call(_e)) || (state.editor.getSelection ? [state.editor.getSelection()] : []);
                                if (!sels || !sels.length)
                                    return;
                                var edits = sels.filter(Boolean).map(function (sel) { return ({ range: sel, text: text_1, forceMoveMarkers: true }); });
                                if (edits.length) {
                                    try {
                                        state.editor.executeEdits('java-bridge', edits);
                                    }
                                    catch (_h) { }
                                }
                            }
                            catch (_j) { }
                        });
                    }
                    catch (_h) { }
                    try {
                        var KC_1 = monaco.KeyCode;
                        var doCopy_1 = function () {
                            var _a, _b, _c, _d, _e, _f;
                            var model = (_b = (_a = state.editor).getModel) === null || _b === void 0 ? void 0 : _b.call(_a);
                            if (!model)
                                return;
                            var sels0 = ((_d = (_c = state.editor).getSelections) === null || _d === void 0 ? void 0 : _d.call(_c)) || (state.editor.getSelection ? [state.editor.getSelection()] : []);
                            var selections = (sels0 && sels0.length) ? sels0 : (state.editor.getSelection ? [state.editor.getSelection()] : []);
                            if (!selections || !selections.length)
                                return;
                            var texts = [];
                            for (var _i = 0, selections_3 = selections; _i < selections_3.length; _i++) {
                                var sel = selections_3[_i];
                                if (!sel)
                                    continue;
                                var isEmpty = (sel.startLineNumber === sel.endLineNumber) && (sel.startColumn === sel.endColumn);
                                if (isEmpty) {
                                    var line = sel.startLineNumber;
                                    var t = model.getLineContent ? (model.getLineContent(line) || '') : '';
                                    t = t + '\n';
                                    texts.push(t);
                                }
                                else {
                                    var t = model.getValueInRange(sel) || '';
                                    texts.push(t);
                                }
                            }
                            var clip = texts.join('\n');
                            try {
                                (_f = (_e = window.JavaBridge) === null || _e === void 0 ? void 0 : _e.setClipboardText) === null || _f === void 0 ? void 0 : _f.call(_e, clip);
                            }
                            catch (_g) { }
                        };
                        var doCut_1 = function () {
                            var _a, _b, _c, _d, _e, _f;
                            var model = (_b = (_a = state.editor).getModel) === null || _b === void 0 ? void 0 : _b.call(_a);
                            if (!model)
                                return;
                            var sels0 = ((_d = (_c = state.editor).getSelections) === null || _d === void 0 ? void 0 : _d.call(_c)) || (state.editor.getSelection ? [state.editor.getSelection()] : []);
                            var selections = (sels0 && sels0.length) ? sels0 : (state.editor.getSelection ? [state.editor.getSelection()] : []);
                            if (!selections || !selections.length)
                                return;
                            var texts = [];
                            var edits = [];
                            for (var _i = 0, selections_4 = selections; _i < selections_4.length; _i++) {
                                var sel = selections_4[_i];
                                if (!sel)
                                    continue;
                                var isEmpty = (sel.startLineNumber === sel.endLineNumber) && (sel.startColumn === sel.endColumn);
                                if (isEmpty) {
                                    var line = sel.startLineNumber;
                                    var lineText = model.getLineContent ? (model.getLineContent(line) || '') : '';
                                    texts.push(lineText + '\n');
                                    var lineCount = model.getLineCount ? model.getLineCount() : 0;
                                    if (line < lineCount) {
                                        edits.push({ range: { startLineNumber: line, startColumn: 1, endLineNumber: line + 1, endColumn: 1 }, text: '', forceMoveMarkers: true });
                                    }
                                    else {
                                        var maxCol = model.getLineMaxColumn ? model.getLineMaxColumn(line) : 1;
                                        edits.push({ range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: maxCol }, text: '', forceMoveMarkers: true });
                                    }
                                }
                                else {
                                    var t = model.getValueInRange(sel) || '';
                                    texts.push(t);
                                    edits.push({ range: sel, text: '', forceMoveMarkers: true });
                                }
                            }
                            var clip = texts.join('\n');
                            try {
                                (_f = (_e = window.JavaBridge) === null || _e === void 0 ? void 0 : _e.setClipboardText) === null || _f === void 0 ? void 0 : _f.call(_e, clip);
                            }
                            catch (_g) { }
                            if (edits.length) {
                                try {
                                    state.editor.pushUndoStop && state.editor.pushUndoStop();
                                }
                                catch (_h) { }
                                try {
                                    state.editor.executeEdits('java-bridge', edits);
                                }
                                catch (_j) { }
                                try {
                                    state.editor.pushUndoStop && state.editor.pushUndoStop();
                                }
                                catch (_k) { }
                            }
                        };
                        var doPaste_1 = function () {
                            var _a, _b, _c, _d, _e, _f;
                            var model = (_b = (_a = state.editor).getModel) === null || _b === void 0 ? void 0 : _b.call(_a);
                            if (!model)
                                return;
                            var text = '';
                            try {
                                text = ((_d = (_c = window.JavaBridge) === null || _c === void 0 ? void 0 : _c.getClipboardText) === null || _d === void 0 ? void 0 : _d.call(_c)) || '';
                            }
                            catch (_g) { }
                            if (text == null)
                                text = '';
                            var sels0 = ((_f = (_e = state.editor).getSelections) === null || _f === void 0 ? void 0 : _f.call(_e)) || (state.editor.getSelection ? [state.editor.getSelection()] : []);
                            var selections = (sels0 && sels0.length) ? sels0 : (state.editor.getSelection ? [state.editor.getSelection()] : []);
                            if (!selections || !selections.length)
                                return;
                            var edits = selections.filter(Boolean).map(function (sel) { return ({ range: sel, text: text, forceMoveMarkers: true }); });
                            if (edits.length) {
                                try {
                                    state.editor.pushUndoStop && state.editor.pushUndoStop();
                                }
                                catch (_h) { }
                                try {
                                    state.editor.executeEdits('java-bridge', edits);
                                }
                                catch (_j) { }
                                try {
                                    state.editor.pushUndoStop && state.editor.pushUndoStop();
                                }
                                catch (_k) { }
                            }
                        };
                        state.editor.onKeyDown(function (e) {
                            var isCtrl = !!(e.ctrlKey || e.metaKey);
                            var isShift = !!e.shiftKey;
                            var code = e.keyCode;
                            var isCopy = (isCtrl && code === KC_1.KeyC) || (!isCtrl && !isShift && code === KC_1.F6 && false);
                            var isCut = (isCtrl && code === KC_1.KeyX);
                            var isPaste = (isCtrl && code === KC_1.KeyV) || (isShift && !isCtrl && code === KC_1.Insert);
                            var isCtrlInsertCopy = (isCtrl && !isShift && code === KC_1.Insert);
                            if (isCopy || isCtrlInsertCopy) {
                                doCopy_1();
                                e.preventDefault();
                                e.stopPropagation();
                                return;
                            }
                            if (isCut) {
                                doCut_1();
                                e.preventDefault();
                                e.stopPropagation();
                                return;
                            }
                            if (isPaste) {
                                doPaste_1();
                                e.preventDefault();
                                e.stopPropagation();
                                return;
                            }
                        });
                    }
                    catch (_j) { }
                }
                else {
                    state.editor.updateOptions({ theme: theme });
                    var model = state.editor.getModel();
                    if (model) {
                        monaco.editor.setModelLanguage(model, language);
                        model.setValue(text || '');
                        state.savedVersionId = model.getAlternativeVersionId();
                        if (state.dirty) {
                            state.dirty = false;
                            try {
                                (_b = window.JavaBridge) === null || _b === void 0 ? void 0 : _b.onDirtyChanged(false);
                            }
                            catch (_k) { }
                        }
                    }
                    try {
                        api.editor = state.editor;
                    }
                    catch (_l) { }
                }
            });
        },
        setText: function (text) {
            ensureReady(function () {
                var _a, _b, _c;
                var model = (_b = (_a = state.editor) === null || _a === void 0 ? void 0 : _a.getModel) === null || _b === void 0 ? void 0 : _b.call(_a);
                if (model) {
                    model.setValue(text || '');
                    try {
                        state.savedVersionId = model.getAlternativeVersionId();
                        if (state.dirty) {
                            state.dirty = false;
                            (_c = window.JavaBridge) === null || _c === void 0 ? void 0 : _c.onDirtyChanged(false);
                        }
                    }
                    catch (_d) { }
                }
            });
        },
        getText: function () {
            var _a, _b, _c;
            try {
                var model = (_b = (_a = state.editor) === null || _a === void 0 ? void 0 : _a.getModel) === null || _b === void 0 ? void 0 : _b.call(_a);
                if (model)
                    return model.getValue() || '';
                return ((_c = state.editor) === null || _c === void 0 ? void 0 : _c.getValue) ? (state.editor.getValue() || '') : '';
            }
            catch (_d) {
                return '';
            }
        },
        setCursorPosition: function (offset) {
            ensureReady(function () {
                var _a, _b;
                var model = (_b = (_a = state.editor) === null || _a === void 0 ? void 0 : _a.getModel) === null || _b === void 0 ? void 0 : _b.call(_a);
                if (!model)
                    return;
                var pos = model.getPositionAt(Math.max(0, Math.floor(offset || 0)));
                try {
                    state.editor.setPosition(pos);
                }
                catch (_c) { }
                try {
                    state.editor.revealPositionInCenter(pos);
                }
                catch (_d) { }
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
