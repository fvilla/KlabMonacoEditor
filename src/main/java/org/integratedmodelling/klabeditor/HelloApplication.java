package org.integratedmodelling.klabeditor;

import javafx.application.Application;
import javafx.scene.Scene;
import javafx.stage.Stage;

public class HelloApplication extends Application {
    @Override
    public void start(Stage stage) {
        // Create the Monaco editor view and load demo code from a Java string
        MonacoEditorView editor = new MonacoEditorView();

        String sampleCode = """
                // Demo code loaded from Java string
                public class HelloMonaco {
                    public static void main(String[] args) {
                        System.out.println("Hello from Monaco Editor!");
                    }
                }
                """;

        editor.loadEditor(sampleCode, "java", null);

        Scene scene = new Scene(editor, 1000, 700);
        stage.setTitle("Monaco Editor Demo");
        stage.setScene(scene);
        stage.show();

    }
}
