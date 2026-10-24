module org.integratedmodelling.klabeditor {
    requires jdk.jsobject;
    requires org.kordamp.ikonli.javafx;
    requires jdk.httpserver;
    requires com.fasterxml.jackson.databind;
    requires java.desktop;
    requires javafx.graphics;
    requires javafx.controls;
    requires javafx.fxml;
    requires javafx.web;
    requires java.xml;
    requires flexmark;
    requires flexmark.util.data;
    requires flexmark.util.ast;
    requires flexmark.ext.tables;
    requires flexmark.ext.gfm.strikethrough;
    requires flexmark.ext.gfm.tasklist;
    requires flexmark.ext.autolink;
    requires org.eclipse.lsp4j;
    requires org.eclipse.lsp4j.jsonrpc;
    requires klab.core.api;
    requires java.rmi;

    opens org.integratedmodelling.klabeditor to javafx.fxml;
    exports org.integratedmodelling.klabeditor;
    exports org.integratedmodelling.klabeditor.lsp;
}
