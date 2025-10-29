package org.integratedmodelling.klabeditor;

import javafx.application.Platform;
import javafx.concurrent.Worker;
import javafx.scene.layout.StackPane;
import javafx.scene.web.WebEngine;
import javafx.scene.web.WebView;

import java.awt.*;
import java.io.IOException;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;
import java.util.Objects;

/**
 * A JavaFX component that mimics {@link WebView} usage but, when constructed with {@code debug=true},
 * redirects all web navigation to the system default browser instead of rendering inside the app.
 * When {@code debug=false}, it embeds a standard {@link WebView} and behaves visually like it.
 *
 * <p>Usage:
 * <pre>
 *   // Normal behavior (embedded WebView)
 *   DebugWebView webView = new DebugWebView(false);
 *   webView.getEngine().load("https://example.com");
 *
 *   // Debug behavior: any engine.load("https://...") opens the OS browser
 *   DebugWebView debugWebView = new DebugWebView(true);
 *   debugWebView.getEngine().load("https://example.com");
 * </pre>
 *
 * <p>Notes:
 * <ul>
 *   <li>In debug mode, attempts to navigate the internal {@link WebEngine} are canceled and the
 *       target URL is opened externally. This covers both programmatic loads and in-page
 *       navigations triggered by the content.</li>
 *   <li>Calls such as {@code getEngine().loadContent(...)} do not include a resolvable URL. In
 *       debug mode these loads are canceled and nothing will be shown in the embedded view. If you
 *       need to inspect such content in an external browser, write it to a temporary file and call
 *       {@code getEngine().load(tempFile.toURI().toString())}.</li>
 * </ul>
 */
public class DebugWebView extends StackPane {

  private final boolean debug;
  private final WebView webView; // present only when !debug
  private final WebEngine engine; // always available

  /** Creates a non-debug instance that behaves like an embedded WebView. */
  public DebugWebView() {
    this(false);
  }

  /**
   * @param debug if true, navigation is redirected to the system browser; if false, embeds a stock WebView
   */
  public DebugWebView(boolean debug) {
    super();
    this.debug = debug;
    if (debug) {
      this.webView = null;
      this.engine = new WebEngine();
      setupDebugRedirection(this.engine);
      setVisible(false);
      setManaged(false);
      setPrefSize(0, 0);
    } else {
      this.webView = new WebView();
      this.engine = webView.getEngine();
      getChildren().add(webView);
    }
  }

  public boolean isDebug() {
    return debug;
  }

  /** Returns the {@link WebEngine} to be used by callers, regardless of mode. */
  public WebEngine getEngine() {
    return engine;
  }

  /** Returns the embedded {@link WebView} if present (non-debug mode); otherwise {@code null}. */
  public WebView getInternalWebView() {
    return webView;
  }

  private void setupDebugRedirection(WebEngine engine) {
    // Intercept attempts to navigate to a concrete location (URL) and open externally instead.
    engine.locationProperty().addListener((obs, oldLocation, newLocation) -> {
      if (newLocation != null && isLikelyUrl(newLocation)) {
        String target = remapIfMonacoClasspath(newLocation);
        // Open externally ASAP, but avoid cancelling inline during WebKit callbacks.
        openExternal(target);
        // Nudge the engine away from continuing the load on the next pulse.
        Platform.runLater(() -> engine.load("about:blank"));
      }
    });

    // When a load is scheduled (including loadContent cases), steer to about:blank on the next pulse
    // instead of cancelling inside native callbacks, which can crash WebKit.
    engine.getLoadWorker().stateProperty().addListener((obs, oldState, newState) -> {
      if (newState == Worker.State.SCHEDULED) {
        Platform.runLater(() -> engine.load("about:blank"));
      }
    });

    // Prevent popups (window.open) in the embedded engine.
    engine.setCreatePopupHandler(cfg -> null);
  }

  private static boolean isLikelyUrl(String s) {
    if (s == null) return false;
    String v = s.trim();
    if (v.isEmpty()) return false;
    // Typical URL schemes that should be opened externally
    return v.startsWith("http://")
        || v.startsWith("https://")
        || v.startsWith("file:/")
        || v.startsWith("jar:")
        || v.startsWith("mailto:")
        || v.startsWith("ftp://")
        || v.startsWith("data:");
  }

  private static void openExternal(String url) {
    Runnable browseTask = () -> {
      if (!Desktop.isDesktopSupported()) {
        System.err.println("[DebugWebView] Desktop browse not supported on this platform: " + url);
        return;
      }
      try {
        URI uri = toUri(url);
        if (uri != null) {
          Desktop.getDesktop().browse(uri);
        } else {
          System.err.println("[DebugWebView] Not a valid URI: " + url);
        }
      } catch (IOException e) {
        System.err.println("[DebugWebView] Failed to open external browser for URL: " + url);
        e.printStackTrace();
      }
    };

    // Never block the JavaFX Application Thread when opening the external browser.
    if (Platform.isFxApplicationThread()) {
      try {
        // Prefer virtual thread if available (Java 21+); fallback to platform thread otherwise.
        Thread.ofVirtual().name("DebugWebView-browse").start(browseTask);
      } catch (Throwable t) {
        Thread t1 = new Thread(browseTask, "DebugWebView-browse");
        t1.setDaemon(true);
        t1.start();
      }
    } else {
      // Already off FX thread
      try {
        Thread.ofVirtual().name("DebugWebView-browse").start(browseTask);
      } catch (Throwable t) {
        Thread t1 = new Thread(browseTask, "DebugWebView-browse");
        t1.setDaemon(true);
        t1.start();
      }
    }
  }

  private static URI toUri(String url) {
    Objects.requireNonNull(url, "url");
    try {
      return new URI(url);
    } catch (URISyntaxException e) {
      // Try to fix common cases (e.g., missing scheme)
      try {
        return new URI("http://" + url);
      } catch (URISyntaxException ex) {
        return null;
      }
    }
  }

  // If the URL points to the classpath Monaco folder (either as jar:...!/... or file:/...),
  // remap it so the system browser fetches from our local HTTP server, which preserves same-origin
  // and allows Monaco web workers to load. Otherwise, return the original URL.
  private static String remapIfMonacoClasspath(String url) {
    if (url == null) return null;
    String u = url;

    // Only handle jar: and file: URLs
    String lower = u.toLowerCase(Locale.ROOT);
    boolean jar = lower.startsWith("jar:");
    boolean file = lower.startsWith("file:");
    if (!jar && !file) return url;

    // Normalize to the internal path segment after the resource root
    // Resource root as used by MonacoEditorView
    final String marker = "/org/integratedmodelling/klabeditor/monaco/";
    int idx = u.indexOf(marker);
    if (idx < 0) {
      return url; // Not our classpath folder
    }

    String after = u.substring(idx + marker.length()); // e.g., "index.html" or "vs/loader.js"
    if (after.isEmpty()) after = "index.html";

    // Preserve query and hash if present
    String query = "";
    String hash = "";
    int qIdx = u.indexOf('?', idx + marker.length());
    int hIdx = u.indexOf('#', idx + marker.length());
    if (qIdx >= 0 && (hIdx < 0 || qIdx < hIdx)) {
      // query comes before hash
      int end = (hIdx >= 0) ? hIdx : u.length();
      query = u.substring(qIdx, end); // includes '?'
    }
    if (hIdx >= 0) {
      hash = u.substring(hIdx); // includes '#'
    }

    // Start the local server and build the http URL
    try {
      DebugClasspathHttpServer.startIfNeeded();
      return "http://127.0.0.1:" + DebugClasspathHttpServer.getPort() + "/" + after + query + hash;
    } catch (Throwable t) {
      System.err.println("[DebugWebView] Failed to start local classpath server, falling back to original URL: " + t);
      return url;
    }
  }
}
