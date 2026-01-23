import * as vscode from 'vscode';
import { TranslationLoader } from './translationLoader';
import { DecorationManager } from './decoration';
import { logger } from './logger';
import { formatTFunction } from './utils';

let translationLoader: TranslationLoader | undefined;
let decorationManager: DecorationManager | undefined;

/**
 * Initialize command handlers with required dependencies
 */
export function initializeCommands(
  loader: TranslationLoader,
  manager: DecorationManager
): void {
  translationLoader = loader;
  decorationManager = manager;
}

/**
 * Command handler for reloading translations
 */
export async function handleReload(): Promise<void> {
  logger.info('Manual reload command triggered');
  try {
    await translationLoader?.reload();
    logger.info('Translations reloaded successfully');
    decorationManager?.updateDecorations();
    vscode.window.showInformationMessage('i18n translations reloaded');
  } catch (error) {
    logger.error('Failed to reload translations:', error);
    vscode.window.showErrorMessage('Failed to reload translations. Check output for details.');
  }
}

/**
 * Command handler for showing logs
 */
export function handleShowLogs(): void {
  logger.showOutputChannel();
  logger.info('Output channel opened');
}

/**
 * Command handler for inserting t function
 */
export async function handleInsertTFunction(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('No active editor');
    return;
  }

  if (!translationLoader) {
    vscode.window.showErrorMessage('Translation loader not initialized');
    return;
  }

  const config = vscode.workspace.getConfiguration('i18nOverlay');
  const defaultLocale = config.get<string>('defaultLocale', 'en');

  // Get all translation keys
  const allKeys = translationLoader.getAllKeys(defaultLocale);
  if (allKeys.length === 0) {
    vscode.window.showWarningMessage('No translations found');
    return;
  }

  // Create quick pick items with key and preview
  const items = allKeys.map(key => {
    const info = translationLoader!.getTranslationInfo(key, defaultLocale);
    const preview = info.value || '(no translation)';
    const detail = info.namespace 
      ? `Namespace: ${info.namespace}${info.interpolations.length > 0 ? ` | Variables: ${info.interpolations.join(', ')}` : ''}`
      : info.interpolations.length > 0 
        ? `Variables: ${info.interpolations.join(', ')}`
        : undefined;
    
    return {
      label: key,
      description: preview.length > 60 ? preview.substring(0, 60) + '...' : preview,
      detail: detail,
      key: key
    };
  });

  // Show quick pick
  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Search for a translation key...',
    matchOnDescription: true,
    matchOnDetail: true
  });

  if (!selected) {
    return;
  }

  // Get translation info for selected key
  const info = translationLoader.getTranslationInfo(selected.key, defaultLocale);
  
  // Format and insert the t function (use key without namespace prefix)
  const tFunction = formatTFunction(info.keyWithoutNamespace, info.namespace, info.interpolations);
  
  // Insert at cursor position
  const position = editor.selection.active;
  await editor.edit(editBuilder => {
    editBuilder.insert(position, tFunction);
  });

  logger.info('Inserted t function', { key: selected.key, tFunction });
}
