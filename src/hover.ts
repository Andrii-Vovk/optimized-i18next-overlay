import * as vscode from "vscode";
import { KeyDetector } from "./keyDetector";
import { TranslationLoader } from "./translationLoader";
import { logger } from "./logger";

/**
 * Hover provider for translation keys
 */
export class TranslationHoverProvider implements vscode.HoverProvider {
  constructor(private translationLoader: TranslationLoader) {}

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Hover> {
    try {
      // Check if file type is allowed
      const config = vscode.workspace.getConfiguration("i18nOverlay");
      const allowedFileTypes = config.get<string[]>("allowedFileTypes", [
        "javascript",
        "typescript",
        "javascriptreact",
        "typescriptreact",
      ]);
      const languageId = document.languageId;

      // If allowedFileTypes is empty, allow all file types
      // Otherwise, check if current language is in the allowed list
      if (allowedFileTypes.length > 0 && !allowedFileTypes.includes(languageId)) {
        logger.debug("File type not allowed for hover", { languageId, allowedFileTypes });
        return null;
      }

      // Detect keys in document
      const keys = KeyDetector.getKeys(document);
      if (keys.length === 0) {
        return null;
      }

      // Find key at cursor position
      const offset = document.offsetAt(position);
      const detectedKey = keys.find((k) => k.start <= offset && k.end >= offset);
      if (!detectedKey) {
        return null;
      }

      logger.debug("Hover triggered", {
        key: detectedKey.key,
        namespace: detectedKey.namespace,
        offset,
      });

      const defaultLocale = config.get<string>("defaultLocale", "en");
      const maxHintLength = config.get<number>("maxHintLength", 50);
      const allLocales = this.translationLoader.getLocales();

      // Get translations for all locales
      const translations: Array<{ locale: string; value: string | undefined }> = [];
      let hasTranslation = false;
      let sourceText: string | undefined;

      for (const locale of allLocales) {
        const value = this.translationLoader.getValue(
          detectedKey.key,
          locale,
          undefined,
          detectedKey.namespace
        );
        translations.push({ locale, value });
        if (value) {
          hasTranslation = true;
          // Use first found translation or default locale as source
          if (!sourceText || locale === defaultLocale) {
            sourceText = value;
          }
        }
      }

      // If no translation found, try to get source from default locale or any locale
      if (!sourceText) {
        sourceText = this.translationLoader.getValue(
          detectedKey.key,
          defaultLocale,
          undefined,
          detectedKey.namespace
        );
        if (!sourceText && allLocales.length > 0) {
          for (const locale of allLocales) {
            const value = this.translationLoader.getValue(
              detectedKey.key,
              locale,
              undefined,
              detectedKey.namespace
            );
            if (value) {
              sourceText = value;
              break;
            }
          }
        }
      }

      // Calculate translation count
      const translationCount = translations.filter(t => t.value).length;
      const totalLocales = allLocales.length;
      const hasMissingTranslations = translationCount < totalLocales;

      // Create markdown content
      const markdown = new vscode.MarkdownString();
      markdown.isTrusted = true; // Allow command links

      // Add yellow x/y indicator if translations are missing
      if (hasMissingTranslations && totalLocales > 1) {
        markdown.appendMarkdown(`<span style="color: #d4a017;">**${translationCount}/${totalLocales}**</span> `);
      }

      if (hasTranslation) {
        // Show translations in all locales
        markdown.appendMarkdown("### Translations\n\n");
      } else {
        // No translation exists - show header
        markdown.appendMarkdown("### Translation Missing\n\n");
        markdown.appendMarkdown(
          `Translation key \`${detectedKey.key}\` not found in any locale.\n\n`
        );
      }

      // Sort translations: default locale first, then others
      const sortedTranslations = [...translations].sort((a, b) => {
        if (a.locale === defaultLocale) return -1;
        if (b.locale === defaultLocale) return 1;
        return a.locale.localeCompare(b.locale);
      });

      // Show all locales with buttons at the start
      for (const { locale, value } of sortedTranslations) {
        const localeLabel = `**${locale}**`;
        
        // Create command URIs (used for both existing and missing translations)
        const commandArgs = encodeURIComponent(
          JSON.stringify({
            key: detectedKey.key,
            locale: locale,
            namespace: detectedKey.namespace || undefined,
            sourceText: sourceText,
          })
        );
        const commandUri = `command:i18nOverlay.addTranslationToLocale?${commandArgs}`;
        
        const goToCommandArgs = encodeURIComponent(
          JSON.stringify({
            key: detectedKey.key,
            locale: locale,
            namespace: detectedKey.namespace || undefined,
          })
        );
        const goToCommandUri = `command:i18nOverlay.goToTranslation?${goToCommandArgs}`;
        
        const editCommandArgs = encodeURIComponent(
          JSON.stringify({
            key: detectedKey.key,
            locale: locale,
            namespace: detectedKey.namespace || undefined,
            currentValue: value || undefined,
          })
        );
        const editCommandUri = `command:i18nOverlay.editTranslation?${editCommandArgs}`;
        
        if (value) {
          // Translation exists - truncate if needed
          let displayValue = value;
          if (maxHintLength > 0 && value.length > maxHintLength) {
            displayValue = value.substring(0, maxHintLength) + "…";
          }
          
          // Escape markdown special characters
          const escapedValue = displayValue
            .replace(/\\/g, "\\\\")
            .replace(/\*/g, "\\*")
            .replace(/_/g, "\\_")
            .replace(/`/g, "\\`")
            .replace(/\[/g, "\\[")
            .replace(/\]/g, "\\]");
          
          // Show buttons before locale label
          markdown.appendMarkdown(
            `[↗️](${goToCommandUri}) [✏️](${editCommandUri}) [🌐](${commandUri}) ${localeLabel}: ${escapedValue}\n\n`
          );
        } else {
          // Translation missing - show buttons before locale label
          markdown.appendMarkdown(
            `[↗️](${goToCommandUri}) [✏️](${editCommandUri}) [🌐](${commandUri}) ${localeLabel}: *missing*\n\n`
          );
        }
      }

      // Add button to translate all locales if we have source text and multiple locales
      if (sourceText && allLocales.length > 1) {
        const translateAllCommandArgs = encodeURIComponent(
          JSON.stringify({
            key: detectedKey.key,
            namespace: detectedKey.namespace || undefined,
            sourceText: sourceText,
          })
        );
        const translateAllCommandUri = `command:i18nOverlay.translateAllLocales?${translateAllCommandArgs}`;
        markdown.appendMarkdown(`\n[🌍 Translate all languages](${translateAllCommandUri})\n\n`);
      }

      // Add key info
      markdown.appendMarkdown("\n---\n");
      markdown.appendMarkdown(`**Key**: \`${detectedKey.key}\`\n`);
      if (detectedKey.namespace) {
        markdown.appendMarkdown(`**Namespace**: \`${detectedKey.namespace}\`\n`);
      }

      const range = new vscode.Range(
        document.positionAt(detectedKey.start),
        document.positionAt(detectedKey.end)
      );

      return new vscode.Hover(markdown, range);
    } catch (error) {
      logger.error("Error providing hover:", error);
      return null;
    }
  }
}
