module org.integratedmodelling.klabeditor {
    requires javafx.controls;
    requires javafx.fxml;

    requires org.kordamp.ikonli.javafx;

    opens org.integratedmodelling.klabeditor to javafx.fxml;
    exports org.integratedmodelling.klabeditor;
}