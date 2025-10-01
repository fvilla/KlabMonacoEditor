package org.integratedmodelling.klabeditor;

import javafx.application.Application;
import javafx.geometry.Insets;
import javafx.scene.Scene;
import javafx.scene.control.Button;
import javafx.scene.control.CheckBox;
import javafx.scene.control.Label;
import javafx.scene.layout.BorderPane;
import javafx.scene.layout.HBox;
import javafx.scene.layout.VBox;
import javafx.stage.Stage;

/**
 * Test application to demonstrate line numbers functionality in MonacoEditorView.
 */
public class LineNumbersTest extends Application {

    @Override
    public void start(Stage primaryStage) {
        MonacoEditorView editor = new MonacoEditorView();

        // Create control panel
        VBox controlPanel = new VBox(10);
        controlPanel.setPadding(new Insets(10));

        Label title = new Label("Monaco Editor - Line Numbers Test");
        title.setStyle("-fx-font-size: 16px; -fx-font-weight: bold;");

        CheckBox lineNumbersCheckbox = new CheckBox("Show Line Numbers");
        lineNumbersCheckbox.setSelected(true); // Default state

        Button testButton = new Button("Load Sample Code");
        Button clearButton = new Button("Clear Content");

        HBox buttonBox = new HBox(10, testButton, clearButton);

        controlPanel.getChildren().addAll(title, lineNumbersCheckbox, buttonBox);

        // Set up the layout
        BorderPane root = new BorderPane();
        root.setTop(controlPanel);
        root.setCenter(editor);

        // Sample code for testing
        String sampleCode = """
            public class HelloWorld {
                public static void main(String[] args) {
                    System.out.println("Hello, World!");

                    for (int i = 0; i < 10; i++) {
                        System.out.println("Line " + (i + 1));
                    }

                    // This is a comment
                    String message = "Testing line numbers";
                    System.out.println(message);
                }
            }
            """;

        // Event handlers
        lineNumbersCheckbox.setOnAction(e -> {
            boolean show = lineNumbersCheckbox.isSelected();
            editor.setLineNumbers(show);
            System.out.println("Line numbers " + (show ? "enabled" : "disabled"));
        });

        testButton.setOnAction(e -> {
            editor.loadEditor(sampleCode, "java", null);
            System.out.println("Sample code loaded");
        });

        clearButton.setOnAction(e -> {
            editor.setText("");
            System.out.println("Content cleared");
        });

        // Initialize editor with sample code
        editor.loadEditor(sampleCode, "java", null);

        Scene scene = new Scene(root, 800, 600);
        primaryStage.setTitle("Monaco Editor - Line Numbers Test");
        primaryStage.setScene(scene);
        primaryStage.show();

        // Test line numbers functionality after a brief delay
        new Thread(() -> {
            try {
                Thread.sleep(2000); // Wait for editor to initialize

                // Test getting line numbers visibility
                boolean visible = editor.isLineNumbersVisible();
                System.out.println("Line numbers initially visible: " + visible);

                // Test toggling line numbers
                Thread.sleep(2000);
                editor.setLineNumbers(false);
                System.out.println("Line numbers hidden");

                Thread.sleep(2000);
                editor.setLineNumbers(true);
                System.out.println("Line numbers shown again");

            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
            }
        }).start();
    }

    public static void main(String[] args) {
        launch(args);
    }
}
