import * as vscode from 'vscode';
import { TranslationLoader } from './translationLoader';
import { DecorationManager } from './decoration';
import { logger } from './logger';
import { initializeCommands, handleReload, handleShowLogs, handleInsertTFunction, handleExtractStringToLocale, handleAddMissingTranslation, handleAddTranslationToLocale } from './commands';
import { TranslationHoverProvider } from './hover';

let decorationManager: DecorationManager | undefined;
let translationLoader: TranslationLoader | undefined;

// Throttle decoration updates to avoid excessive calls
let updateTimeout: NodeJS.Timeout | undefined;
const THROTTLE_DELAY = 100; // ms

function throttleUpdateDecorations() {
  if (updateTimeout) {
    clearTimeout(updateTimeout);
  }
  updateTimeout = setTimeout(() => {
    logger.debug('Throttled decoration update triggered');
    decorationManager?.updateDecorations();
  }, THROTTLE_DELAY);
}

export function activate(context: vscode.ExtensionContext) {
  logger.info('i18n Overlay extension is now active!');
  logger.debug('Extension context:', { extensionPath: context.extensionPath });

  // Initialize translation loader
  logger.debug('Initializing translation loader...');
  translationLoader = new TranslationLoader();
  translationLoader.initialize().then(() => {
    logger.info('Translations loaded successfully');
    const locales = translationLoader?.getLocales() || [];
    logger.debug('Loaded locales:', locales);
    logger.debug('Updating decorations after translation load');
    decorationManager?.updateDecorations();
  }).catch((error) => {
    logger.error('Failed to initialize translations:', error);
  });

  // Initialize decoration manager
  logger.debug('Initializing decoration manager...');
  decorationManager = new DecorationManager(translationLoader);

  // Initialize command handlers
  initializeCommands(translationLoader, decorationManager);

  // Event listeners
  const disposables: vscode.Disposable[] = [
    // Active editor changed
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      logger.debug('Active editor changed', { 
        fileName: editor?.document.fileName,
        languageId: editor?.document.languageId 
      });
      throttleUpdateDecorations();
    }),

    // Document changed
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document === vscode.window.activeTextEditor?.document) {
        logger.debug('Document changed', { 
          fileName: e.document.fileName,
          changeCount: e.contentChanges.length 
        });
        throttleUpdateDecorations();
      }
    }),

    // Selection/cursor changed - update decorations to show/hide based on cursor position
    vscode.window.onDidChangeTextEditorSelection((e) => {
      if (e.textEditor === vscode.window.activeTextEditor) {
        logger.debug('Selection changed', { 
          fileName: e.textEditor.document.fileName,
          selection: e.selections[0] 
        });
        throttleUpdateDecorations();
      }
    }),

    // Configuration changed
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('i18nOverlay')) {
        logger.info('Configuration changed, reloading translations...');
        translationLoader?.reload().then(() => {
          logger.debug('Translations reloaded after config change');
          throttleUpdateDecorations();
        }).catch((error) => {
          logger.error('Failed to reload translations:', error);
        });
      }
    }),

    // Reload command
    vscode.commands.registerCommand('i18nOverlay.reload', handleReload),

    // Show output channel command
    vscode.commands.registerCommand('i18nOverlay.showLogs', handleShowLogs),

    // Insert t function command
    vscode.commands.registerCommand('i18nOverlay.insertTFunction', handleInsertTFunction),

    // Extract string to locale command
    vscode.commands.registerCommand('i18nOverlay.extractStringToLocale', handleExtractStringToLocale),

    // Add missing translation command
    vscode.commands.registerCommand('i18nOverlay.addMissingTranslation', handleAddMissingTranslation),

    // Add translation to specific locale command
    vscode.commands.registerCommand('i18nOverlay.addTranslationToLocale', handleAddTranslationToLocale),

    // Register hover provider
    vscode.languages.registerHoverProvider('*', new TranslationHoverProvider(translationLoader)),
  ];

  // Register all disposables
  context.subscriptions.push(...disposables);
  logger.debug('Registered event listeners', { count: disposables.length });

  // Initial update
  logger.debug('Performing initial decoration update');
  throttleUpdateDecorations();
}

export function deactivate() {
  logger.info('Deactivating i18n Overlay extension');
  decorationManager?.dispose();
  decorationManager = undefined;
  translationLoader = undefined;
  logger.debug('Extension deactivated');
}
