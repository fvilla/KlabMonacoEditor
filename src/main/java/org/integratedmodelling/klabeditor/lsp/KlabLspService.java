package org.integratedmodelling.klabeditor.lsp;

import org.eclipse.lsp4j.*;
import org.eclipse.lsp4j.jsonrpc.Launcher;
import org.eclipse.lsp4j.jsonrpc.messages.Either;
import org.eclipse.lsp4j.services.LanguageClient;
import org.eclipse.lsp4j.services.LanguageServer;
import org.integratedmodelling.klab.api.engine.distribution.LocalInstance;
import org.integratedmodelling.klab.api.knowledge.KlabAsset;
import org.integratedmodelling.klab.api.knowledge.SemanticType;
import org.integratedmodelling.klab.api.knowledge.Worldview;
import org.integratedmodelling.klab.api.lang.KlabLanguage;
import org.integratedmodelling.klab.api.lang.LanguageDescriptor;
import org.integratedmodelling.klab.api.lang.kim.KimConceptStatement;
import org.integratedmodelling.klab.api.scope.UserScope;
import org.integratedmodelling.klab.api.services.ResourcesService;

import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.*;
import java.util.function.Function;

public class KlabLspService {

    private static final KlabLspService INSTANCE = new KlabLspService();
    private final Map<String, Integer> docVersions = new ConcurrentHashMap<>();

    private int nextVersion(String uri) {
        return docVersions.merge(uri, 1, Integer::sum);
    }

    public static KlabLspService getInstance() {
        return INSTANCE;
    }

    //  private Process serverProcess;
    private LanguageServer server;
    private Launcher<LanguageServer> launcher;
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private int versionCounter = 1;
    private LanguageDescriptor languageConfig;
    private Map<String, String> conceptMap = new HashMap<>();

    private volatile boolean initialized = false;

    private KlabLspService() {
    }

    public List<String> getLanguageKeywords(String language) {
        var languageType = KlabLanguage.forId(language);
        if (languageType == null) {
            return Collections.emptyList();
        }
        var descriptor = languageConfig.getLanguages().get(languageType);
        if (descriptor == null) {
            return Collections.emptyList();
        }
        return descriptor.getKeywords();
    }

    /**
     * This MUST be called with a valid and running LSP server as the argument.
     * <p>
     * TODO switch to a regular class with a singleton check and pass the server as constructor argument
     * TODO pass a scope and manage the language configuration and worldview bridge
     *
     * @param lspServer
     * @return
     */
    public synchronized boolean ensureInitialized(LocalInstance lspServer, UserScope scope) {

        if (lspServer.getStatus() != LocalInstance.Status.RUNNING) {
            return false;
        }

        if (initialized) {
            return true;
        }

        try {
            LanguageClient client = new KlabLanguageClient();

            this.languageConfig = scope.getService(ResourcesService.class).info("",
                                                                                KlabAsset.KnowledgeClass.INFORMATION,
                                                                                LanguageDescriptor.class,
                                                                                scope);

            this.conceptMap = updateConceptMap(scope.getWorldview());

            launcher = Launcher.createLauncher(client, LanguageServer.class, lspServer.getInputStream(),
                                               lspServer.getOutputStream(), executor, Function.identity());
            server = launcher.getRemoteProxy();
            launcher.startListening();

            // 2. Initialize
            InitializeParams params = new InitializeParams();
            params.setCapabilities(new ClientCapabilities());
            server.initialize(params).get(60, TimeUnit.SECONDS);
            server.initialized(new InitializedParams());

            initialized = true;
        } catch (Exception e) {
            // the nightmare was that a closed outputstream was coming out of the instance. Hopefully
            // that is solved now.
            return false;
        }
        return true;
    }

    private Map<String, String> updateConceptMap(Worldview worldview) {
        var conceptMap = new HashMap<String, String>();
        for (KimConceptStatement concept : worldview.allConceptStatements()) {
            String type = "UNKNOWN";
            if (concept.getType().contains(SemanticType.QUALITY)) {
                type = "QUALITY";
            } else if (concept.getType().contains(SemanticType.ROLE)) {
                type = "ROLE";
            } else if (concept.getType().contains(SemanticType.TRAIT)) {
                type = "TRAIT";
            } else if (concept.getType().contains(SemanticType.RELATIONSHIP)) {
                type = "RELATIONSHIP";
            } else if (concept.getType().contains(SemanticType.DOMAIN)) {
                type = "DOMAIN";
            } else if (concept.getType().contains(SemanticType.CONFIGURATION)) {
                type = "CONFIGURATION";
            } else if (concept.getType().contains(SemanticType.EVENT)) {
                type = "EVENT";
            } else if (concept.getType().contains(SemanticType.EXTENT)) {
                type = "EXTENT";
            } else if (concept.getType().contains(SemanticType.PROCESS)) {
                type = "PROCESS";
            } else if (concept.getType().contains(SemanticType.SUBJECT) || concept.getType().contains(
                    SemanticType.AGENT)) {
                type = "SUBJECT";
            }
            conceptMap.put(concept.getNamespace() + ":" + concept.getUrn(), type);
        }
        return conceptMap;
    }

    public LanguageServer getServer() {
        return server;
    }

    public Map<String, String> getConceptCache() {
        return conceptMap;
    }

    public void openDocument(String uri, String languageId, String text) {
        if (!initialized) return;

        // Set baseline version for this document (start at 1)
        docVersions.put(uri, 1);

        TextDocumentItem item = new TextDocumentItem();
        item.setUri(uri);
        item.setLanguageId(languageId);
        item.setVersion(1);
        item.setText(text);

        DidOpenTextDocumentParams params = new DidOpenTextDocumentParams(item);
        server.getTextDocumentService().didOpen(params);

        System.out.println(
                "[LSP] didOpen uri=" + uri + " version=1 len=" + (text != null ? text.length() : 0));
    }

    public void changeDocument(String uri, String newText) {
        if (!initialized) return;

        Integer current = docVersions.get(uri);
        if (current == null) {
            // This is *very* useful to detect ordering bugs (didChange before didOpen)
            System.err.println(
                    "[LSP] didChange called for unopened uri=" + uri + " -> forcing baseline version");
            docVersions.put(uri, 1);
        }

        int v = nextVersion(uri);

        TextDocumentContentChangeEvent change = new TextDocumentContentChangeEvent();
        change.setText(newText); // full text

        VersionedTextDocumentIdentifier id = new VersionedTextDocumentIdentifier();
        id.setUri(uri);
        id.setVersion(v);

        DidChangeTextDocumentParams params = new DidChangeTextDocumentParams(id, Collections.singletonList(
                change));

        try {
            server.getTextDocumentService().didChange(params);
            System.out.println(
                    "[LSP] didChange uri=" + uri + " version=" + v + " len=" + (newText != null ?
                                                                                newText.length() : 0));
        } catch (Exception e) {
            System.err.println("[LSP] didChange failed uri=" + uri + " version=" + v);
            e.printStackTrace();
        }
    }

    public void closeDocument(String uri) {
        if (!initialized) return;
        try {
            TextDocumentIdentifier id = new TextDocumentIdentifier(uri);
            server.getTextDocumentService().didClose(new DidCloseTextDocumentParams(id));
            System.out.println("[LSP] didClose uri=" + uri);
        } catch (Exception e) {
            System.err.println("[LSP] didClose failed uri=" + uri);
            e.printStackTrace();
        } finally {
            docVersions.remove(uri);
        }
    }

    public CompletableFuture<Either<List<CompletionItem>, CompletionList>> completion(String uri, int line,
                                                                                      int character) {

        if (!initialized) {
            CompletableFuture<Either<List<CompletionItem>, CompletionList>> f = new CompletableFuture<>();
            f.completeExceptionally(new IllegalStateException("LSP not initialized"));
            return f;
        }

        TextDocumentIdentifier id = new TextDocumentIdentifier(uri);
        Position pos = new Position(line, character);
        CompletionParams params = new CompletionParams(new TextDocumentIdentifier(uri),
                                                       new Position(line, character));
        return server.getTextDocumentService().completion(params);
    }

    //  public void shutdown() throws Exception {
    //    if (!initialized) return;
    //    server.shutdown().get(5, TimeUnit.SECONDS);
    //    server.exit();
    //    serverProcess.destroy();
    //    executor.shutdown();
    //    initialized = false;
    //  }
    //
    //  private Process startServerProcess(Path workspaceRoot) throws Exception {
    //    // Location of "target/classes" relative to workspaceRoot
    //    Path classesDir = workspaceRoot.resolve("target").resolve("classes");
    //
    //    // Load classpath.txt which the .sh script uses
    //    Path cpFile = workspaceRoot.resolve("target").resolve("classpath.txt");
    //    String extraCp = java.nio.file.Files.readString(cpFile).trim();
    //
    //    // Build the full classpath (classes + additional entries from classpath.txt)
    //    // TODO change this to something production-ready
    //    String classpath = classesDir.toString() + System.getProperty("path.separator") + extraCp;
    //
    //    // Build the Java command equivalent to start-lsp.sh
    //    ProcessBuilder pb =
    //        new ProcessBuilder(
    //            "java",
    //            "-Dxtext.disable.standalone.setup=true",
    //            "org.eclipse.xtext.ide.server.ServerLauncher");
    //
    //    // put CLASSPATH in an env var so that the CL doesn't kill Windows
    //    pb.environment().put("CLASSPATH", classpath);
    //    pb.directory(workspaceRoot.toFile());
    //    pb.redirectError(ProcessBuilder.Redirect.INHERIT);
    //
    //    return pb.start();
    //  }

    //  public static void main(String[] diocan) throws Exception {
    //    Path workspaceRoot = Paths.get(System.getProperty("user.home") + "/git/klab-ide");
    //    KlabLspService.getInstance().startIfNeeded(workspaceRoot);
    //  }
}
