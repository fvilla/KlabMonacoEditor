module org.integratedmodelling.klabeditor {
    requires javafx.controls;
    requires javafx.fxml;
    requires javafx.web;
    requires jdk.jsobject;

    requires org.kordamp.ikonli.javafx;
    requires javafx.graphics;
    requires jdk.httpserver;
    requires org.integratedmodelling.languages.kim.ide;
    requires org.integratedmodelling.languages.kim.ide.org.eclipse.lsp4j;
    requires com.fasterxml.jackson.databind;
    requires java.desktop;

    opens org.integratedmodelling.klabeditor to javafx.fxml;
    exports org.integratedmodelling.klabeditor;
}