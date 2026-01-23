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
  private translationLoader: TranslationLoader;
  private currentEditor: TextEditor | undefined;

  constructor(translationLoader: TranslationLoader) {
    this.translationLoader = translationLoader;

    // Create decoration type for overlay text (inlay hint)
    this.decorationType = window.createTextEditorDecorationType({
      after: {
        margin: '0 0 0 1em',
      },
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
    logger.debug('Decoration config', { locale, delimiter, keyCount: keys.length });

    // Create decorations
    const decorations: DecorationOptions[] = [];
    let foundCount = 0;
    let missingCount = 0;

    for (const detectedKey of keys) {
      const range = new Range(
        document.positionAt(detectedKey.start),
        document.positionAt(detectedKey.end)
      );

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
        translation: translation?.substring(0, 50) 
      });

      // Add overlay text (inlay hint) - no styling changes to original text
      if (translation) {
        foundCount++;
        decorations.push({
          range,
          renderOptions: {
            after: {
              contentText: `${delimiter}${translation}`,
              color: new ThemeColor('descriptionForeground'),
              fontStyle: 'italic',
            },
          },
        });
      } else {
        missingCount++;
        // Show missing indicator
        decorations.push({
          range,
          renderOptions: {
            after: {
              contentText: `${delimiter}[missing]`,
              color: new ThemeColor('errorForeground'),
              fontStyle: 'italic',
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
      decorations: decorations.length
    });
    
    activeEditor.setDecorations(this.decorationType, decorations);
  }

  /**
   * Clear all decorations
   */
  clearDecorations(editor?: TextEditor): void {
    const targetEditor = editor || this.currentEditor || window.activeTextEditor;
    if (targetEditor) {
      logger.debug('Clearing decorations', { fileName: targetEditor.document.fileName });
      targetEditor.setDecorations(this.decorationType, []);
    }
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.decorationType.dispose();
  }
}
