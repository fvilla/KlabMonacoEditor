package org.integratedmodelling.klabeditor;

import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLConnection;
import java.nio.charset.StandardCharsets;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Locale;
import java.util.Objects;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Minimal embedded HTTP server to expose Monaco resources from the classpath in debug mode.
 * Serves the resource subtree under "/org/integratedmodelling/klabeditor/monaco" at
 * http://localhost:&lt;port&gt;/
 */
final class DebugClasspathHttpServer {

    private static final String RESOURCE_ROOT = "/org/integratedmodelling/klabeditor/monaco";

    private static volatile HttpServer server;
    private static volatile int port = -1;
    private static volatile ExecutorService executor;

    private DebugClasspathHttpServer() {}

    static synchronized void startIfNeeded() {
        if (server != null) {
            return;
        }
        try {
            server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/", new ClasspathHandler());
            executor = Executors.newCachedThreadPool(r -> {
                Thread t = new Thread(r, "DebugClasspathHttpServer");
                t.setDaemon(true);
                return t;
            });
            server.setExecutor(executor);
            server.start();
            port = server.getAddress().getPort();

            // Clean shutdown when JVM exits
            Runtime.getRuntime().addShutdownHook(new Thread(() -> {
                try { stop(); } catch (Throwable ignored) {}
            }, "DebugClasspathHttpServer-shutdown"));

            System.out.println("[DebugClasspathHttpServer] Started at http://127.0.0.1:" + port + "/ serving " + RESOURCE_ROOT);
        } catch (IOException e) {
            throw new IllegalStateException("Failed to start debug classpath HTTP server", e);
        }
    }

    static synchronized void stop() {
        if (server != null) {
            server.stop(0);
            server = null;
            port = -1;
        }
        if (executor != null) {
            executor.shutdownNow();
            executor = null;
        }
    }

    static boolean isRunning() {
        return server != null;
    }

    static int getPort() {
        if (server == null) startIfNeeded();
        return port;
    }

    static String localUrlFor(String resourcePath) {
        // resourcePath is expected to be absolute within RESOURCE_ROOT, e.g., "/index.html" or "/vs/loader.js"
        if (!resourcePath.startsWith("/")) resourcePath = "/" + resourcePath;
        return "http://127.0.0.1:" + getPort() + resourcePath;
    }

    private static final class ClasspathHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange ex) throws IOException {
            try {
                URI requestURI = ex.getRequestURI();
                String rawPath = Objects.toString(requestURI.getPath(), "/");

                // Normalize path: unify slashes, strip optional classpath prefix, remove leading ./ segments
                String path = rawPath.replace('\\', '/');
                // Collapse multiple slashes
                while (path.contains("//")) {
                    path = path.replace("//", "/");
                }
                // Strip optional classpath prefix if client accidentally requests it
                final String CP_PREFIX = "/org/integratedmodelling/klabeditor/monaco";
                if (path.startsWith(CP_PREFIX)) {
                    path = path.substring(CP_PREFIX.length());
                    if (path.isEmpty()) path = "/"; // in case it was exactly the prefix
                }
                // Ensure leading slash
                if (!path.startsWith("/")) path = "/" + path;
                // Remove any leading ./ segments
                while (path.startsWith("/./")) {
                    path = path.substring(2);
                }
                // Root maps to index.html
                if (path.equals("/")) path = "/index.html";

                // Special-case favicon to avoid noisy 404s
                if ("/favicon.ico".equals(path)) {
                    Headers h = ex.getResponseHeaders();
                    h.add("Content-Type", "image/x-icon");
                    h.add("Cache-Control", "no-cache, no-store, must-revalidate");
                    h.add("Pragma", "no-cache");
                    h.add("Expires", "0");
                    h.add("Date", DateTimeFormatter.RFC_1123_DATE_TIME.format(ZonedDateTime.now()));
                    ex.sendResponseHeaders(204, -1); // No Content
                    return;
                }

                // Basic traversal protection after normalization
                if (path.contains("..")) {
                    sendText(ex, 400, "Bad Request");
                    return;
                }

                String resource = RESOURCE_ROOT + path;
                try (InputStream in = getClass().getResourceAsStream(resource)) {
                    if (in == null) {
                        sendText(ex, 404, "Not Found: " + path);
                        return;
                    }
                    byte[] bytes = in.readAllBytes();
                    Headers h = ex.getResponseHeaders();
                    h.add("Content-Type", guessContentType(path));
                    // Some headers for nicer browser behavior
                    h.add("Cache-Control", "no-cache, no-store, must-revalidate");
                    h.add("Pragma", "no-cache");
                    h.add("Expires", "0");
                    h.add("Date", DateTimeFormatter.RFC_1123_DATE_TIME.format(ZonedDateTime.now()));

                    ex.sendResponseHeaders(200, bytes.length);
                    try (OutputStream os = ex.getResponseBody()) {
                        os.write(bytes);
                    }
                }
            } catch (Throwable t) {
                t.printStackTrace();
                try { sendText(ex, 500, "Internal Server Error"); } catch (Throwable ignored) {}
            } finally {
                ex.close();
            }
        }

        private static void sendText(HttpExchange ex, int code, String text) throws IOException {
            byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
            ex.getResponseHeaders().add("Content-Type", "text/plain; charset=utf-8");
            ex.sendResponseHeaders(code, bytes.length);
            try (OutputStream os = ex.getResponseBody()) {
                os.write(bytes);
            }
        }

        private static String guessContentType(String path) {
            String ct = URLConnection.guessContentTypeFromName(path);
            if (ct != null) return ct;
            String lower = path.toLowerCase(Locale.ROOT);
            if (lower.endsWith(".js")) return "application/javascript; charset=utf-8";
            if (lower.endsWith(".mjs")) return "application/javascript; charset=utf-8";
            if (lower.endsWith(".css")) return "text/css; charset=utf-8";
            if (lower.endsWith(".map")) return "application/json; charset=utf-8";
            if (lower.endsWith(".json")) return "application/json; charset=utf-8";
            if (lower.endsWith(".svg")) return "image/svg+xml";
            if (lower.endsWith(".woff2")) return "font/woff2";
            if (lower.endsWith(".woff")) return "font/woff";
            if (lower.endsWith(".ttf")) return "font/ttf";
            if (lower.endsWith(".png")) return "image/png";
            if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
            if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html; charset=utf-8";
            return "application/octet-stream";
        }
    }
}
