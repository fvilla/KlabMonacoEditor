package org.integratedmodelling.klabeditor.lsp;

import static org.junit.jupiter.api.Assertions.*;
import java.lang.reflect.Proxy;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import org.eclipse.lsp4j.*;
import org.eclipse.lsp4j.jsonrpc.messages.Either;
import org.eclipse.lsp4j.services.*;
import org.junit.jupiter.api.Test;

class LspDocumentTransportTest {
  @Test void blockedTransportDoesNotBlockEditorAndMessagesRemainOrdered() throws Exception {
    var entered = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    var events = new CopyOnWriteArrayList<String>();
    TextDocumentService documents = new TextDocumentService() {
      public void didOpen(DidOpenTextDocumentParams params) {
        entered.countDown();
        try { assertTrue(release.await(5, TimeUnit.SECONDS)); }
        catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new RuntimeException(e); }
        events.add("open:" + params.getTextDocument().getText());
      }
      public void didChange(DidChangeTextDocumentParams params) { events.add("change:" + params.getTextDocument().getVersion()); }
      public void didClose(DidCloseTextDocumentParams params) { events.add("close"); }
      public void didSave(DidSaveTextDocumentParams params) {}
      public CompletableFuture<Either<List<CompletionItem>, CompletionList>> completion(CompletionParams params) {
        events.add("completion"); return CompletableFuture.completedFuture(Either.forLeft(List.of()));
      }
    };
    var server = (LanguageServer) Proxy.newProxyInstance(LanguageServer.class.getClassLoader(), new Class<?>[]{LanguageServer.class},
        (proxy, method, args) -> method.getName().equals("getTextDocumentService") ? documents : null);
    var constructor = KlabLspService.class.getDeclaredConstructor(); constructor.setAccessible(true);
    var service = constructor.newInstance();
    var serverField = KlabLspService.class.getDeclaredField("server"); serverField.setAccessible(true); serverField.set(service, server);
    var initialized = KlabLspService.class.getDeclaredField("initialized"); initialized.setAccessible(true); initialized.set(service, true);
    var queueField = KlabLspService.class.getDeclaredField("documentMessages"); queueField.setAccessible(true);
    var queue = (ExecutorService) queueField.get(service);
    String uri = "inmemory:///transport.kwv";
    try {
      assertTimeoutPreemptively(Duration.ofSeconds(1), () -> service.openDocument(uri, "kim", "first"));
      assertTrue(entered.await(2, TimeUnit.SECONDS));
      assertTimeoutPreemptively(Duration.ofSeconds(1), () -> {
        service.changeDocument(uri, "edited"); service.closeDocument(uri); service.openDocument(uri, "kim", "reopened");
      });
      var completion = service.completion(uri, 0, 0);
      assertFalse(completion.isDone());
      release.countDown(); completion.get(5, TimeUnit.SECONDS);
      assertEquals(List.of("open:first", "change:2", "close", "open:reopened", "completion"), events);
      service.closeDocument(uri);
      queue.submit(() -> {}).get(5, TimeUnit.SECONDS);
    } finally { release.countDown(); queue.shutdownNow(); }
  }
}
