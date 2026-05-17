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
    private final List<Listener> listeners = new CopyOnWriteArrayList<>();

    public static DiagnosticsService getInstance() {
        return INSTANCE;
    }

    public void updateDiagnostics(String uri, List<Diagnostic> diagnostics) {
        byUri.put(uri, diagnostics);
        for (Listener l : listeners) {
            try {
                System.out.println("[DiagnosticsService] notifying listener: " + l);
                l.onDiagnosticsChanged(uri, diagnostics);
            } catch (Exception e) {
                e.printStackTrace();
            }
        }
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


