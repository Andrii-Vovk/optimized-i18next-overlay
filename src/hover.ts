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

      // Create markdown content
      const markdown = new vscode.MarkdownString();
      markdown.isTrusted = true; // Allow command links

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

      // Show all locales with globe icons
      for (const { locale, value } of translations) {
        const localeLabel = locale === defaultLocale ? `**${locale}** (default)` : `**${locale}**`;
        
        if (value) {
          // Translation exists - show it with globe icon
          const escapedValue = value
            .replace(/\\/g, "\\\\")
            .replace(/\*/g, "\\*")
            .replace(/_/g, "\\_")
            .replace(/`/g, "\\`")
            .replace(/\[/g, "\\[")
            .replace(/\]/g, "\\]");
          
          // Create command URI to add/update translation for this locale
          const commandArgs = encodeURIComponent(
            JSON.stringify({
              key: detectedKey.key,
              locale: locale,
              namespace: detectedKey.namespace || undefined,
              sourceText: sourceText,
            })
          );
          const commandUri = `command:i18nOverlay.addTranslationToLocale?${commandArgs}`;
          
          markdown.appendMarkdown(
            `${localeLabel}: ${escapedValue} [🌐 Translate](${commandUri} "Add/update translation for ${locale}")\n\n`
          );
        } else {
          // Translation missing - show with globe icon that opens Google Translate
          // Create command URI to add translation for this locale
          const commandArgs = encodeURIComponent(
            JSON.stringify({
              key: detectedKey.key,
              locale: locale,
              namespace: detectedKey.namespace || undefined,
              sourceText: sourceText,
            })
          );
          const commandUri = `command:i18nOverlay.addTranslationToLocale?${commandArgs}`;
          
          markdown.appendMarkdown(
            `${localeLabel}: *missing* [🌐 Translate](${commandUri} "Add translation for ${locale}")\n\n`
          );
        }
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
