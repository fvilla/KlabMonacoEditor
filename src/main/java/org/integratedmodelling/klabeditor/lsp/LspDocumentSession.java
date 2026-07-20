package org.integratedmodelling.klabeditor.lsp;

import java.util.List;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicBoolean;
import javafx.application.Platform;
import org.eclipse.lsp4j.Diagnostic;
import org.integratedmodelling.klabeditor.MonacoEditorView;

/**
 * Owns the LSP document and diagnostics registrations associated with a {@link MonacoEditorView}.
 * Close the session when the editor is genuinely disposed, not when JavaFX temporarily detaches it
 * from a scene.
 */
public final class LspDocumentSession implements AutoCloseable {

    private final String documentUri;
    private final MonacoEditorView editor;
    private final KlabLspService lsp;
    private final DiagnosticsService diagnostics;
    private final DiagnosticsService.Listener diagnosticsListener;
    private final AtomicBoolean closed = new AtomicBoolean();

    /**
     * Open and bind an LSP document to an editor whose URI was supplied to its constructor.
     * {@link KlabLspService#ensureInitialized} must have succeeded before this is called.
     *
     * @param editor editor to bind
     * @param languageId LSP language identifier
     * @param initialText initial full document text
     */
    public LspDocumentSession(MonacoEditorView editor, String languageId, String initialText) {
        this.editor = Objects.requireNonNull(editor, "editor");
        this.documentUri = Objects.requireNonNull(editor.getDocumentUri(), "editor document URI");
        if (documentUri.isBlank()) {
            throw new IllegalArgumentException("The editor document URI must not be blank");
        }
        this.lsp = KlabLspService.getInstance();
        if (!lsp.isInitialized()) {
            throw new IllegalStateException("KlabLspService must be initialized before opening a document session");
        }
        this.diagnostics = DiagnosticsService.getInstance();
        this.diagnosticsListener =
                (uri, entries) -> {
                    if (!closed.get() && documentUri.equals(uri)) {
                        applyDiagnostics(entries);
                    }
                };

        // Bind callbacks before didOpen so immediate changes and diagnostics cannot be missed.
        diagnostics.addListener(diagnosticsListener);
        editor.setChangeListener(this::changeDocument);
        lsp.openDocument(documentUri, languageId, initialText == null ? "" : initialText);

        var existing = diagnostics.getDiagnostics(documentUri);
        if (!existing.isEmpty()) {
            applyDiagnostics(existing);
        }
    }

    private void applyDiagnostics(List<Diagnostic> entries) {
        Platform.runLater(
                () -> {
                    if (!closed.get()) {
                        editor.setDiagnostics(entries);
                    }
                });
    }

    /** Send a full-text document change if the session is still open. */
    public void changeDocument(String text) {
        if (!closed.get()) {
            lsp.changeDocument(documentUri, text == null ? "" : text);
        }
    }

    /** Remove callbacks and send {@code didClose}. Repeated calls are harmless. */
    @Override
    public void close() {
        if (closed.compareAndSet(false, true)) {
            editor.setChangeListener(null);
            diagnostics.removeListener(diagnosticsListener);
            lsp.closeDocument(documentUri);
        }
    }
}
