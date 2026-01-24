import * as vscode from "vscode";
import { TranslationLoader } from "./translationLoader";
import { DecorationManager } from "./decoration";
import { logger } from "./logger";
import { formatTFunction } from "./utils";
import { translateText, getGoogleTranslateLangCode } from "./translateApi";

let translationLoader: TranslationLoader | undefined;
let decorationManager: DecorationManager | undefined;

/**
 * Initialize command handlers with required dependencies
 */
export function initializeCommands(loader: TranslationLoader, manager: DecorationManager): void {
  translationLoader = loader;
  decorationManager = manager;
}

/**
 * Command handler for reloading translations
 */
export async function handleReload(): Promise<void> {
  logger.info("Manual reload command triggered");
  try {
    await translationLoader?.reload();
    logger.info("Translations reloaded successfully");
    decorationManager?.updateDecorations();
    vscode.window.showInformationMessage("i18n translations reloaded");
  } catch (error) {
    logger.error("Failed to reload translations:", error);
    vscode.window.showErrorMessage("Failed to reload translations. Check output for details.");
  }
}

/**
 * Command handler for showing logs
 */
export function handleShowLogs(): void {
  logger.showOutputChannel();
  logger.info("Output channel opened");
}

/**
 * Command handler for inserting t function
 */
export async function handleInsertTFunction(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("No active editor");
    return;
  }

  if (!translationLoader) {
    vscode.window.showErrorMessage("Translation loader not initialized");
    return;
  }

  const config = vscode.workspace.getConfiguration("i18nOverlay");
  const defaultLocale = config.get<string>("defaultLocale", "en");

  // Get all translation keys
  const allKeys = translationLoader.getAllKeys(defaultLocale);
  if (allKeys.length === 0) {
    vscode.window.showWarningMessage("No translations found");
    return;
  }

  // Create quick pick items with key and preview
  const items = allKeys.map((key) => {
    const info = translationLoader!.getTranslationInfo(key, defaultLocale);
    const preview = info.value || "(no translation)";
    const detail = info.namespace
      ? `Namespace: ${info.namespace}${
          info.interpolations.length > 0 ? ` | Variables: ${info.interpolations.join(", ")}` : ""
        }`
      : info.interpolations.length > 0
      ? `Variables: ${info.interpolations.join(", ")}`
      : undefined;

    return {
      label: key,
      description: preview.length > 60 ? preview.substring(0, 60) + "..." : preview,
      detail: detail,
      key: key,
    };
  });

  // Show quick pick
  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: "Search for a translation key...",
    matchOnDescription: true,
    matchOnDetail: true,
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
  await editor.edit((editBuilder) => {
    editBuilder.insert(position, tFunction);
  });

  logger.info("Inserted t function", { key: selected.key, tFunction });
}

/**
 * Command handler for extracting selected string to locale files
 */
export async function handleExtractStringToLocale(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("No active editor");
    return;
  }

  if (!translationLoader) {
    vscode.window.showErrorMessage("Translation loader not initialized");
    return;
  }

  // Get selected text
  const selection = editor.selection;
  if (selection.isEmpty) {
    vscode.window.showWarningMessage("Please select a string to extract");
    return;
  }

  const selectedText = editor.document.getText(selection);
  if (!selectedText || selectedText.trim().length === 0) {
    vscode.window.showWarningMessage("Selected text is empty");
    return;
  }

  // Clean up the selected text (remove quotes if present)
  let textToExtract = selectedText.trim();
  const isQuoted =
    (textToExtract.startsWith('"') && textToExtract.endsWith('"')) ||
    (textToExtract.startsWith("'") && textToExtract.endsWith("'")) ||
    (textToExtract.startsWith("`") && textToExtract.endsWith("`"));

  if (isQuoted) {
    textToExtract = textToExtract.slice(1, -1);
    // Unescape if needed
    textToExtract = textToExtract.replace(/\\(.)/g, "$1");
  }

  if (textToExtract.length === 0) {
    vscode.window.showWarningMessage("Text to extract is empty");
    return;
  }

  // Prompt for translation key
  const keyInput = await vscode.window.showInputBox({
    prompt: "Enter translation key (e.g., labels.title or common.button.save)",
    placeHolder: "labels.title",
    validateInput: (value) => {
      if (!value || value.trim().length === 0) {
        return "Translation key cannot be empty";
      }
      if (!/^[a-zA-Z0-9._-]+$/.test(value)) {
        return "Translation key can only contain letters, numbers, dots, underscores, and hyphens";
      }
      return null;
    },
  });

  if (!keyInput) {
    return;
  }

  const translationKey = keyInput.trim();

  // Prompt for namespace (optional)
  const config = vscode.workspace.getConfiguration("i18nOverlay");
  const useFileNameAsNamespace = config.get<boolean>("useFileNameAsNamespace", true);
  const defaultNamespace = config.get<string>("defaultNamespace", "common");

  let namespace: string | null | undefined = null;

  if (useFileNameAsNamespace) {
    const namespaceInput = await vscode.window.showInputBox({
      prompt: "Enter namespace (optional, press Enter to skip)",
      placeHolder: defaultNamespace,
      ignoreFocusOut: true,
    });

    if (namespaceInput !== undefined) {
      namespace = namespaceInput.trim() || null;
    } else {
      return; // User cancelled
    }
  }

  // Get all locales
  const locales = translationLoader.getLocales();
  if (locales.length === 0) {
    vscode.window.showErrorMessage("No locale files found. Please ensure locale files are configured.");
    return;
  }

  // Show progress
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Extracting string to locale files",
      cancellable: false,
    },
    async (progress) => {
      try {
        if (!translationLoader) {
          vscode.window.showErrorMessage("Translation loader not initialized");
          return;
        }
        // Add translation to all locales (or at least default locale)
        const defaultLocale = config.get<string>("defaultLocale", "en");

        // If default locale exists, add to it; otherwise add to first locale
        const targetLocale = locales.includes(defaultLocale) ? defaultLocale : locales[0];

        progress.report({ increment: 50, message: `Adding to ${targetLocale}...` });

        await translationLoader.addTranslation(targetLocale, translationKey, textToExtract, namespace || undefined);

        progress.report({ increment: 50, message: "Reloading translations..." });

        // Ask if user wants to replace selected text with t() function
        const replaceText = await vscode.window.showQuickPick(["Yes", "No"], {
          placeHolder: "Replace selected text with translation function?",
          ignoreFocusOut: true,
        });

        if (replaceText === "Yes") {
          // Format the t function using the key and namespace we just added
          // Use the namespace only if it's not the default namespace
          const finalNamespace = namespace && namespace !== defaultNamespace ? namespace : undefined;
          const tFunction = formatTFunction(translationKey, finalNamespace, []);

          // Replace selected text
          await editor.edit((editBuilder) => {
            editBuilder.replace(selection, tFunction);
          });

          logger.info("Replaced selected text with t function", {
            originalText: selectedText,
            tFunction,
            key: translationKey,
          });
        }

        vscode.window.showInformationMessage(`String extracted to locale files: ${translationKey}`);

        logger.info("String extracted successfully", {
          key: translationKey,
          value: textToExtract,
          namespace,
          locale: targetLocale,
        });
      } catch (error) {
        logger.error("Failed to extract string:", error);
        vscode.window.showErrorMessage(
          `Failed to extract string: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );
}

/**
 * Command handler for adding missing translation from hover
 */
export async function handleAddMissingTranslation(args?: {
  key: string;
  namespace?: string;
}): Promise<void> {
  if (!args || !args.key) {
    vscode.window.showErrorMessage("No translation key provided");
    return;
  }

  if (!translationLoader) {
    vscode.window.showErrorMessage("Translation loader not initialized");
    return;
  }

  // Store reference for use in async callbacks (safe because we checked above)
  const loader: TranslationLoader = translationLoader;
  const { key, namespace: providedNamespace } = args;

  // Get configuration
  const config = vscode.workspace.getConfiguration("i18nOverlay");
  const useFileNameAsNamespace = config.get<boolean>("useFileNameAsNamespace", true);
  const defaultNamespace = config.get<string>("defaultNamespace", "common");

  // Determine the namespace to use based on configuration
  // If namespace was explicitly provided from the code (detectedKey.namespace), use it
  // Otherwise, respect the configuration settings
  const finalNamespace: string | undefined = providedNamespace
    ? providedNamespace
    : !useFileNameAsNamespace && defaultNamespace
    ? defaultNamespace
    : undefined;

  // Prompt for translation value
  const valueInput = await vscode.window.showInputBox({
    prompt: `Enter translation value for key: ${key}`,
    placeHolder: "Translation text...",
    validateInput: (value) => {
      if (!value || value.trim().length === 0) {
        return "Translation value cannot be empty";
      }
      return null;
    },
  });

  if (!valueInput) {
    return;
  }

  const translationValue = valueInput.trim();

  // Get locales
  const defaultLocale = config.get<string>("defaultLocale", "en");
  const locales = loader.getLocales();

  if (locales.length === 0) {
    vscode.window.showErrorMessage("No locale files found. Please ensure locale files are configured.");
    return;
  }

  // Show progress
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Adding missing translation",
      cancellable: false,
    },
    async (progress) => {
      try {
        // Add to default locale (or first available)
        const targetLocale = locales.includes(defaultLocale) ? defaultLocale : locales[0];

        progress.report({ increment: 50, message: `Adding to ${targetLocale}...` });

        await loader.addTranslation(targetLocale, key, translationValue, finalNamespace);

        progress.report({ increment: 50, message: "Reloading translations..." });

        vscode.window.showInformationMessage(`Translation added: ${key}`);

        logger.info("Missing translation added from hover", {
          key,
          value: translationValue,
          namespace: finalNamespace,
          locale: targetLocale,
        });
      } catch (error) {
        logger.error("Failed to add missing translation:", error);
        vscode.window.showErrorMessage(
          `Failed to add translation: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );
}

/**
 * Command handler for adding translation to a specific locale (from Google Translate or manual)
 */
export async function handleAddTranslationToLocale(args?: {
  key: string;
  locale: string;
  namespace?: string;
  sourceText?: string;
}): Promise<void> {
  if (!args || !args.key || !args.locale) {
    vscode.window.showErrorMessage("Missing required parameters: key and locale");
    return;
  }

  if (!translationLoader) {
    vscode.window.showErrorMessage("Translation loader not initialized");
    return;
  }

  // Store reference for use in async callbacks (safe because we checked above)
  const loader: TranslationLoader = translationLoader;
  const { key, locale, namespace: providedNamespace, sourceText } = args;

  // Get configuration
  const config = vscode.workspace.getConfiguration("i18nOverlay");
  const useFileNameAsNamespace = config.get<boolean>("useFileNameAsNamespace", true);
  const defaultNamespace = config.get<string>("defaultNamespace", "common");
  const defaultLocale = config.get<string>("defaultLocale", "en");

  // Determine the namespace to use based on configuration
  const finalNamespace: string | undefined = providedNamespace
    ? providedNamespace
    : !useFileNameAsNamespace && defaultNamespace
    ? defaultNamespace
    : undefined;

  // Get source text for translation if not provided
  let sourceTranslation = sourceText;
  if (!sourceTranslation) {
    // Try to get from default locale
    sourceTranslation = loader.getValue(key, defaultLocale, undefined, finalNamespace);
    if (!sourceTranslation) {
      // Try to get from any locale
      const locales = loader.getLocales();
      for (const loc of locales) {
        const value = loader.getValue(key, loc, undefined, finalNamespace);
        if (value) {
          sourceTranslation = value;
          break;
        }
      }
    }
  }

  if (!sourceTranslation) {
    vscode.window.showErrorMessage("No source translation found to translate from");
    return;
  }

  // Automatically translate using Google Translate API
  let translationValue: string | undefined;
  
  try {
    // Show progress while translating
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Translating to ${locale}`,
        cancellable: false,
      },
      async (progress) => {
        progress.report({ increment: 50, message: "Fetching translation from Google Translate..." });

        const targetLangCode = getGoogleTranslateLangCode(locale);
        const sourceLangCode = getGoogleTranslateLangCode(defaultLocale);
        
        translationValue = await translateText(sourceTranslation, targetLangCode, sourceLangCode);
        
        progress.report({ increment: 50, message: "Translation received" });
      }
    );

    if (!translationValue) {
      vscode.window.showErrorMessage("Translation failed: No translation received");
      return;
    }

    const finalTranslationValue = translationValue.trim();

    // Show progress while adding translation
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Adding translation to ${locale}`,
        cancellable: false,
      },
      async (progress) => {
        progress.report({ increment: 50, message: `Adding to ${locale}...` });

        await loader.addTranslation(locale, key, finalTranslationValue, finalNamespace);

        progress.report({ increment: 50, message: "Reloading translations..." });
      }
    );

    vscode.window.showInformationMessage(`Translation added to ${locale}: ${key}`);

    logger.info("Translation added to locale from hover", {
      key,
      value: finalTranslationValue,
      namespace: finalNamespace,
      locale,
    });
  } catch (error) {
    logger.error("Failed to translate or add translation:", error);
    vscode.window.showErrorMessage(
      `Failed to translate: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
