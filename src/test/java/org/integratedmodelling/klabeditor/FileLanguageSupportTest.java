package org.integratedmodelling.klabeditor;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;

class FileLanguageSupportTest {
    @Test void choosesBundledLanguagesAndKeepsNotesSimple() {
        assertEquals("markdown", FileLanguageSupport.languageForPath("docs/README.MD"));
        assertEquals("css", FileLanguageSupport.languageForPath("assets/style.css"));
        assertEquals("ini", FileLanguageSupport.languageForPath("locales/messages.properties"));
        assertEquals("json", FileLanguageSupport.languageForPath("data/schema.json"));
        assertEquals("javascript", FileLanguageSupport.languageForPath("scripts/client.mjs"));
        assertTrue(FileLanguageSupport.isPlainText("notes.txt"));
        assertTrue(FileLanguageSupport.isPlainText("README"));
        assertFalse(FileLanguageSupport.isPlainText("Dockerfile"));
        assertFalse(FileLanguageSupport.isPlainText("README.md"));
        assertFalse(FileLanguageSupport.isPlainText("settings.custom"));
    }
}
