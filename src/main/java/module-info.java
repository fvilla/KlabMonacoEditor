module org.integratedmodelling.klabeditor {
    requires jdk.jsobject;
    requires org.kordamp.ikonli.javafx;
    requires jdk.httpserver;
    requires org.integratedmodelling.languages.kim.ide;
    requires org.integratedmodelling.languages.kim.ide.org.eclipse.lsp4j;
    requires com.fasterxml.jackson.databind;
    requires java.desktop;
    requires javafx.graphics;
    requires javafx.controls;
    requires javafx.fxml;
    requires javafx.web;

    opens org.integratedmodelling.klabeditor to javafx.fxml;
    exports org.integratedmodelling.klabeditor;
}