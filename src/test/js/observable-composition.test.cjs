const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function fixture() {
  const markers = new Map(), formatters = new Map();
  const commands = new Map(), requests = [], dirty = [], changes = [], saves = [];
  const timers = new Map(), batches = [];
  let timerId = 0, conceptSnapshot = {}, decorated = [];
  let model, position = {lineNumber: 1, column: 3}, selection = null;
  let readOnly = false, stops = 0, focuses = 0;
  const makeModel = (text, language, uri) => {
    let version = 1; const listeners = [];
    return {uri, getValue: () => text, getVersionId: () => version, isDisposed: () => false,
      getLanguageId: () => language, setLanguage: value => language = value,
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
    deltaDecorations(ids, values) {
      decorated = values;
      return values.map((_, index) => String(index));
    }, updateOptions() {}, getDomNode: () => null,
    pushUndoStop() { stops++; }, focus() {focuses++;},
    executeEdits(source, edits) {
      changes.push({source, edits}); const edit = edits[0], offset = edit.range.startColumn - 1;
      model.setValue(model.getValue().slice(0, offset) + edit.text + model.getValue().slice(offset));
    }
  };
  const monaco = {MarkerSeverity: {Error: 8, Warning: 4, Info: 2, Hint: 1}, KeyMod: {CtrlCmd: 1, Shift: 2}, KeyCode: {Space: 4, KeyS: 8, KeyC: 16, KeyX: 32, KeyV: 64},
    Uri: {parse: value => ({toString: () => value})},
    Range: class {constructor(a,b,c,d) {this.startLineNumber=a;this.startColumn=b;this.endLineNumber=c;this.endColumn=d;}},
    languages: {getLanguages: () => [], register() {}, setMonarchTokensProvider() {}, setLanguageConfiguration() {},
      registerDocumentFormattingEditProvider(id, provider) {
        assert.equal(formatters.has(id), false);
        formatters.set(id, provider);
      }},
    editor: {EditorOption: {readOnly: 1}, create: () => editor, getModel: () => null,
      setModelLanguage: (model, value) => model.setLanguage(value),
      createModel: makeModel, setTheme() {}, defineTheme() {}, setModelMarkers(model, owner, values) {markers.set(owner, values);}, getModelMarkers({owner}) {return markers.get(owner) || [];}}
  };
  const element = {style: {}, appendChild() {}, addEventListener() {}, setAttribute() {}};
  const window = {JavaBridge: {onComposeObservable: (id, selectedText, conceptAtCursor) =>
      requests.push({id, selectedText, conceptAtCursor}), onDirtyChanged: value => dirty.push(value),
      classifyConcepts(json) {
        const batch = JSON.parse(json);
        batches.push(batch);
        return JSON.stringify(Object.fromEntries(batch
          .filter(concept => concept in conceptSnapshot).map(concept => [concept, conceptSnapshot[concept]])));
      }},
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); }, requestAnimationFrame() {}};
  window.JavaBridge.onSave = text => saves.push(text);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../main/resources/org/integratedmodelling/klabeditor/monaco/monaco-bridge.js'), 'utf8'),
    {window, monaco, document: {head: element, getElementById: () => null, createElement: () => element, addEventListener() {}},
      console: {log() {}, warn() {}, error() {}}, setTimeout: () => 0, clearTimeout() {}});
  const api = window.MonacoBridge;
  api._onAmdReady(element); api.openDocument({uri: 'test:first', text: 'abcd', language: 'plaintext'});
  return {api, markers, formatters, language: () => model.getLanguageId(),
    useConcepts(snapshot) { conceptSnapshot = snapshot; api.conceptClassificationsChanged(); },
    conceptDecorations: () => decorated, batches, version: () => model.getVersionId(),
    runTimers(limit = Infinity) {
      while (timers.size && limit-- > 0) {
        const [id, fn] = timers.entries().next().value;
        timers.delete(id);
        fn();
      }
    },
    requests, dirty, changes, saves, save: () => commands.get(9)(), invoke: () => commands.get(7)(),
    text: () => model.getValue(), position: () => position, stops: () => stops, focuses: () => focuses,
    change: value => model.setValue(value), readOnly: value => readOnly = value,
    select: (startColumn, endColumn) => {
      selection = {startLineNumber: 1, endLineNumber: 1, startColumn, endColumn,
        isEmpty: () => startColumn === endColumn};
      position = {lineNumber: 1, column: endColumn};
    }};
}

test('reclassification replaces deleted concepts without touching the text or its version', () => {
  const f = fixture();
  f.api.openDocument({uri: 'test:semantic.kim', language: 'kim', text: 'model earth:Region;'});
  f.change('model plant_data:River_Bank; "earth:Region" /* earth:Region */ earth:Region;');
  const edited = f.text();
  f.useConcepts({'plant_data:River_Bank': 'SUBJECT', 'earth:Region': 'SUBJECT'});
  f.runTimers();
  assert.deepEqual(f.batches.flat(), ['plant_data:River_Bank', 'earth:Region']);
  assert.equal(f.conceptDecorations().length, 2);
  f.change(edited + ' ');
  f.change(edited);
  f.runTimers();
  assert.equal(f.batches.length, 1);
  const version = f.version();
  f.useConcepts({'earth:Region': 'PROCESS ABSTRACT'});
  f.runTimers();
  assert.equal(f.conceptDecorations().length, 1);
  assert.equal(f.conceptDecorations()[0].options.inlineClassName, 'klab-process klab-abstract');
  assert.equal(f.text(), edited);
  assert.equal(f.version(), version);
  assert.equal(f.dirty.at(-1), true);
});

test('large reference sets transfer in bounded batches and discard a superseded repaint', () => {
  const f = fixture();
  const concepts = Array.from({length: 300}, (_, index) => 'earth:Concept' + index);
  f.api.openDocument({uri: 'test:semantic.kim', language: 'kim', text: concepts.join(', ')});
  f.useConcepts(Object.fromEntries(concepts.map(concept => [concept, 'QUALITY'])));
  f.runTimers(1);
  assert.equal(f.batches[0].length, 128);
  assert.equal(f.conceptDecorations().length, 0);
  f.useConcepts({'earth:Concept299': 'EVENT'});
  f.runTimers();
  assert.deepEqual(f.batches.map(batch => batch.length), [128, 128, 128, 44]);
  assert.equal(f.conceptDecorations().length, 1);
  assert.equal(f.conceptDecorations()[0].options.inlineClassName, 'klab-event');
});

test('k.LAB document providers register once and pending keywords cannot switch the current model', async () => {
  const f = fixture();
  const id = name => 'org.integratedmodelling.languages.' + name;
  for (const [extension, language] of [
    ['kwv', 'Worldview'], ['obs', 'Observation'], ['kim', 'Kim'], ['kactors', 'KActors'], ['kactor', 'KActors']
  ]) {
    f.api.openDocument({uri: 'test:file.' + extension, language: 'file.' + extension, text: ''});
    assert.equal(f.language(), id(language));
    assert.ok(f.formatters.has(id(language)));
  }
  f.api.openDocument({uri: 'test:notes', language: 'plaintext', text: 'notes'});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.language(), 'plaintext');
  assert.equal(f.formatters.size, 4);

  const input = 'namespace sample;model geography:Elevation;';
  const model = {getLinesContent: () => [input, ''], getLineMaxColumn: () => input.length + 1, getEOL: () => '\r\n'};
  const provider = f.formatters.get(id('Kim'));
  const edits = provider.provideDocumentFormattingEdits(model, {}, {isCancellationRequested: false});
  assert.equal(edits.length, 1);
  assert.equal(edits[0].text, 'namespace sample;\r\nmodel geography:Elevation;');
  assert.equal(edits[0].range.endLineNumber, 1);
  assert.equal(edits[0].range.endColumn, input.length + 1);
  assert.equal(provider.provideDocumentFormattingEdits(model, {}, {isCancellationRequested: true}).length, 0);
});

test('asynchronous save stays dirty until the host acknowledges the persisted snapshot', () => {
  const f = fixture();
  f.api.setSaveAcknowledgementRequired(true);
  f.change('edited'); f.save();
  assert.deepEqual(f.saves, ['edited']);
  assert.equal(f.dirty.at(-1), true);
  f.api.markSaved('edited');
  assert.equal(f.dirty.at(-1), false);
  f.change('newer'); f.api.markSaved('edited');
  assert.equal(f.dirty.at(-1), true);
});

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
