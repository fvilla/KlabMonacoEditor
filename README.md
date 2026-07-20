# KlabMonacoEditor

KlabMonacoEditor embeds the [Monaco Editor](https://microsoft.github.io/monaco-editor/) in a JavaFX
`WebView`. It can be used as a standalone text editor or connected to the k.LAB language server
through LSP4J.

The Monaco JavaScript, CSS, and bridge resources are packaged in the library, so the editor runs
without downloading web assets at runtime.

## Requirements

- Java 21
- JavaFX 21
- Maven 3.9 or the included Maven wrapper

## Add the dependency

```xml
<dependency>
  <groupId>org.integratedmodelling</groupId>
  <artifactId>klab-editor</artifactId>
  <version>1.0-SNAPSHOT</version>
</dependency>
```

For a modular application, add the editor module:

```java
requires org.integratedmodelling.klabeditor;
```

The module exports both `org.integratedmodelling.klabeditor` and
`org.integratedmodelling.klabeditor.lsp`.

## Use the editor without LSP

Create the view on the JavaFX application thread, provide an optional document URI and save
callback, and then load the text:

```java
String documentUri = "inmemory:///examples/hello.txt";

MonacoEditorView editor =
    new MonacoEditorView(
        documentUri,
        text -> {
          // Persist the complete document text here.
        });

editor.loadEditor("Hello, Monaco!\n", "plaintext", "vs-dark");
```

The document URI identifies Monaco's internal model. Use a stable, unique URI for every document.
Both real file URIs such as `path.toUri().toString()` and virtual URIs such as
`inmemory:///project/document.kim` are supported.

The built-in themes are `vs`, `vs-dark`, `hc-black`, and `hc-light`. The language argument is a
Monaco language identifier or a supported k.LAB language identifier. Unknown identifiers fall back
to plain text behavior.

### Listen for editor activity

```java
editor.setOnSave(text -> save(text));
editor.setOnDirtyChanged(dirty -> updateTabTitle(dirty));
editor.setCursorPositionListener(offset -> selectAssetAt(offset));
editor.setChangeListener(text -> inspectLocally(text));
```

`setOnSave` is invoked by <kbd>Ctrl</kbd>+<kbd>S</kbd> or <kbd>Cmd</kbd>+<kbd>S</kbd>. The callback
receives the complete document text. A successful save command also resets the editor's dirty
baseline.

Useful imperative operations include:

```java
editor.setText(updatedText);
String currentText = editor.getText();
editor.setCursorPosition(characterOffset);
editor.requestEditorFocus();
editor.setLineNumbers(false);
```

Calls that affect Monaco can be made before its JavaScript bridge is ready; supported pending state
is replayed when initialization completes.

### Show diagnostics without LSP

Diagnostics can be supplied directly using LSP4J's `Diagnostic` model:

```java
editor.setDiagnostics(diagnostics);
```

For simple markers, use `createMarker` or `createMarkerByOffset`:

```java
editor.createMarker(4, "Check this statement", "warning");
editor.createMarkerByOffset(120, 8, "Unknown identifier", "error");
```

## Use the editor with the k.LAB LSP service

`KlabLspService` is a process bridge for a running k.LAB language-server `LocalInstance`. Initialize
the singleton once, then create one `LspDocumentSession` per open editor document:

```java
String documentUri = "inmemory:///project/example.kim";
String languageId = "kim";
String initialText = loadDocument();

MonacoEditorView editor = new MonacoEditorView(documentUri, this::saveDocument);
editor.loadEditor(initialText, languageId, "vs-dark");

KlabLspService lsp = KlabLspService.getInstance();
LspDocumentSession lspSession = null;

if (lsp.ensureInitialized(languageServerInstance, userScope)) {
  lspSession = new LspDocumentSession(editor, languageId, initialText);
}
```

The session:

- sends `textDocument/didOpen` with the initial text;
- forwards complete editor contents through `textDocument/didChange`;
- routes diagnostics for the editor's URI back to Monaco on the JavaFX thread;
- rejects versioned diagnostics that do not match the current document version; and
- unregisters its callbacks and sends `textDocument/didClose` when closed.

`LspDocumentSession` requires the editor to have a nonblank document URI and requires
`ensureInitialized(...)` to have succeeded. It throws an exception when either precondition is not
met instead of creating a silently disconnected session.

### Dispose the LSP session correctly

Close the session only when the document editor is genuinely closed:

```java
if (lspSession != null) {
  lspSession.close();
  lspSession = null;
}
```

Do **not** use `Node.sceneProperty()` becoming `null` as a disposal signal. JavaFX controls such as
`TabPane` can temporarily detach content while switching tabs or views. Closing the session at that
point sends `didClose` even though the editor remains active. Tie `close()` to the application's real
tab, document, or window-close lifecycle instead. Repeated `close()` calls are safe.

## Highlighting support

The editor can use a highlighter service and preload k.LAB keyword or concept metadata:

```java
editor.setHighlighterServiceUrl("http://localhost:8765");
editor.preloadKeywordHighlighterCache("kim", keywords);
editor.preloadConceptHighlighterCache(conceptCategories);
```

These facilities are independent of `LspDocumentSession`; applications may use them with or without
LSP document synchronization.

## Build and test

On Linux or macOS:

```shell
./mvnw test
```

On Windows:

```powershell
.\mvnw.cmd test
```

The Maven build installs Node.js and npm locally when needed, compiles `monaco-bridge.ts`, packages
the browser resources, compiles the Java module, and runs the tests.

To launch the included demonstration application:

```shell
./mvnw javafx:run
```
