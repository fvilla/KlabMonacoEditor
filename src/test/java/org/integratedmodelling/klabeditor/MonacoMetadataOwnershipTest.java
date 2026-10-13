package org.integratedmodelling.klabeditor;

import static org.junit.jupiter.api.Assertions.*;
import java.util.*;
import java.util.concurrent.*;
import javafx.application.Platform;
import javafx.scene.web.WebEngine;
import org.integratedmodelling.klabeditor.lsp.KlabLspService;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

class MonacoMetadataOwnershipTest {
  @BeforeAll static void startFx() throws Exception {
    var ready = new CompletableFuture<Void>();
    try { Platform.startup(() -> { Platform.setImplicitExit(false); ready.complete(null); }); }
    catch (IllegalStateException started) { Platform.runLater(() -> ready.complete(null)); }
    ready.get(15, TimeUnit.SECONDS);
  }
  private static class Editor extends MonacoEditorView {
    Map<String, String> received;
    Editor() { super("inmemory:///owner-b.kim", null); }
    @Override public void preloadConceptHighlighterCache(Map<String, String> cache) { received = cache; }
  }
  @Test void unboundEditorCannotImplicitlyImportAnotherOwnersCacheButHostCanInstallVerifiedMetadata() throws Exception {
    var done = new CompletableFuture<Void>();
    Platform.runLater(() -> {
      var singleton = KlabLspService.getInstance(); Editor editor = null;
      Object oldCache = null;
      try {
        var field = KlabLspService.class.getDeclaredField("conceptMap"); field.setAccessible(true);
        oldCache = field.get(singleton); var ownerA = Map.of("owner-a:foreign", "SUBJECT"); field.set(singleton, ownerA);
        editor = new Editor();
        var initialize = MonacoEditorView.class.getDeclaredMethod("initEditor", String.class, String.class, String.class);
        initialize.setAccessible(true);
        initialize.invoke(editor, "editable source", "kim", "vs");
        assertSame(ownerA, editor.received, "Control demonstrates the eager singleton-cache path");
        editor.received = null; editor.setUseSharedLspMetadata(false);
        initialize.invoke(editor, "editable source", "kim", "vs");
        assertNull(editor.received, "Unbound B must not receive A's concept cache while opening");
        var verifiedB = Map.of("owner-b:accepted", "QUALITY"); editor.preloadConceptHighlighterCache(verifiedB);
        assertSame(verifiedB, editor.received, "Opt-out must still permit verified host metadata");
        field.set(singleton, oldCache); done.complete(null);
      } catch (Throwable failure) { done.completeExceptionally(failure); }
      finally {
        try {
          if (oldCache != null) { var field = KlabLspService.class.getDeclaredField("conceptMap"); field.setAccessible(true); field.set(singleton, oldCache); }
          if (editor != null) { var field = MonacoEditorView.class.getDeclaredField("webEngine"); field.setAccessible(true); var engine = (WebEngine)field.get(editor); engine.getLoadWorker().cancel(); engine.load(null); }
        } catch (Throwable failure) { done.completeExceptionally(failure); }
      }
    });
    done.get(15, TimeUnit.SECONDS);
  }
}
