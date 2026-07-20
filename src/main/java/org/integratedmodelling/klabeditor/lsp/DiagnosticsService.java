package org.integratedmodelling.klabeditor.lsp;

import org.eclipse.lsp4j.Diagnostic;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

public class DiagnosticsService {

    public interface Listener {
        void onDiagnosticsChanged(String uri, List<Diagnostic> diagnostics);
    }

    private static final DiagnosticsService INSTANCE = new DiagnosticsService();
    private final Map<String, List<Diagnostic>> byUri = new ConcurrentHashMap<>();
    private final Map<String, Integer> documentVersionsByUri = new ConcurrentHashMap<>();
    private final List<Listener> listeners = new CopyOnWriteArrayList<>();

    public static DiagnosticsService getInstance() {
        return INSTANCE;
    }

    public void updateDiagnostics(String uri, List<Diagnostic> diagnostics) {
        updateDiagnostics(uri, null, diagnostics);
    }

    public void updateDiagnostics(String uri, Integer version, List<Diagnostic> diagnostics) {
        List<Diagnostic> snapshot = List.copyOf(diagnostics);
        synchronized (this) {
            Integer documentVersion = documentVersionsByUri.get(uri);
            if (version != null && documentVersion != null && !version.equals(documentVersion)) {
                System.out.println(
                        "[LSP] Ignoring stale diagnostics uri=" + uri + " version=" + version +
                                " current=" + documentVersion);
                return;
            }
            byUri.put(uri, snapshot);
        }
        for (Listener l : listeners) {
            try {
//                System.out.println("[DiagnosticsService] notifying listener: " + l);
                l.onDiagnosticsChanged(uri, snapshot);
            } catch (Exception e) {
                e.printStackTrace();
            }
        }
    }

    public synchronized void documentOpened(String uri, int version) {
        documentVersionsByUri.put(uri, version);
        byUri.remove(uri);
    }

    public synchronized void documentChanged(String uri, int version) {
        documentVersionsByUri.put(uri, version);
    }

    public synchronized void documentClosed(String uri) {
        documentVersionsByUri.remove(uri);
        byUri.remove(uri);
    }

    public List<Diagnostic> getDiagnostics(String uri) {
        return byUri.getOrDefault(uri, List.of());
    }

    public void addListener(Listener listener) {
        listeners.add(listener);
    }

    public void removeListener(Listener listener) {
        listeners.remove(listener);
    }
}


