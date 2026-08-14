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
    private volatile LanguageDescriptor languageConfig;
    private volatile Map<String, String> conceptMap = new HashMap<>();

    private volatile boolean initialized = false;

    private KlabLspService() {
    }

    public List<String> getLanguageKeywords(String language) {
        if (languageConfig == null) {
            return Collections.emptyList();
        }
        var languageType = resolveLanguage(language);
        if (languageType == null) {
            return Collections.emptyList();
        }
        var descriptor = languageConfig.getLanguages().get(languageType);
        if (descriptor == null) {
            return Collections.emptyList();
        }
        return descriptor.getKeywords() == null ? Collections.emptyList()
                : List.copyOf(descriptor.getKeywords());
    }

    private KlabLanguage resolveLanguage(String language) {
        if (language == null || language.isBlank()) {
            return null;
        }
        var byId = KlabLanguage.forId(language);
        if (byId != null) {
            return byId;
        }
        for (var candidate : KlabLanguage.values()) {
            if (candidate.languageName().equalsIgnoreCase(language)
                    || candidate.fileExtension().equalsIgnoreCase(language)
                    || ("." + candidate.fileExtension()).equalsIgnoreCase(language)) {
                return candidate;
            }
        }
        return null;
    }

    /**
     * Populate the immutable metadata used by the Monaco highlighter. This is deliberately
     * independent of LSP process initialization: Monarch only needs the language descriptor and
     * the current worldview, both of which are available from the user scope.
     *
     * @return true when language metadata was obtained from a resources service
     */
    public synchronized boolean ensureHighlightingMetadata(UserScope scope) {
        if (scope == null) {
            return false;
        }

        if (languageConfig == null) {
            try {
                var resources = scope.getService(ResourcesService.class);
                if (resources != null) {
                    languageConfig = resources.info("languageInfo",
                            KlabAsset.KnowledgeClass.INFORMATION,
                            LanguageDescriptor.class,
                            scope);
                }
            } catch (Exception e) {
                // leave it null, complain later
            }
            if (languageConfig /* still */ == null) {
                System.err.println("[KlabLspService] Cannot load language highlighting metadata from resources service");
            }
        }

        if (conceptMap.isEmpty() && scope.getWorldview() != null) {
            conceptMap = updateConceptMap(scope.getWorldview());
        }
        return languageConfig != null;
    }

    /**
     * This MUST be called with a valid and running LSP server as the argument. The scope is used to locate
     * resources services and initialize the worldview bridge for the highlighting cache.
     * <p>
     * TODO switch to a regular class with a singleton check and pass the server as constructor argument
     * TODO persist the concept cache so that we can initialize the bridge with it if no services are available or
     *      we don't want to use remote services for that.
     *
     * @param lspServer
     * @return
     */
    public synchronized boolean ensureInitialized(LocalInstance lspServer, UserScope scope) {

        // Syntax highlighting does not depend on an LSP process. Populate its caches even when
        // editing support is disabled or the language server failed to start.
        ensureHighlightingMetadata(scope);

        if (lspServer == null || lspServer.getStatus() != LocalInstance.Status.RUNNING) {
            return false;
        }

        if (initialized) {
            return true;
        }

        try {
            LanguageClient client = new KlabLanguageClient();

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

    public boolean isInitialized() {
        return initialized;
    }

    public Map<String, String> getConceptCache() {
        return conceptMap;
    }

    public void openDocument(String uri, String languageId, String text) {
        if (!initialized) return;

        Integer existingVersion = docVersions.putIfAbsent(uri, 1);
        if (existingVersion != null) {
            System.out.println(
                    "[LSP] openDocument called for already-open uri=" + uri + " version=" + existingVersion +
                            " -> syncing with didChange");
            changeDocument(uri, text);
            return;
        }

        TextDocumentItem item = new TextDocumentItem();
        item.setUri(uri);
        item.setLanguageId(languageId);
        item.setVersion(1);
        item.setText(text);

        DidOpenTextDocumentParams params = new DidOpenTextDocumentParams(item);
        try {
            DiagnosticsService.getInstance().documentOpened(uri, 1);
            server.getTextDocumentService().didOpen(params);
            System.out.println(
                    "[LSP] didOpen uri=" + uri + " version=1 len=" + (text != null ? text.length() : 0));
        } catch (Exception e) {
            docVersions.remove(uri);
            DiagnosticsService.getInstance().documentClosed(uri);
            System.err.println("[LSP] didOpen failed uri=" + uri);
            e.printStackTrace();
        }
    }

    public void changeDocument(String uri, String newText) {
        if (!initialized) return;

        Integer current = docVersions.get(uri);
        if (current == null) {
            System.err.println(
                    "[LSP] didChange ignored for unopened uri=" + uri + "; call openDocument first");
            return;
        }

        int v = nextVersion(uri);
        DiagnosticsService.getInstance().documentChanged(uri, v);

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
            DiagnosticsService.getInstance().documentClosed(uri);
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

}
