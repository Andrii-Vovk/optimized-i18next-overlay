import {
  window,
  TextEditor,
  TextDocument,
  DecorationOptions,
  TextEditorDecorationType,
  Range,
  workspace,
  ThemeColor,
} from 'vscode';
import { KeyDetector, DetectedKey } from './keyDetector';
import { TranslationLoader } from './translationLoader';
import { logger } from './logger';

/**
 * Manages text decorations for translation overlays
 */
export class DecorationManager {
  private decorationType: TextEditorDecorationType;
  private hideContentType: TextEditorDecorationType;
  private translationLoader: TranslationLoader;
  private currentEditor: TextEditor | undefined;

  constructor(translationLoader: TranslationLoader) {
    this.translationLoader = translationLoader;

    // Create decoration type for overlay text (inlay hint)
    this.decorationType = window.createTextEditorDecorationType({
      before: {
        margin: '0 0.1em 0 0',
      },
    });

    // Create decoration type to hide content using i18n-ally's hack
    // Injecting 'display: none;' in textDecoration to actually collapse the text
    this.hideContentType = window.createTextEditorDecorationType({
      textDecoration: 'none; display: none;', // a hack to inject custom style
    });
  }

  /**
   * Update decorations for the active editor
   */
  updateDecorations(editor?: TextEditor): void {
    const activeEditor = editor || window.activeTextEditor;
    if (!activeEditor) {
      logger.debug('No active editor, skipping decoration update');
      return;
    }

    logger.debug('Updating decorations', { 
      fileName: activeEditor.document.fileName,
      languageId: activeEditor.document.languageId 
    });

    this.currentEditor = activeEditor;
    const document = activeEditor.document;

    // Check if enabled
    const config = workspace.getConfiguration('i18nOverlay');
    const enabled = config.get<boolean>('enabled', true);
    if (!enabled) {
      logger.debug('Extension disabled, clearing decorations');
      this.clearDecorations(activeEditor);
      return;
    }

    // Check if file type is allowed
    const allowedFileTypes = config.get<string[]>('allowedFileTypes', ['javascript', 'typescript', 'javascriptreact', 'typescriptreact']);
    const languageId = document.languageId;
    
    // If allowedFileTypes is empty, allow all file types
    // Otherwise, check if current language is in the allowed list
    if (allowedFileTypes.length > 0 && !allowedFileTypes.includes(languageId)) {
      logger.debug('File type not allowed, clearing decorations', { languageId, allowedFileTypes });
      this.clearDecorations(activeEditor);
      return;
    }

    // Detect keys in document
    const keys = KeyDetector.getKeys(document);
    if (keys.length === 0) {
      logger.debug('No keys detected, clearing decorations');
      this.clearDecorations(activeEditor);
      return;
    }

    // Get locale
    const locale = config.get<string>('defaultLocale', 'en');
    const delimiter = config.get<string>('annotationDelimiter', ' → ');
    const maxHintLength = config.get<number>('maxHintLength', 50);
    logger.debug('Decoration config', { locale, delimiter, maxHintLength, keyCount: keys.length });

    // Get current selection/cursor position
    const selection = activeEditor.selection;
    const cursorOffset = document.offsetAt(selection.active);

    // Create decorations
    const decorations: DecorationOptions[] = [];
    const hideDecorations: DecorationOptions[] = [];
    let foundCount = 0;
    let missingCount = 0;

    // Get all locales for counting translations
    const allLocales = this.translationLoader.getLocales();

    for (const detectedKey of keys) {
      // Check if cursor is inside this function call
      // If cursor is within the range, skip decorations to show original text
      const isCursorInside = cursorOffset >= detectedKey.start && cursorOffset <= detectedKey.end;
      
      if (isCursorInside) {
        logger.debug('Cursor inside function call, skipping decorations', {
          key: detectedKey.key,
          cursorOffset,
          start: detectedKey.start,
          end: detectedKey.end
        });
        continue; // Skip this key - show original text
      }
      // Position the overlay right after the opening parenthesis (e.g., t(...))
      // If openingParenPos is available, use it; otherwise fall back to start position
      const openingParenPos = detectedKey.openingParenPos !== undefined 
        ? detectedKey.openingParenPos
        : detectedKey.start;
      
      // If multiline, don't hide anything, just show hint after content
      // Otherwise, hide only the part after => (keep ($) => visible)
      let overlayPosition: number;
      let overlayRange: Range;
      
      if (detectedKey.isMultiline) {
        // For multiline: show hint after the content (at the end)
        overlayPosition = detectedKey.end;
        overlayRange = new Range(
          document.positionAt(overlayPosition),
          document.positionAt(overlayPosition)
        );
      } else {
        // For single line: show hint right after => + 1 space
        overlayPosition = detectedKey.arrowPos !== undefined
          ? detectedKey.arrowPos + 1 // Add 1 space after =>
          : openingParenPos + 1;
        overlayRange = new Range(
          document.positionAt(overlayPosition),
          document.positionAt(overlayPosition)
        );
        
        // Hide only the part after => (the property access)
        // Start hiding from after the space following =>
        if (detectedKey.arrowPos !== undefined && detectedKey.arrowFunctionEndPos !== undefined) {
          const hideStart = detectedKey.arrowPos + 1; // Start after => and space
          const hideEnd = detectedKey.arrowFunctionEndPos;
          
          if (hideStart < hideEnd) {
            const hideRange = new Range(
              document.positionAt(hideStart),
              document.positionAt(hideEnd)
            );
            hideDecorations.push({ range: hideRange });
            logger.debug('Hiding property access after =>', { 
              hideStart, 
              hideEnd,
              arrowPos: detectedKey.arrowPos
            });
          }
        }
      }

      // Get translation (explicit namespace from code takes precedence)
      // If no explicit namespace, the key may already include file-based namespace
      const translation = this.translationLoader.getValue(
        detectedKey.key, 
        locale, 
        undefined, 
        detectedKey.namespace
      );
      logger.debug('Translation lookup', { 
        key: detectedKey.key,
        namespace: detectedKey.namespace,
        locale, 
        found: !!translation,
        translation: translation?.substring(0, 50),
        openingParenPos,
        arrowPos: detectedKey.arrowPos,
        isMultiline: detectedKey.isMultiline,
        overlayPosition
      });

      // Count translations across all locales
      let translationCount = 0;
      for (const loc of allLocales) {
        const value = this.translationLoader.getValue(
          detectedKey.key,
          loc,
          undefined,
          detectedKey.namespace
        );
        if (value) {
          translationCount++;
        }
      }
      const totalLocales = allLocales.length;
      const hasMissingTranslations = translationCount < totalLocales && totalLocales > 1;

      // Add overlay text (inlay hint) - shows translation instead of arrow function
      // Use 'before' to insert the translation right after the opening paren
      // Styled with muted color, background, and border (using CSS string like i18n-ally)
      if (translation) {
        foundCount++;
        // Truncate translation if it exceeds max length
        let displayText = translation;
        if (maxHintLength > 0 && translation.length > maxHintLength) {
          displayText = translation.substring(0, maxHintLength) + '…';
        }
        
        // Prepend x/y indicator if translations are missing
        const prefix = hasMissingTranslations ? `${translationCount}/${totalLocales} ` : '';
        
        // Use a more muted color - descriptionForeground is already muted, use it for both text and border
        decorations.push({
          range: overlayRange,
          renderOptions: {
            before: {
              contentText: `${prefix}${delimiter}${displayText} `,
              color: hasMissingTranslations ? '#d4a017' : new ThemeColor('descriptionForeground'),
              fontStyle: 'normal',
              backgroundColor: new ThemeColor('editor.background'),
              // Border uses CSS variable for the same color as text
              border: hasMissingTranslations 
                ? '0.5px solid #d4a017; border-radius: 2px; padding: 1px 3px;'
                : '0.5px solid var(--vscode-descriptionForeground); border-radius: 2px; padding: 1px 3px;',
            },
          },
        });
      } else {
        missingCount++;
        // Prepend x/y indicator if translations are missing
        const prefix = hasMissingTranslations ? `${translationCount}/${totalLocales} ` : '';
        
        // Show missing indicator
        decorations.push({
          range: overlayRange,
          renderOptions: {
            before: {
              contentText: `${prefix}${delimiter}[missing] `,
              color: hasMissingTranslations ? '#d4a017' : new ThemeColor('errorForeground'),
              fontStyle: 'normal',
              backgroundColor: new ThemeColor('editor.background'),
              // Border uses CSS variable for the same color as text
              border: hasMissingTranslations
                ? '0.5px solid #d4a017; border-radius: 2px; padding: 1px 3px;'
                : '0.5px solid var(--vscode-errorForeground); border-radius: 2px; padding: 1px 3px;',
            },
          },
        });
      }
    }

    // Apply decorations
    logger.info('Applying decorations', { 
      total: keys.length,
      found: foundCount,
      missing: missingCount,
      decorations: decorations.length,
      hideDecorations: hideDecorations.length
    });
    
    activeEditor.setDecorations(this.decorationType, decorations);
    activeEditor.setDecorations(this.hideContentType, hideDecorations);
  }

  /**
   * Clear all decorations
   */
  clearDecorations(editor?: TextEditor): void {
    const targetEditor = editor || this.currentEditor || window.activeTextEditor;
    if (targetEditor) {
      logger.debug('Clearing decorations', { fileName: targetEditor.document.fileName });
      targetEditor.setDecorations(this.decorationType, []);
      targetEditor.setDecorations(this.hideContentType, []);
    }
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.decorationType.dispose();
    this.hideContentType.dispose();
  }
}
