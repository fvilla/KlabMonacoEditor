package org.integratedmodelling.klabeditor;

import javafx.application.Platform;
import javafx.beans.value.ChangeListener;
import javafx.concurrent.Worker;
import javafx.scene.Node;
import javafx.scene.input.KeyCode;
import javafx.scene.layout.StackPane;
import javafx.scene.web.WebEngine;
import javafx.scene.web.WebView;
import netscape.javascript.JSObject;

import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

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
    private volatile JSObject window;

    // Memorize last requested init so we can re-apply if needed
    private String initialText = "";
    private String initialLanguage = "plaintext";
    private String initialTheme = "vs-dark";

    public MonacoEditorView() {
        this(null);
    }

    public MonacoEditorView(Consumer<String> saveCallback) {
        getChildren().add(webView);
        setPrefSize(800, 600);

        // Ensure WebView fills the container
        webView.setPrefSize(RegionU.width(this), RegionU.height(this));
        RegionU.bindToParent(this, webView);

        // Expose a Java connector for callbacks from JS
        webEngine.getLoadWorker().stateProperty().addListener(pageLoadListener());

        if (saveCallback != null) {
            onKeyPressedProperty().setValue(event -> {
                if (event.isControlDown() && event.getCode() == KeyCode.S) {
                    Thread.ofVirtual().start(() -> saveCallback.accept(getText()));
                }
            });
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

    private ChangeListener<Worker.State> pageLoadListener() {
        return (obs, old, state) -> {
            if (state == Worker.State.SUCCEEDED) {
                pageLoaded.set(true);
                window = (JSObject) webEngine.executeScript("window");

                // Provide a Java connector object callable from JS: window.JavaBridge
                JSObject win = window;
                win.setMember("JavaBridge", new JavaBridge());

                // If we had initial text requested before page loaded, initialize now
                Platform.runLater(() -> initEditor(initialText, initialLanguage, initialTheme));
            }
        };
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
        String js = "window.MonacoBridge && window.MonacoBridge.init(" + jsString(text) + "," + jsString(
                language) + "," + jsString(theme) + ");";
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
     * Optional: ask the bridge to connect to a local LSP server (see comments in TS).
     */
    public void connectLsp(String wsUrl, String languageId) {
        if (wsUrl == null || wsUrl.isBlank()) return;
        String lang = languageId == null ? "" : languageId;
        String js = "window.MonacoBridge && window.MonacoBridge.connectLsp && window.MonacoBridge" +
                ".connectLsp(" + jsString(
                wsUrl) + "," + jsString(lang) + ");";
        safeExec(js);
    }

    // -------------- Java<->JS glue helpers --------------

    private void safeExec(String script) {
        if (!pageLoaded.get()) return; // queueing is handled JS-side in the bridge
        Platform.runLater(() -> {
            try {
                webEngine.executeScript(script);
            } catch (Throwable t) {
                System.err.println("[MonacoEditorView] JS exec failed: " + t.getMessage());
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
            // Currently we rely on JS to queue calls before ready; this is just a hook if needed.
            System.out.println("[MonacoEditorView] Editor ready (JS callback)");
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
