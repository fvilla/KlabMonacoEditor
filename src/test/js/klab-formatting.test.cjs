const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const context = vm.createContext({window: {}});
vm.runInContext(fs.readFileSync(path.join(__dirname,
  '../../main/resources/org/integratedmodelling/klabeditor/monaco/monaco-bridge.js'), 'utf8'), context);
const {lineEdits} = context.KlabFormatting;

function verify(language, input, expected) {
  const lines = input.split('\n');
  for (const edit of lineEdits(lines, language).reverse()) {
    lines.splice(edit.line - 1, 1, ...edit.text);
  }
  assert.equal(lines.join('\n'), expected);
  assert.equal(lineEdits(lines, language).length, 0);
}

test('worldview annotations, concept lists and multiline definitions keep their structure', () => {
  verify('worldview',
    ' ontology sample\n\tversion 1.0;@review(\nrecord="some;thing"\n)\nthing Example\n"Description\n  second line  "\nhas disjoint children\n(First ""),\n(Second "")\n;\n',
    'ontology sample\n    version 1.0;\n@review(\n    record="some;thing"\n)\nthing Example\n    "Description\n  second line  "\n    has disjoint children\n        (First ""),\n        (Second "")\n;\n');
});

test('observation declarations and nested pattern and dataflow blocks use two spaces', () => {
  verify('observation',
    ' strategies sample\nversion 2.0; strategy 0 named direct\nfor pattern {\nnode {\nkind = subject;\ncollective = false;\n}\n}\nobserve $this;\n',
    'strategies sample\n  version 2.0;\nstrategy 0 named direct\n  for pattern {\n    node {\n      kind = subject;\n      collective = false;\n    }\n  }\n  observe $this;\n');
  verify('observation',
    'dataflow sample version 1.0 mode replay;define observation item {\nobservable {{earth:Region}};\nidentity "some;thing";\n};',
    'dataflow sample version 1.0 mode replay;\ndefine observation item {\n  observable {{earth:Region}};\n  identity "some;thing";\n};');
});

test('k.IM preserves embedded expressions, table cells and comment text', () => {
  verify('kim',
    'namespace sample;\n model geography:Elevation\nobserving\ngeography:Slope,\ngeography:Aspect\nset to [source // opaque\n  value + "\\]"  ] ;  \nmodel geography:Elevation\nlookup into ===\n  x | y  \n  ===;\n // keep comment spacing  ',
    'namespace sample;\nmodel geography:Elevation\n    observing\n        geography:Slope,\n        geography:Aspect\n    set to [source // opaque\n  value + "\\]"  ] ;\nmodel geography:Elevation\n    lookup into ===\n  x | y  \n  ===;\n// keep comment spacing  ');
});

test('k.Actors recognizes unindented callback matches and preserves regex and raw text', () => {
  verify('kactor',
    ' behavior sample\nversion 1.0\n action main:\nbutton("Go"):\n%[(;)}]% -> console.log("Done")\nuser.login()\n%%%\n  raw content  \n%%%\n',
    'behavior sample\n    version 1.0\naction main:\n    button("Go"):\n        %[(;)}]% -> console.log("Done")\n    user.login()\n    %%%\n  raw content  \n%%%\n');
});

test('unclosed protected regions or mismatched blocks suppress all edits', () => {
  assert.equal(lineEdits([' namespace example;', ' model X set to [unclosed'], 'kim').length, 0);
  assert.equal(lineEdits([' strategies sample version 2;', 'for pattern {)'], 'observation').length, 0);
});
