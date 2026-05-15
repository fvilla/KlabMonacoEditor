package org.integratedmodelling.klabeditor;

import com.fasterxml.jackson.databind.ObjectMapper;
import javafx.animation.KeyFrame;
import javafx.animation.Timeline;
import javafx.application.Platform;
import javafx.beans.value.ChangeListener;
import javafx.concurrent.Worker;
import javafx.scene.Node;
import javafx.util.Duration;
import javafx.scene.input.Clipboard;
import javafx.scene.input.ClipboardContent;
import javafx.scene.layout.StackPane;
import javafx.scene.web.WebEngine;
import netscape.javascript.JSObject;
import org.eclipse.lsp4j.Diagnostic;
import org.eclipse.lsp4j.DiagnosticSeverity;
import org.eclipse.lsp4j.Range;

import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;
import java.util.function.Supplier;

/**
 * MonacoEditorView embeds a WebView that hosts the Microsoft Monaco editor and exposes a simple
 * Java<->JavaScript bridge to control it. All JS/CSS assets are expected to be loaded from the Java classpath
 * so the component works fully offline.
 * <p>
 * IMPORTANT: How to include Monaco distribution -------------------------------------------- 1)
 * Download/produce a Monaco Editor distribution, which includes a top-level "vs" folder containing
 * "loader.js", "editor", etc. A simple way is to install via npm and copy the built assets: npm i
 * monaco-editor copy node_modules/monaco-editor/min/vs  ->
 * src/main/resources/org/integratedmodelling/klabeditor/monaco/vs
 * <p>
 * 2) This component loads an HTML page from classpath: /org/integratedmodelling/klabeditor/monaco/index.html
 * That page references "vs/loader.js" relatively, so placing the "vs" directory alongside index.html (same
 * resources folder) will make loading work.
 * <p>
 * 3) The TypeScript bridge lives at: /org/integratedmodelling/klabeditor/monaco/monaco-bridge.ts and is
 * provided compiled as: /org/integratedmodelling/klabeditor/monaco/monaco-bridge.js You can modify the TS
 * file and recompile to JS with your preferred toolchain. For this example, the precompiled JS is shipped and
 * used directly by the HTML.
 * <p>
 * 4) LSP integration: Proper Language Server Protocol support in Monaco requires integration with
 * monaco-languageclient and vscode-ws-jsonrpc, following the architecture explained here:
 * https://github.com/Barahlush/monaco-lsp-guide A bare WebSocket is not enough. The included bridge exposes a
 * stub "connectLsp" method with extensive comments on how to wire it once you bundle the required libraries.
 */
public class MonacoEditorView extends StackPane {

    private final DebugWebView webView = new DebugWebView(false);
    private final WebEngine webEngine = webView.getEngine();

    private final AtomicBoolean pageLoaded = new AtomicBoolean(false);
    /**
     * Set to true when JS calls back JavaBridge.onEditorReady(), confirming that monaco-bridge.js
     * loaded AND the AMD require of vs/editor/editor.main completed. On Windows, either step can
     * silently fail due to classpath URL resolution delays, leaving the editor blank.
     */
    private final AtomicBoolean editorJsReady = new AtomicBoolean(false);

    /** Watchdog Timeline started after each successful page load. Triggers a page reload if the
     *  JS side never calls onEditorReady() within the timeout window. */
    private Timeline readinessWatchdog;
    private int loadRetryCount = 0;
    private static final int MAX_LOAD_RETRIES = 3;
    private static final double READINESS_TIMEOUT_SECONDS = 2.0;

    private volatile JSObject window;
    private Consumer<Integer> cursorPositionListener;
    private Consumer<String> onSaveListener;
    private Consumer<Boolean> onDirtyChangedListener;
    private volatile boolean isDirty;
    private volatile String pendingDiagnosticsJson = null;

    // Memorize last requested init so we can re-apply if needed
    private String initialText = "";
    private String initialLanguage = "plaintext";
    private String initialTheme = "vs-dark";

    private Consumer<String> changeListener;
    private final String documentUri;

    private final JavaBridge javaBridge = new JavaBridge();

    public MonacoEditorView() {
        this(null,null);
    }

    public MonacoEditorView(String documentUri, Consumer<String> saveCallback) {
        this.documentUri = documentUri;
        getChildren().add(webView);
        setPrefSize(800, 600);

        // Ensure WebView fills the container
        webView.setPrefSize(RegionU.width(this), RegionU.height(this));
        RegionU.bindToParent(this, webView);

        // Expose a Java connector for callbacks from JS
        webEngine.getLoadWorker().stateProperty().addListener(pageLoadListener());

        // Store optional save callback to be invoked by Monaco JS bridge (Ctrl/Cmd+S)
        if (saveCallback != null) {
            setOnSave(saveCallback);
        }

        // Load the editor host page from classpath
        URL url = MonacoEditorView.class.getResource("/org/integratedmodelling/klabeditor/monaco/index.html");
        if (url == null) {
            // Helpful message if resources are missing
            String msg = "Missing Monaco resources. Please copy the 'vs' folder from monaco-editor and " +
                    "ensure index.html exists under /org/integratedmodelling/klabeditor/monaco";
            webEngine.loadContent("<html><body><pre>" + escapeHtml(msg) + "</pre></body></html>");
        } else {
            // In debug mode we prefer to open the external browser with query parameters when loadEditor() is called.
            if (!webView.isDebug()) {
                webEngine.load(url.toExternalForm());
            }
        }


    }

    public String getDocumentUri() {
        return documentUri;
    }

    public void setDiagnostics(List<Diagnostic> diagnostics) {
        System.out.println("[MonacoEditorView] setDiagnostics count=" + diagnostics.size());

        try {
            String json = new ObjectMapper().writeValueAsString(diagnostics.stream().map(this::toMarker).toList());
            // Cache last diagnostics so we can replay after load/ready
            pendingDiagnosticsJson = json;
            // Try immediately (will be skipped if not loaded yet)
            safeExec("window.MonacoBridge && window.MonacoBridge.setDiagnostics(" + json + ");");

        } catch (Exception e) {
            System.err.println("[MonacoEditorView] Failed to send diagnostics to JS");
            e.printStackTrace();
        }
    }


    private Map<String, Object> toMarker(Diagnostic d) {
        Range r = d.getRange();
        Map<String, Object> m = new HashMap<>();
        m.put("startLineNumber", r.getStart().getLine() + 1);
        m.put("startColumn",     r.getStart().getCharacter() + 1);
        m.put("endLineNumber",   r.getEnd().getLine() + 1);
        m.put("endColumn",       r.getEnd().getCharacter() + 1);
        m.put("message",         d.getMessage());
        m.put("severity",        mapSeverity(d.getSeverity()));
        m.put("source",          d.getSource());
        return m;
    }

    private int mapSeverity(DiagnosticSeverity severity) {
        if (severity == null) return 1;
        return switch (severity) {
            case Error -> 8;
            case Warning -> 4;
            case Information -> 2;
            case Hint -> 1;
        };
    }

    private ChangeListener<Worker.State> pageLoadListener() {
        return (obs, old, state) -> {
            if (state == Worker.State.SUCCEEDED) {
                pageLoaded.set(true);
                editorJsReady.set(false); // Reset: JS must confirm readiness via onEditorReady()
                window = (JSObject) webEngine.executeScript("window");

                // Provide a Java connector object callable from JS: window.JavaBridge
                JSObject win = window;
                win.setMember("JavaBridge", javaBridge);
                installJsConsoleBridge();
                // Speculative early call: succeeds if MonacoBridge is already defined and AMD is
                // ready. If MonacoBridge isn't available yet the JS guard (&&) silently drops the
                // call; onEditorReady() will re-try once the JS side confirms it is fully ready.
                Platform.runLater(() -> initEditor(initialText, initialLanguage, initialTheme));
                // Start watchdog - if JS never calls back within the timeout we reload the page
                startReadinessWatchdog();
            }
        };
    }

    /**
     * Starts (or restarts) a one-shot Timeline that reloads the editor page when the JS bridge
     * has not confirmed readiness within {@link #READINESS_TIMEOUT_SECONDS}. This covers the
     * Windows-specific failure mode where classpath URL resolution for monaco-bridge.js or
     * vs/editor/editor.main is delayed/silently dropped, leaving the WebView blank.
     * <p>
     * Must be called on the FX application thread.
     */
    private void startReadinessWatchdog() {
        if (readinessWatchdog != null) {
            readinessWatchdog.stop();
        }
        readinessWatchdog = new Timeline(
                new KeyFrame(Duration.seconds(READINESS_TIMEOUT_SECONDS), e -> onWatchdogFired())
        );
        readinessWatchdog.setCycleCount(1);
        readinessWatchdog.play();
    }

    private void onWatchdogFired() {
        if (editorJsReady.get()) {
            return; // Fired just after JS confirmed ready; nothing to do
        }
        if (loadRetryCount >= MAX_LOAD_RETRIES) {
            System.err.println("[MonacoEditorView] Monaco editor did not become ready after "
                    + MAX_LOAD_RETRIES + " retries — giving up.");
            return;
        }
        loadRetryCount++;
        System.out.println("[MonacoEditorView] Editor JS bridge not ready within "
                + (int) READINESS_TIMEOUT_SECONDS + "s — reloading page "
                + "(attempt " + loadRetryCount + "/" + MAX_LOAD_RETRIES + ")");
        pageLoaded.set(false);
        URL url = MonacoEditorView.class.getResource("/org/integratedmodelling/klabeditor/monaco/index.html");
        if (url != null) {
            webEngine.load(url.toExternalForm());
        }
    }

    private void installJsConsoleBridge() {
        String script = """
        (function() {
          if (!window.JavaBridge) { return; }
          try {
            var oldLog = console.log;
            var oldWarn = console.warn;
            var oldError = console.error;

            function send(kind, args) {
              try {
                var msg = Array.prototype.map.call(args, function(a) {
                  try { return String(a); } catch(e) { return "[object]"; }
                }).join(" ");
                window.JavaBridge.logFromJs("[" + kind + "] " + msg);
              } catch(e) {
                // ignore
              }
            }

            console.log = function() {
              if (oldLog) oldLog.apply(console, arguments);
              send("LOG", arguments);
            };
            console.warn = function() {
              if (oldWarn) oldWarn.apply(console, arguments);
              send("WARN", arguments);
            };
            console.error = function() {
              if (oldError) oldError.apply(console, arguments);
              send("ERROR", arguments);
            };
          } catch (e) {
            // swallow
          }
        })();
        """;

        try {
            webEngine.executeScript(script);
        } catch (Throwable t) {
            System.err.println("[MonacoEditorView] Failed to install JS console bridge: " + t.getMessage());
        }
    }

    /**
     * Initialize the editor with provided content and configuration. This can be called multiple times;
     * subsequent calls will update the model text and language.
     */
    public void loadEditor(String text, String language, String theme) {
        if (language == null || language.isBlank()) language = "plaintext";
        if (theme == null || theme.isBlank()) theme = "vs"; // vs-dark
        this.initialText = text == null ? "" : text;
        this.initialLanguage = language;
        this.initialTheme = theme;
        loadRetryCount = 0; // Explicit call from caller — reset retry budget
        if (webView.isDebug()) {
            // Build a classpath URL to index.html with query parameters so the external browser can auto-bootstrap
            URL url = MonacoEditorView.class.getResource("/org/integratedmodelling/klabeditor/monaco/index.html");
            if (url != null) {
                String base = url.toExternalForm();
                String q = "?language=" + URLEncoder.encode(initialLanguage, StandardCharsets.UTF_8)
                        + "&theme=" + URLEncoder.encode(initialTheme, StandardCharsets.UTF_8)
                        + "&text=" + URLEncoder.encode(initialText, StandardCharsets.UTF_8);
                webEngine.load(base + q);
            } else {
                // Fall back to embedded message (even though in debug we don't display it internally)
                String msg = "Missing Monaco resources. Please copy the 'vs' folder from monaco-editor and " +
                        "ensure index.html exists under /org/integratedmodelling/klabeditor/monaco";
                webEngine.loadContent("<html><body><pre>" + escapeHtml(msg) + "</pre></body></html>");
            }
            return;
        }
        if (pageLoaded.get()) {
            initEditor(initialText, initialLanguage, initialTheme);
        }
    }

    private void initEditor(String text, String language, String theme) {
        String uri = (documentUri != null && !documentUri.isBlank())
                ? documentUri
                : "inmemory:///untitled.kim";

        System.out.println(
                "[MonacoEditorView] initEditor uri=" + uri +
                        " language=" + language +
                        " theme=" + theme
        );

        String js = "window.MonacoBridge && window.MonacoBridge.openDocument({"
                + "uri:" + jsString(uri) + ","
                + "language:" + jsString(language) + ","
                + "theme:" + jsString(theme) + ","
                + "text:" + jsString(text)
                + "});";

        safeExec(js);
    }




    /**
     * Set entire editor text.
     */
    public void setText(String text) {
        this.initialText = text == null ? "" : text;
        safeExec("window.MonacoBridge && window.MonacoBridge.setText(" + jsString(initialText) + ");");
    }

    /**
     * Toggle line number visibility.
     */
    public void setLineNumbers(boolean show) {
        safeExec("window.MonacoBridge && window.MonacoBridge.setLineNumbers(" + show + ");");
    }

    /**
     * Query current line numbers visibility. Defaults to true if unknown.
     */
    public boolean isLineNumbersVisible() {
        Object result = safeEval(
                "(window.MonacoBridge && window.MonacoBridge.isLineNumbersVisible) ? window.MonacoBridge" + ".isLineNumbersVisible() : true");
        if (result instanceof Boolean b) return b;
        return true;
    }


    /**
     * Get current text content from the editor.
     *
     * @return Current text content, or empty string if not available
     */
    public String getText() {
        Object result = safeEval(
                "window.MonacoBridge && window.MonacoBridge.getText ? window.MonacoBridge.getText() : ''");
        return result != null ? result.toString() : "";
    }

    /**
     * Set a callback to be invoked when the user triggers Save (Ctrl/Cmd+S) inside Monaco.
     * The full current text will be passed to the consumer.
     */
    public void setOnSave(Consumer<String> onSave) {
        this.onSaveListener = onSave;
    }

    /**
     * Set a callback to be notified when the editor dirty state changes.
     * true means there are unsaved changes; false means the content matches last saved baseline.
     */
    public void setOnDirtyChanged(Consumer<Boolean> onDirtyChanged) {
        this.onDirtyChangedListener = onDirtyChanged;
    }

    /**
     * Current dirty flag as last reported by the JS bridge.
     */
    public boolean isDirty() {
        return isDirty;
    }

    /**
     * Create a marker at a given line. Severity may be one of: info, warning, error, hint.
     */
    public void createMarker(int lineNumber, String message, String severity) {
        String js = "window.MonacoBridge && window.MonacoBridge.createMarker(" + lineNumber + "," + jsString(
                message == null ? "" : message) + "," + jsString(severity == null ? "info" : severity) + ");";
        safeExec(js);
    }

    /**
     * Create a marker at a given character offset position. Severity may be one of: info, warning, error,
     * hint.
     */
    public void createMarkerByOffset(int offset, int length, String message, String severity) {
        String js =
                "window.MonacoBridge && window.MonacoBridge.createMarkerByOffset(" + offset + "," + length + "," + jsString(
                message == null ? "" : message) + "," + jsString(severity == null ? "info" : severity) + ");";
        safeExec(js);
    }

    /**
     * Set the cursor position to a specified character offset in the document and reveal that position.
     *
     * @param offset The character offset position where to place the cursor
     */
    public void setCursorPosition(int offset) {
        String js = "window.MonacoBridge && window.MonacoBridge.setCursorPosition(" + offset + ");";
        safeExec(js);
    }

    /**
     * Set a listener to be notified when the cursor position changes.
     *
     * @param listener Consumer that will receive the new cursor offset, or null to remove listener
     */
    public void setCursorPositionListener(Consumer<Integer> listener) {
        this.cursorPositionListener = listener;
        if (pageLoaded.get()) {
            installCursorPositionHooks();
        }
    }

    private void installCursorPositionHooks() {
        String js = """
                if (window.MonacoBridge && window.MonacoBridge.editor) {
                    window.MonacoBridge.editor.onDidChangeCursorPosition(e => {
                        const offset = window.MonacoBridge.editor.getModel().getOffsetAt(e.position);
                        window.JavaBridge.onCursorPositionChanged(offset);
                    });
                }
                """;
        safeExec(js);
    }

    public void setChangeListener(java.util.function.Consumer<String> listener) {
        this.changeListener = listener;
    }

    // -------------- Java<->JS glue helpers --------------

    private void safeExec(String script) {
        if (!pageLoaded.get()) {
            System.out.println(
                    "[MonacoEditorView] JS exec skipped (page not loaded)"
            );
            return;
        }

        Platform.runLater(() -> {
            try {
                webEngine.executeScript(script);
            } catch (Throwable t) {
                System.err.println(
                        "[MonacoEditorView] JS exec failed: " + script
                );
                t.printStackTrace();
            }
        });
    }


    private Object safeEval(String script) {
        if (!pageLoaded.get()) return null;
        try {
            return webEngine.executeScript(script);
        } catch (Throwable t) {
            System.err.println("[MonacoEditorView] JS eval failed: " + t.getMessage());
            return null;
        }
    }

    // ---------- FX thread helpers ----------
    private static void runOnFxAndWait(Runnable action) {
        if (Platform.isFxApplicationThread()) {
            action.run();
            return;
        }
        CountDownLatch latch = new CountDownLatch(1);
        Platform.runLater(() -> {
            try { action.run(); } finally { latch.countDown(); }
        });
        try { latch.await(); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
    }

    private static <T> T runOnFxAndWait(Supplier<T> supplier) {
        if (Platform.isFxApplicationThread()) {
            return supplier.get();
        }
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<T> ref = new AtomicReference<>();
        Platform.runLater(() -> {
            try { ref.set(supplier.get()); } finally { latch.countDown(); }
        });
        try { latch.await(); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        return ref.get();
    }

    private static String jsString(String s) {
        if (s == null) return "null";
        String esc = s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "");
        return '"' + esc + '"';
    }

    private static String escapeHtml(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }

    /**
     * Object exposed to JS as window.JavaBridge to notify readiness, etc.
     */
    @SuppressWarnings("unused")
    public class JavaBridge {

        public void onEditorReady() {
            System.out.println("[MonacoEditorView] Editor ready (JS callback)");
            editorJsReady.set(true);
            loadRetryCount = 0; // Success — reset retry counter for any future reloads

            // Cancel the watchdog: JS has confirmed the bridge is fully operational.
            // This callback runs on the FX thread (JS->Java call), so Timeline.stop() is safe here.
            if (readinessWatchdog != null) {
                readinessWatchdog.stop();
            }

            // Always (re-)initialize the editor from here. When monaco-bridge.js or the AMD
            // require of vs/editor/editor.main was delayed on Windows, the speculative initEditor()
            // call in the SUCCEEDED handler would have found window.MonacoBridge undefined and
            // been silently dropped. Now that JS confirms full readiness, we guarantee the call goes
            // through. If initEditor() already ran successfully, openDocument() is idempotent and
            // will simply update the model — no visible side-effect.
            Platform.runLater(() -> initEditor(initialText, initialLanguage, initialTheme));

            if (pendingDiagnosticsJson != null) {
                System.out.println("[MonacoEditorView] Replaying pending diagnostics on editor ready");
                safeExec("window.MonacoBridge && window.MonacoBridge.setDiagnostics(" + pendingDiagnosticsJson + ");");
            }
        }

        public void onCursorPositionChanged(int offset) {
            if (cursorPositionListener != null) {
                Platform.runLater(() -> cursorPositionListener.accept(offset));
            }
        }

        public void onSave(String text) {
            if (onSaveListener != null) {
                Platform.runLater(() -> onSaveListener.accept(text == null ? "" : text));
            }
        }

        public void onDirtyChanged(boolean dirty) {
            isDirty = dirty;
            if (onDirtyChangedListener != null) {
                Platform.runLater(() -> onDirtyChangedListener.accept(dirty));
            }
        }

        // -------- Clipboard bridge --------
        public void setClipboardText(String text) {
            runOnFxAndWait(() -> {
                Clipboard clipboard = Clipboard.getSystemClipboard();
                ClipboardContent content = new ClipboardContent();
                content.putString(text == null ? "" : text);
                clipboard.setContent(content);
            });
        }

        public String getClipboardText() {
            return runOnFxAndWait(() -> {
                Clipboard clipboard = Clipboard.getSystemClipboard();
                if (clipboard.hasString()) {
                    String s = clipboard.getString();
                    return s == null ? "" : s;
                }
                return "";
            });
        }

        public void onContentChanged(String text) {
            System.out.println("[JavaBridge] onContentChanged, length=" + (text != null ? text.length() : 0));
            if (changeListener != null) {
                final String safe = (text == null ? "" : text);
                Platform.runLater(() -> changeListener.accept(safe));
            } else {
                System.out.println("[JavaBridge] changeListener is null");
            }
        }

        // -------- JS console bridge --------
        public void logFromJs(String msg) {
            System.out.println("[JS Console] " + msg);
        }
    }

    // Small utility to ensure WebView tracks parent size without external CSS
    private static final class RegionU {
        static double width(Node n) {
            return 800;
        }

        static double height(Node n) {
            return 600;
        }

        static void bindToParent(StackPane parent, DebugWebView child) {
            child.prefWidthProperty().bind(parent.widthProperty());
            child.prefHeightProperty().bind(parent.heightProperty());
        }
    }
}
