package org.integratedmodelling.klabeditor;

import javafx.application.Application;
import javafx.geometry.Insets;
import javafx.scene.Scene;
import javafx.scene.control.*;
import javafx.scene.layout.BorderPane;
import javafx.scene.layout.GridPane;
import javafx.scene.layout.HBox;
import javafx.scene.layout.VBox;
import javafx.stage.Stage;

/**
 * Test application to exercise MonacoEditorView.createMarker(line, message, severity).
 *
 * How to run:
 *  - From your IDE: Run this class' main() method.
 *  - From Maven using javafx:run: temporarily set the plugin mainClass to
 *      org.integratedmodelling.klabeditor/org.integratedmodelling.klabeditor.MarkerTest
 *    in pom.xml, then: mvn clean javafx:run
 */
public class MarkerTest extends Application {

    @Override
    public void start(Stage primaryStage) {
        MonacoEditorView editor = new MonacoEditorView();

        // Sample code with multiple lines so we can place markers at different locations
        String sampleCode = """
                // Demo code for marker testing
                public class MarkerDemo {
                    public static void main(String[] args) {
                        int sum = 0;                       // line 4
                        for (int i = 1; i <= 5; i++) {
                            sum += i;                       // line 6
                        }
                        System.out.println(sum);             // line 8
                        // Try placing markers on lines: 4, 6, 8, 10, ...
                    }
                }
                """;

        // Controls
        Label title = new Label("Monaco Editor - Marker Test");
        title.setStyle("-fx-font-size: 16px; -fx-font-weight: bold;");

        TextField lineField = new TextField("4");
        lineField.setPrefColumnCount(5);
        TextField messageField = new TextField("Sample marker message");
        ComboBox<String> severityBox = new ComboBox<>();
        severityBox.getItems().addAll("info", "warning", "error", "hint");
        severityBox.getSelectionModel().select("warning");

        Button createBtn = new Button("Create Marker");
        Button loadBtn = new Button("Load Sample Code");
        Button clearBtn = new Button("Clear Text");

        // Layout the small form nicely
        GridPane form = new GridPane();
        form.setHgap(8);
        form.setVgap(6);
        form.addRow(0, new Label("Line:"), lineField, new Label("Severity:"), severityBox);
        form.addRow(1, new Label("Message:"), messageField);

        HBox actions = new HBox(10, createBtn, loadBtn, clearBtn);

        VBox controlPanel = new VBox(10, title, form, actions);
        controlPanel.setPadding(new Insets(10));

        BorderPane root = new BorderPane();
        root.setTop(controlPanel);
        root.setCenter(editor);

        // Wire actions
        loadBtn.setOnAction(e -> editor.loadEditor(sampleCode, "java", null));
        clearBtn.setOnAction(e -> editor.setText(""));

        createBtn.setOnAction(e -> {
            int line;
            try {
                line = Integer.parseInt(lineField.getText().trim());
            } catch (NumberFormatException ex) {
                line = 1;
            }
            String message = messageField.getText();
            String severity = severityBox.getValue(); // one of info|warning|error|hint
            editor.createMarker(line, message, severity);
            System.out.println("Marker created at line " + line + " [" + severity + "]: " + message);
        });

        // Initialize editor with sample code
        editor.loadEditor(sampleCode, "java", null);

        Scene scene = new Scene(root, 900, 650);
        primaryStage.setTitle("Monaco Editor - Marker Test");
        primaryStage.setScene(scene);
        primaryStage.show();
    }

    public static void main(String[] args) {
        launch(args);
    }
}
