package org.integratedmodelling.klabeditor.lsp;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Function;
import org.eclipse.lsp4j.*;
import org.eclipse.lsp4j.jsonrpc.Launcher;
import org.eclipse.lsp4j.services.LanguageClient;
import org.eclipse.lsp4j.services.LanguageServer;
import org.integratedmodelling.klab.api.engine.distribution.LocalInstance;
import org.integratedmodelling.klab.api.knowledge.KlabAsset;
import org.integratedmodelling.klab.api.knowledge.Worldview;
import org.integratedmodelling.klab.api.lang.LanguageDescriptor;
import org.integratedmodelling.klab.api.scope.UserScope;
import org.integratedmodelling.klab.api.services.ResourcesService;
import org.junit.jupiter.api.Test;

class KlabLspOwnershipTest {
  @Test void inFlightSingletonInitializationCannotBeReusedByAnotherServerOrScope() throws Exception {
    var singleton = KlabLspService.getInstance();
    var original = new HashMap<String, Object>();
    for (String name : List.of("initialized", "initializedServer", "initializedScope", "server", "launcher", "languageConfig", "conceptMap")) {
      try {
        var field = KlabLspService.class.getDeclaredField(name); field.setAccessible(true);
        original.put(name, field.get(singleton));
      } catch (NoSuchFieldException absentInBaseline) {
        if (!name.equals("initializedServer") && !name.equals("initializedScope")) throw absentInBaseline;
      }
    }
    var initialized = KlabLspService.class.getDeclaredField("initialized"); initialized.setAccessible(true);
    initialized.set(singleton, false);
    var scopeA = mock(UserScope.class); var scopeB = mock(UserScope.class);
    var serverA = mock(LocalInstance.class); var serverB = mock(LocalInstance.class);
    when(serverA.getStatus()).thenReturn(LocalInstance.Status.RUNNING);
    when(serverB.getStatus()).thenReturn(LocalInstance.Status.RUNNING);
    var resources = mock(ResourcesService.class);
    when(scopeA.getService(ResourcesService.class)).thenReturn(resources);
    var worldview = mock(Worldview.class); when(worldview.allConceptStatements()).thenReturn(List.of());
    when(scopeA.getWorldview()).thenReturn(worldview);
    var entered = new CountDownLatch(1); var release = new CountDownLatch(1);
    when(resources.info("klab.languages", KlabAsset.KnowledgeClass.INFORMATION, LanguageDescriptor.class, scopeA))
        .thenAnswer(call -> { entered.countDown(); assertTrue(release.await(5, TimeUnit.SECONDS)); return new LanguageDescriptor(); });
    // Exercise the real singleton and real JSON-RPC initialize handshake through private pipes.
    var clientInput = new PipedInputStream(65536); var peerOutput = new PipedOutputStream(clientInput);
    var peerInput = new PipedInputStream(65536); var clientOutput = new PipedOutputStream(peerInput);
    when(serverA.getInputStream()).thenReturn(clientInput); when(serverA.getOutputStream()).thenReturn(clientOutput);
    var peer = new LanguageServer() {
      public CompletableFuture<InitializeResult> initialize(InitializeParams params) {
        return CompletableFuture.completedFuture(new InitializeResult(new ServerCapabilities()));
      }
      public CompletableFuture<Object> shutdown() { return CompletableFuture.completedFuture(null); }
      public void exit() {}
      public org.eclipse.lsp4j.services.TextDocumentService getTextDocumentService() { return null; }
      public org.eclipse.lsp4j.services.WorkspaceService getWorkspaceService() { return null; }
    };
    var executor = Executors.newVirtualThreadPerTaskExecutor();
    var remote = Launcher.createLauncher(peer, LanguageClient.class, peerInput, peerOutput, executor, Function.identity());
    var listening = remote.startListening();
    try {
      var resultA = executor.submit(() -> singleton.ensureInitialized(serverA, scopeA));
      assertTrue(entered.await(5, TimeUnit.SECONDS));
      var requestedB = new CountDownLatch(1);
      var resultB = executor.submit(() -> { requestedB.countDown(); return singleton.ensureInitialized(serverB, scopeB); });
      assertTrue(requestedB.await(5, TimeUnit.SECONDS));
      assertFalse(resultA.isDone()); release.countDown();
      assertTrue(resultA.get(5, TimeUnit.SECONDS));
      assertTrue(singleton.isInitialized());
      var boundServer = singleton.getServer(); var boundCache = singleton.getConceptCache();
      assertFalse(resultB.get(5, TimeUnit.SECONDS), "B must not receive A's initialized singleton");
      assertFalse(singleton.ensureInitialized(serverA, scopeB), "Same server with another user scope must fail closed");
      assertFalse(singleton.ensureInitialized(serverB, scopeA), "Same scope with another server must fail closed");
      assertTrue(singleton.ensureInitialized(serverA, scopeA), "The owning session remains usable");
      assertSame(boundServer, singleton.getServer()); assertSame(boundCache, singleton.getConceptCache());
      verify(serverB, never()).getInputStream(); verify(serverB, never()).getOutputStream();
      verifyNoInteractions(scopeB);
    } finally {
      release.countDown(); listening.cancel(true);
      clientInput.close(); clientOutput.close(); peerInput.close(); peerOutput.close();
      executor.shutdownNow();
      for (var entry : original.entrySet()) {
        var field = KlabLspService.class.getDeclaredField(entry.getKey()); field.setAccessible(true);
        field.set(singleton, entry.getValue());
      }
    }
  }
}
