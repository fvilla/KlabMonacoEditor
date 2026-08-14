package org.integratedmodelling.klabeditor.lsp;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class KlabLspServiceTest {

  @Test
  void languageMetadataIsOptionalWithoutLspInitialization() {
    var keywords =
        assertDoesNotThrow(() -> KlabLspService.getInstance().getLanguageKeywords("kim"));

    assertTrue(keywords.isEmpty());
  }

  @Test
  void highlightingAndLspInitializationAreNullSafe() {
    var service = KlabLspService.getInstance();

    assertFalse(service.ensureHighlightingMetadata(null));
    assertFalse(assertDoesNotThrow(() -> service.ensureInitialized(null, null)));
  }
}
