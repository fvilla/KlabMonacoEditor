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
    requires org.eclipse.lsp4j;

    opens org.integratedmodelling.klabeditor to javafx.fxml;
    exports org.integratedmodelling.klabeditor;
}