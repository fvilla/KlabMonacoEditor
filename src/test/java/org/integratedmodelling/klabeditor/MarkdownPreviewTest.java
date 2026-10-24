package org.integratedmodelling.klabeditor;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;

class MarkdownPreviewTest {
    @Test void rendersCommonMarkdownStructures() {
        String html = MarkdownPreview.renderHtml("# Title\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n- [x] Complete\n\n~~old~~\n\n```java\nint value = 1;\n```", false);
        assertTrue(html.contains("<h1>Title</h1>"));
        assertTrue(html.contains("<table>"));
        assertTrue(html.contains("<del>old</del>"));
        assertTrue(html.contains("type=\"checkbox\""));
        assertTrue(html.contains("class=\"language-java\""));
    }

    @Test void projectHtmlCannotExecuteOrRequestExternalResources() {
        String html = MarkdownPreview.renderHtml("<script>alert('x')</script>\n\n[bad](javascript:alert(1))", true);
        assertFalse(html.contains("<script>"));
        assertTrue(html.contains("&lt;script&gt;"));
        assertFalse(html.contains("href=\"javascript:"));
        assertTrue(html.contains("default-src 'none'"));
    }
}
