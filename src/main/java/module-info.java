module org.integratedmodelling.klabeditor {
    requires javafx.controls;
    requires javafx.fxml;
    requires javafx.web;
    requires jdk.jsobject;

    requires org.kordamp.ikonli.javafx;
    requires javafx.graphics;
    requires java.desktop;
    requires jdk.httpserver;

    opens org.integratedmodelling.klabeditor to javafx.fxml;
    exports org.integratedmodelling.klabeditor;
}