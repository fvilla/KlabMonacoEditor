package org.integratedmodelling.klabeditor;

import java.util.Locale;

/** Language IDs supplied by the bundled Monaco distribution; unknown text remains editable. */
public final class FileLanguageSupport {
    private FileLanguageSupport() {}

    public static String languageForPath(String path) {
        String name = path.substring(path.lastIndexOf('/') + 1).toLowerCase(Locale.ROOT);
        if (name.equals("dockerfile")) return "dockerfile";
        String extension = name.substring(name.lastIndexOf('.') + 1);
        return switch (extension) {
            case "md", "markdown", "mdown" -> "markdown";
            case "css", "scss", "less", "html", "xml", "json", "yaml", "sql", "java", "python", "r" -> extension;
            case "htm" -> "html";
            case "svg", "xsd", "xsl" -> "xml";
            case "js", "mjs", "cjs" -> "javascript";
            case "ts" -> "typescript";
            case "jsx" -> "javascript";
            case "tsx" -> "typescript";
            case "yml" -> "yaml";
            case "properties", "ini", "conf", "cfg", "toml" -> "ini";
            case "py" -> "python";
            case "sh", "bash" -> "shell";
            case "ps1" -> "powershell";
            default -> "plaintext";
        };
    }

    /** Keep a fast simple editor for ordinary text and extensionless notes. */
    public static boolean isPlainText(String path) {
        String name = path.substring(path.lastIndexOf('/') + 1).toLowerCase(Locale.ROOT);
        return (name.indexOf('.') < 0 && languageForPath(path).equals("plaintext"))
                || name.endsWith(".txt") || name.endsWith(".text") || name.endsWith(".log");
    }
}
