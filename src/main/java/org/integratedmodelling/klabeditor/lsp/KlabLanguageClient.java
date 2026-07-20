package org.integratedmodelling.klabeditor.lsp;

import org.eclipse.lsp4j.*;
import org.eclipse.lsp4j.services.LanguageClient;

import java.util.List;
import java.util.concurrent.CompletableFuture;

class KlabLanguageClient implements LanguageClient {

  private final DiagnosticsService diagnosticsService = DiagnosticsService.getInstance();

  @Override
  public void publishDiagnostics(PublishDiagnosticsParams diagnosticsParams) {

    String uri = diagnosticsParams.getUri();
    System.out.println("[LSP] publishDiagnostics for URI = " + uri);
    System.out.println("[LSP] diagnostics count = " + diagnosticsParams.getDiagnostics().size());
    diagnosticsParams
        .getDiagnostics()
        .forEach(
            d ->
                System.out.println(
                    "  - "
                        + d.getSeverity()
                        + ": "
                        + d.getMessage()
                        + " @"
                        + d.getRange().getStart()));
    List<Diagnostic> diagnostics = diagnosticsParams.getDiagnostics();

    diagnosticsService.updateDiagnostics(uri, diagnosticsParams.getVersion(), diagnostics);
  }

  @Override
  public void showMessage(MessageParams messageParams) {
    System.out.println("LSP message: " + messageParams.getMessage());
  }

  @Override
  public void logMessage(MessageParams message) {
    System.out.println("LSP log: " + message.getMessage());
  }

  @Override
  public void telemetryEvent(Object o) {}

  @Override
  public CompletableFuture<MessageActionItem> showMessageRequest(ShowMessageRequestParams message) {
    return CompletableFuture.completedFuture(new MessageActionItem(message.getMessage()));
  }

  @Override
  public CompletableFuture<Void> registerCapability(RegistrationParams params) {
    return CompletableFuture.completedFuture(null);
  }

  @Override
  public CompletableFuture<Void> unregisterCapability(UnregistrationParams params) {
    return CompletableFuture.completedFuture(null);
  }
}
