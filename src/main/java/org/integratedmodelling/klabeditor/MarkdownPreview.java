package org.integratedmodelling.klabeditor;

import com.vladsch.flexmark.ext.autolink.AutolinkExtension;
import com.vladsch.flexmark.ext.gfm.strikethrough.StrikethroughExtension;
import com.vladsch.flexmark.ext.gfm.tasklist.TaskListExtension;
import com.vladsch.flexmark.ext.tables.TablesExtension;
import com.vladsch.flexmark.html.HtmlRenderer;
import com.vladsch.flexmark.parser.Parser;
import com.vladsch.flexmark.util.data.MutableDataSet;
import java.util.List;
import javafx.concurrent.Worker;
import javafx.scene.layout.BorderPane;
import javafx.scene.web.WebView;
import org.w3c.dom.events.EventTarget;

/** Offline GFM-style preview, separate from Monaco's source editing and language services. */
public final class MarkdownPreview extends BorderPane implements AutoCloseable {
    private final WebView view = new WebView();

    public MarkdownPreview() {
        view.getEngine().setJavaScriptEnabled(false);
        view.getEngine().getLoadWorker().stateProperty().addListener((observable, before, after) -> {
            if (after == Worker.State.SUCCEEDED && view.getEngine().getDocument() != null) {
                // A preview never navigates the embedded browser to project or remote URLs.
                ((EventTarget) view.getEngine().getDocument()).addEventListener("click", event -> event.preventDefault(), true);
            }
        });
        setCenter(view);
    }

    /** May be called off the FX thread; raw HTML is displayed as text, never executed. */
    public static String renderHtml(String markdown, boolean dark) {
        var options = new MutableDataSet();
        options.set(Parser.EXTENSIONS, List.of(TablesExtension.create(), StrikethroughExtension.create(),
                TaskListExtension.create(), AutolinkExtension.create()));
        options.set(HtmlRenderer.ESCAPE_HTML, true);
        options.set(HtmlRenderer.SUPPRESSED_LINKS, "(?i)(?:javascript|vbscript|file|data):.*");
        String body = HtmlRenderer.builder(options).build().render(Parser.builder(options).build().parse(markdown));
        String foreground = dark ? "#e6edf3" : "#1f2328";
        String background = dark ? "#161b22" : "#ffffff";
        String border = dark ? "#484f58" : "#d0d7de";
        return "<!doctype html><html><head><meta charset='UTF-8'>"
                + "<meta http-equiv='Content-Security-Policy' content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data:\">"
                + "<style>body{color:" + foreground + ";background:" + background
                + ";font:15px system-ui,sans-serif;line-height:1.6;margin:24px;overflow-wrap:anywhere}"
                + "pre{padding:12px;overflow:auto;border:1px solid " + border + ";border-radius:6px}"
                + "code{font-family:monospace}table{border-collapse:collapse}td,th{padding:6px 12px;border:1px solid "
                + border + "}blockquote{border-left:4px solid " + border
                + ";margin-left:0;padding-left:16px}img{max-width:100%}a{color:#58a6ff}"
                + "h1,h2{border-bottom:1px solid " + border + "}</style></head><body>" + body + "</body></html>";
    }

    /** Supply HTML produced by renderHtml; invoke on the FX thread. */
    public void showRendered(String html) { view.getEngine().loadContent(html); }

    @Override public void close() { view.getEngine().load(null); setCenter(null); }
}
