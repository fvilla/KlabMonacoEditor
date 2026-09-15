package org.integratedmodelling.klabeditor;

import com.fasterxml.jackson.databind.ObjectMapper;
import javafx.animation.KeyFrame;
import javafx.animation.Timeline;
import javafx.application.Platform;
import javafx.beans.value.ChangeListener;
import javafx.concurrent.Worker;
import javafx.scene.Node;
import javafx.scene.input.Clipboard;
import javafx.scene.input.ClipboardContent;
import javafx.scene.layout.BorderPane;
import javafx.scene.layout.HBox;
import javafx.scene.layout.Priority;
import javafx.scene.layout.Region;
import javafx.scene.layout.StackPane;
import javafx.scene.web.WebEngine;
import javafx.util.Duration;
import netscape.javascript.JSObject;
import org.eclipse.lsp4j.Diagnostic;
import org.eclipse.lsp4j.DiagnosticSeverity;
import org.eclipse.lsp4j.Range;
import org.integratedmodelling.klab.api.exceptions.KlabIllegalArgumentException;
import org.integratedmodelling.klab.api.services.runtime.Notification;
import org.integratedmodelling.klabeditor.lsp.KlabLspService;

import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.*;
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
    private final BorderPane editorLayout = new BorderPane();
    private final EnumMap<EditorBar, BarLayout> bars = new EnumMap<>(EditorBar.class);
    private boolean barsConfigured;

    private final AtomicBoolean pageLoaded = new AtomicBoolean(false);
    /**
     * Set to true when JS calls back JavaBridge.onEditorReady(), confirming that monaco-bridge.js
     * loaded AND the AMD require of vs/editor/editor.main completed. On Windows, either step can
     * silently fail due to classpath URL resolution delays, leaving the editor blank.
     */
    private final AtomicBoolean editorJsReady = new AtomicBoolean(false);

    /**
     * Watchdog Timeline started after each successful page load. Triggers a page reload if the
     * JS side never calls onEditorReady() within the timeout window.
     */
    private Timeline readinessWatchdog;
    private int loadRetryCount = 0;
    private static final int MAX_LOAD_RETRIES = 3;
    private static final double READINESS_TIMEOUT_SECONDS = 2.0;

    private volatile JSObject window;
    private Consumer<Integer> cursorPositionListener;
    private Consumer<String> onSaveListener;
    private Consumer<Boolean> onDirtyChangedListener;
    private Consumer<ReviewMarkerClick> reviewMarkerClickListener;
    private Consumer<Integer> reviewMarginDoubleClickListener;
    private volatile boolean isDirty;
    private volatile String pendingDiagnosticsJson = null;
    private volatile Integer pendingCursorOffset = null;
    private volatile boolean pendingEditorFocus = false;
    private volatile String pendingConceptHighlighterJson = null;
    private volatile String pendingKeywordHighlighterJson = null;
    private volatile String pendingReviewMarkersJson = "[]";
    private volatile boolean reviewMode;
    private final Map<String, ReviewMarker> reviewMarkers = new LinkedHashMap<>();
    private final Map<String, List<String>> pendingKeywordHighlighterCache = new HashMap<>();
    private final List<Runnable> editorRenderedCallbacks = new ArrayList<>();
    private boolean editorRendered;

    // Memorize last requested init so we can re-apply if needed
    private String initialText = "";
    private String initialLanguage = "plaintext";
    private String initialTheme = "vs-dark";
    private boolean showLineNumbers = true;
    private boolean showMinimap = true;
    private String highlighterServiceUrl = "http://localhost:8765";

    private Consumer<String> changeListener;
    private final String documentUri;

    private final JavaBridge javaBridge = new JavaBridge();

    public MonacoEditorView() {
        this(null, null);
    }

    public MonacoEditorView(int highlighterServicePort) {
        this(null, null);
        setHighlighterServicePort(highlighterServicePort);
    }

    public MonacoEditorView(String documentUri, Consumer<String> saveCallback) {
        this.documentUri = documentUri;
        getStyleClass().add("monaco-editor-view");
        URL stylesheet = MonacoEditorView.class.getResource(
                "/org/integratedmodelling/klabeditor/monaco-editor-view.css");
        if (stylesheet != null) {
            getStylesheets().add(stylesheet.toExternalForm());
        }

        editorLayout.setCenter(webView);
        getChildren().add(editorLayout);
        setPrefSize(800, 600);

        // BorderPane allocates all space not used by optional bars to the WebView.
        webView.setMaxSize(Double.MAX_VALUE, Double.MAX_VALUE);

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
            // In debug mode we prefer to open the external browser with query parameters when loadEditor()
            // is called.
            if (!webView.isDebug()) {
                webEngine.load(url.toExternalForm());
            }
        }
    }

    /** The two optional component bars surrounding the editor. */
    public enum EditorBar {
        HEADER, STATUS
    }

    /** Horizontal placement of a component within an editor bar. */
    public enum BarSide {
        LEFT, RIGHT
    }

    /**
     * A fully initialized JavaFX node and its placement within a bar.
     *
     * @param node component to install; a node can belong to only one JavaFX parent
     * @param side side on which the component is aligned
     */
    public record BarComponent(Node node, BarSide side) {
        public BarComponent {
            Objects.requireNonNull(node, "node");
            Objects.requireNonNull(side, "side");
        }
    }

    /**
     * Components to install in the top bar. Subclasses may override this callback; returning an
     * empty collection keeps the header bar absent.
     */
    protected Collection<BarComponent> createHeaderBarComponents() {
        return List.of();
    }

    /**
     * Components to install in the bottom bar. Subclasses may override this callback; returning an
     * empty collection keeps the status bar absent.
     */
    protected Collection<BarComponent> createStatusBarComponents() {
        return List.of();
    }

    /**
     * Install a component in either bar. This may be called by bar-definition callbacks or later on
     * the JavaFX application thread. The requested bar is created lazily.
     */
    protected final void installBarComponent(EditorBar bar, BarComponent component) {
        Objects.requireNonNull(bar, "bar");
        Objects.requireNonNull(component, "component");
        if (!Platform.isFxApplicationThread()) {
            throw new IllegalStateException("Editor bar components must be installed on the JavaFX thread");
        }

        BarLayout layout = bars.computeIfAbsent(bar, this::createBar);
        HBox target = component.side() == BarSide.LEFT ? layout.left() : layout.right();
        target.getChildren().add(component.node());
    }

    private BarLayout createBar(EditorBar bar) {
        HBox left = new HBox();
        HBox right = new HBox();
        Region spacer = new Region();
        HBox.setHgrow(spacer, Priority.ALWAYS);

        HBox container = new HBox(left, spacer, right);
        container.getStyleClass().addAll("monaco-editor-bar",
                bar == EditorBar.HEADER ? "monaco-editor-header-bar" : "monaco-editor-status-bar");
        left.getStyleClass().addAll("monaco-editor-bar-section", "left");
        right.getStyleClass().addAll("monaco-editor-bar-section", "right");

        if (bar == EditorBar.HEADER) {
            editorLayout.setTop(container);
        } else {
            editorLayout.setBottom(container);
        }
        return new BarLayout(left, right);
    }

    private void configureBars() {
        if (barsConfigured) {
            return;
        }
        barsConfigured = true;
        installBarComponents(EditorBar.HEADER, createHeaderBarComponents());
        installBarComponents(EditorBar.STATUS, createStatusBarComponents());
    }

    private void installBarComponents(EditorBar bar, Collection<BarComponent> components) {
        if (components == null) {
            return;
        }
        for (BarComponent component : components) {
            installBarComponent(bar, Objects.requireNonNull(component,
                    "Bar component collections must not contain null"));
        }
    }

    @Override
    protected void layoutChildren() {
        // The first layout happens after subclass construction, avoiding overridable callbacks from
        // the MonacoEditorView constructor.
        configureBars();
        super.layoutChildren();
    }

    private record BarLayout(HBox left, HBox right) {
    }

    public String getDocumentUri() {
        return documentUri;
    }

    public void setHighlighterServicePort(int port) {
        if (port <= 0 || port > 65535) {
            throw new KlabIllegalArgumentException("Invalid highlighter service port: " + port);
        }
        setHighlighterServiceUrl("http://localhost:" + port);
    }

    public void setHighlighterServiceUrl(String highlighterServiceUrl) {
        if (highlighterServiceUrl == null || highlighterServiceUrl.isBlank()) {
            this.highlighterServiceUrl = "http://localhost:8765";
        } else {
            this.highlighterServiceUrl = highlighterServiceUrl.replaceAll("/+$", "");
        }
        safeExec("window.MonacoBridge && window.MonacoBridge.configureHighlighter(" + jsString(
                this.highlighterServiceUrl) + ");");
        replayPendingHighlighterCaches();
    }

    public String getHighlighterServiceUrl() {
        return highlighterServiceUrl;
    }

    public void preloadConceptHighlighterCache(Map<String, String> conceptCategories) {
        if (conceptCategories == null || conceptCategories.isEmpty()) {
            return;
        }
        try {
            String json = new ObjectMapper().writeValueAsString(conceptCategories);
            pendingConceptHighlighterJson = json;
            safeExec(
                    "window.MonacoBridge && window.MonacoBridge.preloadConceptHighlighterCache(" + json +
                            ");");
        } catch (Exception e) {
            System.err.println("[MonacoEditorView] Failed to preload concept highlighter cache");
            e.printStackTrace();
        }
    }

    public void preloadConceptHighlighterCache(List<String> concepts) {
        if (concepts == null || concepts.isEmpty()) {
            return;
        }
        try {
            String json = new ObjectMapper().writeValueAsString(concepts);
            pendingConceptHighlighterJson = json;
            safeExec(
                    "window.MonacoBridge && window.MonacoBridge.preloadConceptHighlighterCache(" + json +
                            ");");
        } catch (Exception e) {
            System.err.println("[MonacoEditorView] Failed to preload concept highlighter cache");
            e.printStackTrace();
        }
    }

    public void preloadKeywordHighlighterCache(String language, List<String> keywords) {
        if (language == null || language.isBlank() || keywords == null || keywords.isEmpty()) {
            return;
        }
        preloadKeywordHighlighterCache(Map.of(language, keywords));
    }

    public void preloadKeywordHighlighterCache(Map<String, List<String>> languageKeywords) {
        if (languageKeywords == null || languageKeywords.isEmpty()) {
            return;
        }
        try {
            Map<String, List<String>> sanitized = new HashMap<>();
            for (Map.Entry<String, List<String>> entry : languageKeywords.entrySet()) {
                if (entry.getKey() == null || entry.getKey().isBlank() || entry.getValue() == null) {
                    continue;
                }
                List<String> keywords = entry.getValue().stream().filter(Objects::nonNull).filter(
                        keyword -> !keyword.isBlank()).distinct().toList();
                if (!keywords.isEmpty()) {
                    sanitized.put(entry.getKey(), keywords);
                }
            }
            if (sanitized.isEmpty()) {
                return;
            }

            pendingKeywordHighlighterCache.putAll(sanitized);
            String json = new ObjectMapper().writeValueAsString(pendingKeywordHighlighterCache);
            pendingKeywordHighlighterJson = json;
            safeExec(
                    "window.MonacoBridge && window.MonacoBridge.preloadKeywordHighlighterCache(" + json +
                            ");");
        } catch (Exception e) {
            System.err.println("[MonacoEditorView] Failed to preload keyword highlighter cache");
            e.printStackTrace();
        }
    }

    public void setDiagnostics(List<Diagnostic> diagnostics) {
        System.out.println("[MonacoEditorView] setDiagnostics count=" + diagnostics.size());

        try {
            String json = new ObjectMapper().writeValueAsString(
                    diagnostics.stream().map(this::toMarker).toList());
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
        m.put("startColumn", r.getStart().getCharacter() + 1);
        m.put("endLineNumber", r.getEnd().getLine() + 1);
        m.put("endColumn", r.getEnd().getCharacter() + 1);
        m.put("message", d.getMessage());
        m.put("severity", mapSeverity(d.getSeverity()));
        m.put("source", d.getSource());
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
                resetEditorRendered();
                window = (JSObject) webEngine.executeScript("window");

                // Provide a Java connector object callable from JS: window.JavaBridge
                JSObject win = window;
                win.setMember("JavaBridge", javaBridge);
                installJsConsoleBridge();
                // Start watchdog - if JS never calls back within the timeout we reload the page
                startReadinessWatchdog();
                notifyBridgeIfAlreadyReady();
            }
        };
    }

    private void notifyBridgeIfAlreadyReady() {
        try {
            webEngine.executeScript("""
                    window.MonacoBridge
                    && window.MonacoBridge._notifyJavaReady
                    && window.MonacoBridge._notifyJavaReady();
                    """);
        } catch (Throwable t) {
            System.err.println(
                    "[MonacoEditorView] Failed to request JS ready notification: " + t.getMessage());
        }
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
                new KeyFrame(Duration.seconds(READINESS_TIMEOUT_SECONDS), e -> onWatchdogFired()));
        readinessWatchdog.setCycleCount(1);
        readinessWatchdog.play();
    }

    private void onWatchdogFired() {
        if (editorJsReady.get()) {
            return; // Fired just after JS confirmed ready; nothing to do
        }
        if (loadRetryCount >= MAX_LOAD_RETRIES) {
            System.err.println(
                    "[MonacoEditorView] Monaco editor did not become ready after " + MAX_LOAD_RETRIES + " " + "retries — giving up.");
            return;
        }
        loadRetryCount++;
        System.out.println(
                "[MonacoEditorView] Editor JS bridge not ready within " + (int) READINESS_TIMEOUT_SECONDS + "s — reloading page " + "(attempt " + loadRetryCount + "/" + MAX_LOAD_RETRIES + ")");
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
     * Convert notifications with a lexical context to markers.
     *
     * @param notifications
     */
    public void markNotifications(Collection<Notification> notifications, boolean clearMarkersBefore) {
        if (clearMarkersBefore) {
            clearMarkers();
        }
        for (var n : notifications) {
            if (n.getLexicalContext() != null) {
                markNotification(n.getLexicalContext(), n.getLevel(), n.getMessage());
            }
        }
    }

    private void markNotification(Notification.LexicalContext lexicalContext, Notification.Level level,
                                  String message) {
        createMarkerByOffset(lexicalContext.getOffsetInDocument(), lexicalContext.getLength(), message,
                switch (level) {
                    case Debug, Info -> "info";
                    case Warning -> "warning";
                    case Error, SystemError -> "error";
                });
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
        resetEditorRendered();
        loadRetryCount = 0; // Explicit call from caller — reset retry budget
        if (webView.isDebug()) {
            // Build a classpath URL to index.html with query parameters so the external browser can
            // auto-bootstrap
            URL url = MonacoEditorView.class.getResource(
                    "/org/integratedmodelling/klabeditor/monaco/index.html");
            if (url != null) {
                String base = url.toExternalForm();
                String q = "?language=" + URLEncoder.encode(initialLanguage,
                        StandardCharsets.UTF_8) + "&theme=" + URLEncoder.encode(
                        initialTheme, StandardCharsets.UTF_8) + "&highlighterServiceUrl=" + URLEncoder.encode(
                        highlighterServiceUrl, StandardCharsets.UTF_8) + "&text=" + URLEncoder.encode(
                        initialText, StandardCharsets.UTF_8);
                webEngine.load(base + q);
            } else {
                // Fall back to embedded message (even though in debug we don't display it internally)
                String msg = "Missing Monaco resources. Please copy the 'vs' folder from monaco-editor and "
                        + "ensure index.html exists under /org/integratedmodelling/klabeditor/monaco";
                webEngine.loadContent("<html><body><pre>" + escapeHtml(msg) + "</pre></body></html>");
            }
            return;
        }
        if (pageLoaded.get()) {
            initEditor(initialText, initialLanguage, initialTheme);
        }
    }

    private void initEditor(String text, String language, String theme) {

        String uri = (documentUri != null && !documentUri.isBlank()) ? documentUri :
                "inmemory:///untitled" + ".kim";
        var keywords = KlabLspService.getInstance().getLanguageKeywords(language);
        if (keywords != null && !keywords.isEmpty()) {
            preloadKeywordHighlighterCache(language, keywords);
        }
        preloadConceptHighlighterCache(KlabLspService.getInstance().getConceptCache());

        //        System.out.println(
        //                "[MonacoEditorView] initEditor uri=" + uri + " language=" + language + " theme=" +
        //                theme);

        String js = "window.MonacoBridge && window.MonacoBridge.openDocument({" + "uri:" + jsString(
                uri) + "," + "language:" + jsString(language) + "," + "theme:" + jsString(
                theme) + "," + "showLineNumbers:" + showLineNumbers + "," + "minimapVisible:" +
                showMinimap + "," + "highlighterServiceUrl:" + jsString(
                highlighterServiceUrl) + "," + "text:" + jsString(text) + "});";

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
        showLineNumbers = show;
        safeExec("window.MonacoBridge && window.MonacoBridge.setLineNumbers(" + show + ");");
    }

    /**
     * Query current line numbers visibility. Defaults to true if unknown.
     */
    public boolean isLineNumbersVisible() {
        return showLineNumbers;
    }

    /** Change the active Monaco theme without recreating the document model. */
    public void setTheme(String theme) {
        if (theme == null || theme.isBlank()) {
            throw new IllegalArgumentException("Monaco theme must not be blank");
        }
        initialTheme = theme;
        safeExec("window.MonacoBridge && window.MonacoBridge.setTheme(" + jsString(theme) + ");");
    }

    /** Return the last theme requested through {@link #loadEditor} or {@link #setTheme}. */
    public String getTheme() {
        return initialTheme;
    }

    /** Toggle Monaco's document minimap. */
    public void setMinimapVisible(boolean show) {
        showMinimap = show;
        safeExec("window.MonacoBridge && window.MonacoBridge.setMinimapVisible(" + show + ");");
    }

    /** Return the requested minimap visibility, including requests made before Monaco was ready. */
    public boolean isMinimapVisible() {
        return showMinimap;
    }

    /**
     * A clickable marker displayed in Monaco's glyph margin while review mode is enabled.
     *
     * @param id             unique, stable marker identifier
     * @param lineNumber     one-based document line
     * @param icon           text glyph to display (for example "●", "?", or "✓")
     * @param color          any CSS color understood by the embedded browser
     * @param size           icon size in pixels (clamped to 8..32 by the JavaScript bridge)
     * @param tooltip        optional hover text
     * @param action         optional application-defined action identifier
     * @param responsibility optional application-defined owner or responsibility identifier
     */
    public record ReviewMarker(String id, int lineNumber, String icon, String color, int size,
                               String tooltip, String action, String responsibility) {
        public ReviewMarker(String id, int lineNumber, String icon, String color, int size,
                            String tooltip) {
            this(id, lineNumber, icon, color, size, tooltip, null, null);
        }

        public ReviewMarker(String id, int lineNumber) {
            this(id, lineNumber, "●", "#4f8cff", 16, null, null, null);
        }

        public ReviewMarker {
            if (id == null || id.isBlank()) {
                throw new IllegalArgumentException("Review marker id must not be blank");
            }
            if (lineNumber < 1) {
                throw new IllegalArgumentException("Review marker lineNumber must be at least 1");
            }
        }
    }

    /**
     * Information reported when a review marker is clicked.
     */
    public record ReviewMarkerClick(String id, int lineNumber, String action, String responsibility) {
    }

    /**
     * Enable or disable review mode. The glyph margin and its review markers are only visible while
     * review mode is enabled; configured markers are retained when it is disabled.
     */
    public void setReviewMode(boolean enabled) {
        reviewMode = enabled;
        safeExec("window.MonacoBridge && window.MonacoBridge.setReviewMode(" + enabled + ");");
    }

    public boolean isReviewMode() {
        return reviewMode;
    }

    /**
     * Replace all review markers. Duplicate ids are rejected.
     */
    public void setReviewMarkers(Collection<ReviewMarker> markers) {
        Objects.requireNonNull(markers, "markers");
        Map<String, ReviewMarker> replacement = new LinkedHashMap<>();
        for (ReviewMarker marker : markers) {
            Objects.requireNonNull(marker, "markers must not contain null");
            if (replacement.putIfAbsent(marker.id(), marker) != null) {
                throw new IllegalArgumentException("Duplicate review marker id: " + marker.id());
            }
        }
        synchronized (reviewMarkers) {
            reviewMarkers.clear();
            reviewMarkers.putAll(replacement);
            serializeAndReplayReviewMarkers();
        }
    }

    /**
     * Add or replace one review marker, identified by its id.
     */
    public void putReviewMarker(ReviewMarker marker) {
        Objects.requireNonNull(marker, "marker");
        synchronized (reviewMarkers) {
            reviewMarkers.put(marker.id(), marker);
            serializeAndReplayReviewMarkers();
        }
    }

    /**
     * Remove one review marker by id.
     */
    public void removeReviewMarker(String id) {
        if (id == null) return;
        synchronized (reviewMarkers) {
            if (reviewMarkers.remove(id) != null) {
                serializeAndReplayReviewMarkers();
            }
        }
    }

    private void serializeAndReplayReviewMarkers() {
        try {
            pendingReviewMarkersJson = new ObjectMapper().writeValueAsString(reviewMarkers.values());
            replayReviewMarkers();
        } catch (Exception e) {
            throw new IllegalArgumentException("Could not serialize review markers", e);
        }
    }

    /**
     * Remove all configured review markers without changing review mode.
     */
    public void clearReviewMarkers() {
        synchronized (reviewMarkers) {
            reviewMarkers.clear();
            pendingReviewMarkersJson = "[]";
            safeExec("window.MonacoBridge && window.MonacoBridge.clearReviewMarkers();");
        }
    }

    /**
     * Set the callback invoked on the JavaFX application thread when a review marker is clicked.
     */
    public void setOnReviewMarkerClicked(Consumer<ReviewMarkerClick> listener) {
        reviewMarkerClickListener = listener;
    }

    /**
     * Set the callback invoked when the user double-clicks an empty glyph-margin cell in review
     * mode. The consumer receives the one-based document line number on the JavaFX application
     * thread. Double-clicks directly on an existing review marker are excluded.
     */
    public void setOnReviewMarginDoubleClicked(Consumer<Integer> listener) {
        reviewMarginDoubleClickListener = listener;
    }

    private void replayReviewMarkers() {
        safeExec("window.MonacoBridge && window.MonacoBridge.setReviewMarkers(" +
                pendingReviewMarkersJson + ");");
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
     * Establish the current contents as the saved baseline. Call this after a successful save
     * initiated outside Monaco's built-in Ctrl/Cmd+S command, such as from a header-bar button.
     */
    public void markSaved() {
        safeExec("window.MonacoBridge && window.MonacoBridge.markSaved();");
    }

    /**
     * Establish a specific successfully persisted snapshot as the saved baseline. This overload is
     * suitable for asynchronous saves: edits made while the save is in flight remain dirty.
     */
    public void markSaved(String savedText) {
        String baseline = savedText == null ? "" : savedText;
        initialText = baseline;
        safeExec("window.MonacoBridge && window.MonacoBridge.markSaved(" + jsString(baseline) + ");");
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
     * Run {@code callback} once the current document has been rendered by Monaco. Callbacks
     * registered before the document is rendered are queued; callbacks registered afterwards
     * run on the next JavaFX pulse.
     *
     * @param callback work to run on the JavaFX application thread
     */
    public void runAfterEditorRendered(Runnable callback) {
        Objects.requireNonNull(callback, "callback");
        synchronized (editorRenderedCallbacks) {
            if (!editorRendered) {
                editorRenderedCallbacks.add(callback);
                return;
            }
        }
        Platform.runLater(callback);
    }

    private void resetEditorRendered() {
        synchronized (editorRenderedCallbacks) {
            editorRendered = false;
        }
    }

    private void notifyEditorRendered() {
        List<Runnable> callbacks;
        synchronized (editorRenderedCallbacks) {
            if (editorRendered) {
                return;
            }
            editorRendered = true;
            callbacks = new ArrayList<>(editorRenderedCallbacks);
            editorRenderedCallbacks.clear();
        }
        for (Runnable callback : callbacks) {
            Platform.runLater(callback);
        }
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
     * Remove all markers created through {@link #createMarker(int, String, String)} or
     * {@link #createMarkerByOffset(int, int, String, String)} from the active document.
     * Language-server diagnostics are managed separately and are not affected.
     */
    public void clearMarkers() {
        safeExec("window.MonacoBridge && window.MonacoBridge.clearMarkers();");
    }

    /**
     * Set the cursor position to a specified character offset in the document and reveal that position.
     *
     * @param offset The character offset position where to place the cursor
     */
    public void setCursorPosition(int offset) {
        pendingCursorOffset = Math.max(0, offset);
        if (editorJsReady.get()) {
            replayPendingCursorPosition();
        }
    }

    private void replayPendingCursorPosition() {
        Integer offset = pendingCursorOffset;
        if (offset == null) {
            return;
        }
        pendingCursorOffset = null;
        safeExec("window.MonacoBridge && window.MonacoBridge.setCursorPosition(" + offset + ");");
    }

    /**
     * Give keyboard focus to the embedded Monaco editor, replaying the request if it is still loading.
     */
    public void requestEditorFocus() {
        pendingEditorFocus = true;
        replayPendingEditorFocus();
    }

    private void replayPendingEditorFocus() {
        if (!pendingEditorFocus || !editorJsReady.get()) {
            return;
        }
        pendingEditorFocus = false;
        webView.requestFocus();
        safeExec("window.MonacoBridge && window.MonacoBridge.focusEditor();");
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
            System.out.println("[MonacoEditorView] JS exec skipped (page not loaded)");
            return;
        }

        Platform.runLater(() -> {
            try {
                webEngine.executeScript(script);
            } catch (Throwable t) {
                System.err.println("[MonacoEditorView] JS exec failed: " + script);
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
            try {
                action.run();
            } finally {
                latch.countDown();
            }
        });
        try {
            latch.await();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private static <T> T runOnFxAndWait(Supplier<T> supplier) {
        if (Platform.isFxApplicationThread()) {
            return supplier.get();
        }
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<T> ref = new AtomicReference<>();
        Platform.runLater(() -> {
            try {
                ref.set(supplier.get());
            } finally {
                latch.countDown();
            }
        });
        try {
            latch.await();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        return ref.get();
    }

    private static String jsString(String s) {
        if (s == null) return "null";
        String esc = s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "");
        return '"' + esc + '"';
    }

    private void replayPendingHighlighterCaches() {
        if (pendingConceptHighlighterJson != null) {
            safeExec(
                    "window.MonacoBridge && window.MonacoBridge.preloadConceptHighlighterCache(" + pendingConceptHighlighterJson + ");");
        }
        if (pendingKeywordHighlighterJson != null) {
            safeExec(
                    "window.MonacoBridge && window.MonacoBridge.preloadKeywordHighlighterCache(" + pendingKeywordHighlighterJson + ");");
        }
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
            boolean firstReadySignal = editorJsReady.compareAndSet(false, true);
            loadRetryCount = 0; // Success — reset retry counter for any future reloads

            // Cancel the watchdog: JS has confirmed the bridge is fully operational.
            // This callback runs on the FX thread (JS->Java call), so Timeline.stop() is safe here.
            if (readinessWatchdog != null) {
                readinessWatchdog.stop();
            }

            if (!firstReadySignal) {
                return;
            }

            // Initialize the editor only on the first ready signal after a page load. JS may emit
            // additional ready callbacks, and treating each one as a new initialization request can
            // recursively reopen the document.
            replayPendingHighlighterCaches();
            Platform.runLater(() -> {
                initEditor(initialText, initialLanguage, initialTheme);
                safeExec("window.MonacoBridge && window.MonacoBridge.setLineNumbers(" +
                        showLineNumbers + ");");
                safeExec("window.MonacoBridge && window.MonacoBridge.setMinimapVisible(" +
                        showMinimap + ");");
                safeExec("window.MonacoBridge && window.MonacoBridge.setReviewMode(" + reviewMode + ");");
                replayReviewMarkers();
                replayPendingCursorPosition();
                replayPendingEditorFocus();
                // initEditor and setDiagnostics both enqueue JavaScript work through safeExec. Keep
                // them in this task and in this order so openDocument creates the Monaco model before
                // markers are applied. Replaying diagnostics outside this task races ahead of model
                // creation on the first load and silently drops the initial markers.
                if (pendingDiagnosticsJson != null) {
                    System.out.println("[MonacoEditorView] Replaying pending diagnostics on editor ready");
                    safeExec(
                            "window.MonacoBridge && window.MonacoBridge.setDiagnostics(" + pendingDiagnosticsJson + ");");
                }
            });
        }

        public void onEditorRendered() {
            notifyEditorRendered();
        }

        public void onCursorPositionChanged(int offset) {
            if (cursorPositionListener != null) {
                Platform.runLater(() -> cursorPositionListener.accept(offset));
            }
        }

        public void onSave(String text) {
            String savedText = text == null ? "" : text;
            initialText = savedText;
            if (onSaveListener != null) {
                Platform.runLater(() -> onSaveListener.accept(savedText));
            }
        }

        public void onSavedBaselineChanged(String text) {
            initialText = text == null ? "" : text;
        }

        public void onDirtyChanged(boolean dirty) {
            isDirty = dirty;
            if (onDirtyChangedListener != null) {
                Platform.runLater(() -> onDirtyChangedListener.accept(dirty));
            }
        }

        public void onReviewMarkerClicked(String id, int lineNumber, String action,
                                          String responsibility) {
            Consumer<ReviewMarkerClick> listener = reviewMarkerClickListener;
            if (listener != null) {
                ReviewMarkerClick click = new ReviewMarkerClick(id, lineNumber, action, responsibility);
                Platform.runLater(() -> listener.accept(click));
            }
        }

        public void onReviewMarginDoubleClicked(int lineNumber) {
            Consumer<Integer> listener = reviewMarginDoubleClickListener;
            if (listener != null && lineNumber > 0) {
                Platform.runLater(() -> listener.accept(lineNumber));
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

}
