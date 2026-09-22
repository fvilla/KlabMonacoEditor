const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function fixture() {
  const markers = new Map();
  const commands = new Map(), requests = [], dirty = [], changes = [];
  let model, position = {lineNumber: 1, column: 3}, selection = null;
  let readOnly = false, stops = 0, focuses = 0;
  const makeModel = (text, uri) => {
    let version = 1; const listeners = [];
    return {uri, getValue: () => text, getVersionId: () => version, isDisposed: () => false,
      getOffsetAt: p => p.column - 1, getPositionAt: offset => ({lineNumber: 1, column: offset + 1}),
      getLineContent: () => text,
      getValueInRange: range => text.slice(range.startColumn - 1, range.endColumn - 1),
      onDidChangeContent: fn => { listeners.push(fn); return {dispose() {}}; },
      setValue(value) {text = value; version++; listeners.forEach(fn => fn({changes: []}));},
      getLineCount: () => 1};
  };
  const editor = {getModel: () => model, setModel: value => model = value,
    getPosition: () => position, setPosition: value => position = value,
    getSelection: () => selection,
    getOption: () => readOnly, addCommand: (key, fn) => commands.set(key, fn),
    onDidChangeCursorPosition() {}, onKeyDown() {}, onMouseDown() {},
    deltaDecorations: () => [], updateOptions() {}, getDomNode: () => null,
    pushUndoStop() { stops++; }, focus() {focuses++;},
    executeEdits(source, edits) {
      changes.push({source, edits}); const edit = edits[0], offset = edit.range.startColumn - 1;
      model.setValue(model.getValue().slice(0, offset) + edit.text + model.getValue().slice(offset));
    }
  };
  const monaco = {MarkerSeverity: {Error: 8, Warning: 4, Info: 2, Hint: 1}, KeyMod: {CtrlCmd: 1, Shift: 2}, KeyCode: {Space: 4, KeyS: 8, KeyC: 16, KeyX: 32, KeyV: 64},
    Uri: {parse: value => ({toString: () => value})},
    Range: class {constructor(a,b,c,d) {this.startLineNumber=a;this.startColumn=b;this.endLineNumber=c;this.endColumn=d;}},
    languages: {getLanguages: () => []},
    editor: {EditorOption: {readOnly: 1}, create: () => editor, getModel: () => null,
      createModel: makeModel, setTheme() {}, defineTheme() {}, setModelMarkers(model, owner, values) {markers.set(owner, values);}, getModelMarkers({owner}) {return markers.get(owner) || [];}}
  };
  const element = {style: {}, appendChild() {}, addEventListener() {}, setAttribute() {}};
  const window = {JavaBridge: {onComposeObservable: (id, selectedText, conceptAtCursor) =>
      requests.push({id, selectedText, conceptAtCursor}), onDirtyChanged: value => dirty.push(value)},
    setTimeout: () => 0, clearTimeout() {}, requestAnimationFrame() {}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../main/resources/org/integratedmodelling/klabeditor/monaco/monaco-bridge.js'), 'utf8'),
    {window, monaco, document: {head: element, getElementById: () => null, createElement: () => element, addEventListener() {}},
      console: {log() {}, warn() {}, error() {}}, setTimeout: () => 0, clearTimeout() {}});
  const api = window.MonacoBridge;
  api._onAmdReady(element); api.openDocument({uri: 'test:first', text: 'abcd', language: 'plaintext'});
  return {api, markers, requests, dirty, changes, invoke: () => commands.get(7)(),
    text: () => model.getValue(), position: () => position, stops: () => stops, focuses: () => focuses,
    change: value => model.setValue(value), readOnly: value => readOnly = value,
    select: (startColumn, endColumn) => {
      selection = {startLineNumber: 1, endLineNumber: 1, startColumn, endColumn,
        isEmpty: () => startColumn === endColumn};
      position = {lineNumber: 1, column: endColumn};
    }};
}

test('shortcut returns a URN at the captured cursor, as one dirty undoable edit', () => {
  const f = fixture(); f.invoke(); f.invoke(); assert.equal(f.requests.length, 1);
  f.api.completeObservableComposition(f.requests[0].id, 'biology:Species of each biology:Tree');
  assert.equal(f.text(), 'abbiology:Species of each biology:Treecd');
  assert.equal(f.changes.length, 1); assert.equal(f.stops(), 2);
  assert.equal(f.position().column, 3 + 'biology:Species of each biology:Tree'.length);
  assert.equal(f.dirty.at(-1), true); assert.equal(f.focuses(), 1);
  f.api.completeObservableComposition(f.requests[0].id, 'duplicate'); assert.equal(f.changes.length, 1);
});

test('cancel and stale request IDs do not edit and cancellation permits another request', () => {
  const f = fixture(); f.invoke();
  f.api.completeObservableComposition('wrong-id', 'wrong'); assert.equal(f.changes.length, 0);
  f.api.completeObservableComposition(f.requests[0].id, null); assert.equal(f.text(), 'abcd');
  assert.equal(f.stops(), 0); f.invoke(); assert.equal(f.requests.length, 2);
});

test('changed, rebound and read-only documents reject late insertion', () => {
  const f = fixture(); f.invoke(); f.change('updated');
  f.api.completeObservableComposition(f.requests[0].id, 'late'); assert.equal(f.text(), 'updated');
  f.invoke(); f.api.openDocument({uri: 'test:second', text: 'second', language: 'plaintext'});
  f.api.completeObservableComposition(f.requests[1].id, 'late'); assert.equal(f.text(), 'second');
  f.readOnly(true); f.invoke(); assert.equal(f.requests.length, 2);
  f.readOnly(false); f.invoke(); f.readOnly(true);
  f.api.completeObservableComposition(f.requests[2].id, 'late'); assert.equal(f.text(), 'second');
});

test('shortcut reports the active selection and concept under the cursor', () => {
  const f = fixture();
  f.change('observe biology:Tree in ecology:Forest');
  f.select(9, 21);
  f.invoke();
  assert.equal(f.requests[0].selectedText, 'biology:Tree');
  assert.equal(f.requests[0].conceptAtCursor, 'biology:Tree');
  f.api.completeObservableComposition(f.requests[0].id, null);
});


test('semantic markers have independent ownership and retain lexical offsets', () => {
  const f = fixture();
  f.api.setSemanticMarkers([{offset: 1, length: 2, message: 'Invalid endpoint', severity: 'error'}]);
  f.api.createMarkerByOffset(0, 1, 'Parser warning', 'warning');
  f.api.setDiagnostics([{message: 'LSP warning'}]);
  const semantic = f.markers.get('klab-semantics');
  assert.equal(semantic[0].startColumn, 2); assert.equal(semantic[0].endColumn, 4);
  assert.equal(semantic[0].severity, 8);
  f.api.clearMarkers();
  assert.equal(f.markers.get('klab-semantics').length, 1);
  f.api.setSemanticMarkers([]);
  assert.equal(f.markers.get('klab-semantics').length, 0);
  assert.equal(f.markers.get('kim-lsp').length, 1);
});


test('a queued semantic response for superseded text does not replace current markers', () => {
  const f = fixture();
  f.api.setSemanticMarkers([{offset: 0, length: 1, message: 'Current', severity: 'error'}], 'abcd');
  f.change('new source');
  f.api.setSemanticMarkers([{offset: 1, length: 1, message: 'Late', severity: 'error'}], 'abcd');
  assert.equal(f.markers.get('klab-semantics')[0].message, 'Current');
  f.api.setSemanticMarkers([]);
  assert.equal(f.markers.get('klab-semantics').length, 0);
});


test('semantic markers use parsed-source positions across CRLF normalization', () => {
  const f = fixture(); f.change('first\ninvalid');
  f.api.setSemanticMarkers([{offset: 7, length: 7, message: 'Invalid', severity: 'error'}], 'first\r\ninvalid');
  const marker = f.markers.get('klab-semantics')[0];
  assert.equal(marker.startLineNumber, 2); assert.equal(marker.startColumn, 1);
  assert.equal(marker.endLineNumber, 2); assert.equal(marker.endColumn, 8);
});
