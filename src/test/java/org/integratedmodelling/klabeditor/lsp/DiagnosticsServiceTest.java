package org.integratedmodelling.klabeditor.lsp;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.eclipse.lsp4j.Diagnostic;
import org.junit.jupiter.api.Test;

class DiagnosticsServiceTest {

  private final DiagnosticsService service = DiagnosticsService.getInstance();

  @Test
  void ignoresDiagnosticsOlderThanTheLatestPublishedVersion() {
    String uri = "inmemory:///" + UUID.randomUUID() + ".kim";
    var observed = new AtomicReference<List<Diagnostic>>();
    DiagnosticsService.Listener listener =
        (changedUri, diagnostics) -> {
          if (uri.equals(changedUri)) {
            observed.set(diagnostics);
          }
        };
    service.addListener(listener);

    try {
      service.documentOpened(uri, 1);
      service.documentChanged(uri, 2);
      service.updateDiagnostics(uri, 2, List.of(diagnostic("current")));
      service.updateDiagnostics(uri, 1, List.of(diagnostic("stale")));

      assertEquals("current", service.getDiagnostics(uri).getFirst().getMessage());
      assertEquals("current", observed.get().getFirst().getMessage());
    } finally {
      service.removeListener(listener);
      service.documentClosed(uri);
    }
  }

  @Test
  void aNewDocumentLifecycleAcceptsVersionsFromOneAgain() {
    String uri = "inmemory:///" + UUID.randomUUID() + ".kim";

    try {
      service.documentOpened(uri, 1);
      service.documentChanged(uri, 8);
      service.updateDiagnostics(uri, 8, List.of(diagnostic("old lifecycle")));
      service.documentClosed(uri);

      service.documentOpened(uri, 1);
      service.updateDiagnostics(uri, 8, List.of(diagnostic("late old lifecycle")));
      service.updateDiagnostics(uri, 1, List.of(diagnostic("new lifecycle")));

      assertEquals("new lifecycle", service.getDiagnostics(uri).getFirst().getMessage());
    } finally {
      service.documentClosed(uri);
    }
  }

  private static Diagnostic diagnostic(String message) {
    var ret = new Diagnostic();
    ret.setMessage(message);
    return ret;
  }
}
