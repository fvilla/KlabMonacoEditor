# Formatting k.LAB documents

Right-click inside the Monaco editor and choose **Format Document**. With the editor focused, press **Shift+Alt+F** on Windows, **Shift+Option+F** on macOS, or **Ctrl+Shift+I** on Linux.

The command formats the whole editable document. It runs locally, and the result is one undoable edit. Save the document as usual to persist the changes.

## Rules by language

| Language | Extensions | Indentation |
| --- | --- | --- |
| k.Worldview | `.kwv` | Four spaces. Ontology and concept declarations start at the left margin. Continued headers, descriptions, and concept clauses indent one level. A wrapped list of children indents one level further. |
| Observation strategies and dataflows | `.obs`, `.observation` | Two spaces. Strategy and dataflow declarations start at the left margin. Continued headers, strategy steps, and block contents indent one level. Nested pattern and dataflow blocks add a level. |
| k.IM | `.kim` | Four spaces. Namespace, model, and definition declarations start at the left margin. Continued headers and model clauses indent one level. Wrapped dependency lists and nested maps add a level. |
| k.Actors | `.kactors`, `.kactor` | Four spaces. Behavior and action headers start at the left margin. Action bodies, groups, and callbacks indent one level. For unbracketed continuations, the formatter uses the existing relative indentation and recognizes callback match lines after a colon. |

Standalone annotations align with their declarations, and multiline arguments indent one level. Closing delimiters that begin a line align with their opener. A top-level semicolon followed by code starts a new line in k.Worldview, observation, and k.IM files. An existing standalone top-level semicolon stays at the left margin.

Existing blank lines and single-line constructs are retained. The formatter removes trailing spaces and tabs outside protected text, preserves the document’s line endings and final newline, and leaves spacing between tokens on the same line as written. Comment text, multiline string contents, embedded expressions, k.IM lookup tables, and k.Actors regular expressions and embedded text are preserved. An unclosed protected region or mismatched structural delimiter leaves the document unchanged.

## Examples

### k.Worldview

~~~text
ontology atmosphere
    version 1.0
    using imod, chemistry
    in domain imod:AtmosphereKnowledge;

identity Air is chemistry:Mixture;

thing AirBody
    "An individuated body of atmospheric air."
    is physical:MaterialBody;
~~~

### Observation strategy and dataflow

~~~text
strategies observations
  version 2.0;

strategy 0 named substantial.direct
  for pattern {
    node {
      kind = subject;
      collective = false;
    }
  }
  ensure request.fully_specified($this)
  observe $this;
~~~

~~~text
dataflow example.replay
  version 1.0
  mode replay;

define observation region {
  observable {{earth:Region}};
  identity "example:region";
};
~~~

### k.IM

~~~text
namespace staging.vxii.basic
    version 1.0;

private model geography:StreambedGradient in degree_angle
    observing
        geography:Elevation in m,
        geography:Slope in degree_angle
    set to [(elevation.max - elevation)/slope];
~~~

### k.Actors

~~~text
behavior vxii.examples.timer
    "Demonstrate temporal event emitters"
    version 1.0
    using core.console as console,
        core.timer as timer

action main:
    timer.in(15.s):
        time -> console.format("# One-off event at %s\n", time)
    timer.tick(5.s):
        time -> console.format("* Regular tick at %s\n", time)
~~~

The examples follow the worldview and strategy sources in the `imod` workspace and the model and behavior sources in `klab.staging.vxii`.
