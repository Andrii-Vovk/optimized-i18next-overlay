import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { workspace, Uri } from 'vscode';
import { logger } from './logger';

export interface TranslationData {
  [locale: string]: {
    [key: string]: any;
  };
}

export interface FileNamespaceInfo {
  filePath: string;
  namespace?: string;
  locale: string;
}

/**
 * Loads and manages translation files
 */
export class TranslationLoader {
  private translations: TranslationData = {};
  private localeFiles: Map<string, string> = new Map(); // locale -> filepath
  private fileNamespaces: Map<string, FileNamespaceInfo> = new Map(); // filepath -> namespace info
  private useFileNameAsNamespace: boolean = true;
  private defaultNamespace: string = 'common';

  /**
   * Initialize and load translation files
   */
  async initialize(): Promise<void> {
    logger.info('Initializing translation loader...');
    const config = workspace.getConfiguration('i18nOverlay');
    const patterns = config.get<string[]>('localeFiles', ['**/locales/**/*.json']);
    this.useFileNameAsNamespace = config.get<boolean>('useFileNameAsNamespace', true);
    this.defaultNamespace = config.get<string>('defaultNamespace', 'common');
    logger.debug('Translation file patterns', { 
      patterns, 
      useFileNameAsNamespace: this.useFileNameAsNamespace,
      defaultNamespace: this.defaultNamespace 
    });
    
    await this.loadTranslations(patterns);
    const locales = this.getLocales();
    logger.info(`Translation loader initialized with ${locales.length} locale(s)`, { locales });
  }

  /**
   * Load translations from files matching glob patterns
   */
  private async loadTranslations(patterns: string[]): Promise<void> {
    logger.debug('Loading translations from patterns', { patterns });
    this.translations = {};
    this.localeFiles.clear();
    this.fileNamespaces.clear();

    const workspaceFolders = workspace.workspaceFolders;
    if (!workspaceFolders) {
      logger.warn('No workspace folders found');
      return;
    }

    logger.debug('Searching in workspace folders', { 
      count: workspaceFolders.length,
      folders: workspaceFolders.map(f => f.name) 
    });

    let totalFiles = 0;
    for (const folder of workspaceFolders) {
      for (const pattern of patterns) {
        logger.debug('Searching for files', { folder: folder.name, pattern });
        const files = await workspace.findFiles(
          new vscode.RelativePattern(folder, pattern),
          null,
          100
        );

        logger.debug(`Found ${files.length} file(s) matching pattern`, { pattern, count: files.length });
        totalFiles += files.length;

        for (const uri of files) {
          await this.loadTranslationFile(uri.fsPath);
        }
      }
    }

    logger.info(`Processed ${totalFiles} translation file(s)`);
  }

  /**
   * Load a single translation file
   */
  private async loadTranslationFile(filePath: string): Promise<void> {
    logger.debug('Loading translation file', { filePath });
    try {
      // Extract locale from filename (e.g., en.json, en-US.json, locales/en.json)
      const locale = this.extractLocaleFromPath(filePath);
      if (!locale) {
        logger.debug('Could not extract locale from path, skipping', { filePath });
        return;
      }

      // Extract namespace from file path if enabled
      const namespace = this.useFileNameAsNamespace 
        ? this.extractNamespaceFromPath(filePath, locale)
        : undefined;

      logger.debug('Extracted locale and namespace from file path', { filePath, locale, namespace });
      const content = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);

      if (!this.translations[locale]) {
        this.translations[locale] = {};
      }

      const keyCountBefore = Object.keys(this.translations[locale]).length;
      // Flatten nested objects, prefixing with namespace if enabled
      const prefix = namespace ? `${namespace}.` : '';
      this.flattenObject(data, prefix, this.translations[locale]);
      const keyCountAfter = Object.keys(this.translations[locale]).length;
      
      this.localeFiles.set(locale, filePath);
      
      // Store namespace info for this file
      this.fileNamespaces.set(filePath, {
        filePath,
        namespace,
        locale
      });
      
      logger.info(`Loaded translation file`, { 
        filePath, 
        locale,
        namespace,
        keysAdded: keyCountAfter - keyCountBefore,
        totalKeys: keyCountAfter 
      });
    } catch (error) {
      logger.error(`Failed to load translation file ${filePath}:`, error);
    }
  }

  /**
   * Extract locale from file path
   * Supports: en.json, en-US.json, locales/en.json, etc.
   */
  private extractLocaleFromPath(filePath: string): string | null {
    const basename = path.basename(filePath, path.extname(filePath));
    logger.debug('Extracting locale from path', { filePath, basename });
    
    // Check if basename looks like a locale (en, en-US, etc.)
    if (/^[a-z]{2}(-[A-Z]{2})?$/i.test(basename)) {
      const locale = basename.toLowerCase();
      logger.debug('Found locale in basename', { filePath, locale });
      return locale;
    }

    // Check parent directory
    const dirname = path.basename(path.dirname(filePath));
    if (/^[a-z]{2}(-[A-Z]{2})?$/i.test(dirname)) {
      const locale = dirname.toLowerCase();
      logger.debug('Found locale in parent directory', { filePath, locale, dirname });
      return locale;
    }

    logger.debug('Could not extract locale from path', { filePath, basename, dirname });
    return null;
  }

  /**
   * Extract namespace from file path
   * Examples:
   * - locales/master-cover/en.json -> master-cover
   * - locales/en/master-cover.json -> master-cover
   * - locales/en.json -> undefined (no namespace)
   */
  private extractNamespaceFromPath(filePath: string, locale: string): string | undefined {
    const basename = path.basename(filePath, path.extname(filePath));
    const dirname = path.basename(path.dirname(filePath));
    
    logger.debug('Extracting namespace from path', { filePath, basename, dirname, locale });
    
    // If basename is the locale, namespace is in parent directory
    if (basename.toLowerCase() === locale.toLowerCase()) {
      // Check if parent directory is not a locale (i.e., it's a namespace)
      if (!/^[a-z]{2}(-[A-Z]{2})?$/i.test(dirname)) {
        const namespace = dirname;
        logger.debug('Found namespace in parent directory', { filePath, namespace, dirname });
        return namespace;
      }
    } else {
      // Basename is not a locale, so it might be a namespace
      // But only if it's not a locale code
      if (!/^[a-z]{2}(-[A-Z]{2})?$/i.test(basename)) {
        const namespace = basename;
        logger.debug('Found namespace in basename', { filePath, namespace, basename });
        return namespace;
      }
    }
    
    logger.debug('No namespace found in path', { filePath, basename, dirname });
    return undefined;
  }

  /**
   * Flatten nested object to dot-notation keys
   */
  private flattenObject(obj: any, prefix: string, result: Record<string, any>): void {
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const newKey = prefix ? `${prefix}.${key}` : key;
        const value = obj[key];

        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          this.flattenObject(value, newKey, result);
        } else {
          result[newKey] = value;
        }
      }
    }
  }

  /**
   * Get translation value by key
   * @param key The translation key (may or may not include namespace)
   * @param locale The locale to look up
   * @param maxLength Optional max length for truncation
   * @param explicitNamespace Optional explicit namespace from code (takes precedence over file-based namespace)
   */
  getValue(key: string, locale: string, maxLength?: number, explicitNamespace?: string): string | undefined {
    logger.debug('Getting translation value', { key, locale, maxLength, explicitNamespace, useFileNameAsNamespace: this.useFileNameAsNamespace });
    
    const localeData = this.translations[locale];
    if (!localeData) {
      logger.debug('Locale data not found', { locale, availableLocales: Object.keys(this.translations) });
      return undefined;
    }

    let value: string | undefined;

    if (explicitNamespace) {
      // Explicit namespace from code takes precedence
      const fullKey = `${explicitNamespace}.${key}`;
      value = this.lookupKey(localeData, fullKey, key);
      logger.debug('Lookup with explicit namespace', { key, explicitNamespace, fullKey, found: value !== undefined });
    } else if (this.useFileNameAsNamespace) {
      // Try key as-is first (in case it already includes namespace or file has no namespace)
      value = this.lookupKey(localeData, key, key);
      
      // If not found and useFileNameAsNamespace is enabled, try with file-based namespaces
      if (value === undefined) {
        const namespaces = this.getAvailableNamespaces(locale);
        logger.debug('Trying file-based namespaces', { key, namespaces });
        
        for (const ns of namespaces) {
          const fullKey = `${ns}.${key}`;
          value = this.lookupKey(localeData, fullKey, key);
          if (value !== undefined) {
            logger.debug('Found with file-based namespace', { key, namespace: ns, fullKey });
            break;
          }
        }
      }
      
      // If still not found, try default namespace
      if (value === undefined && this.defaultNamespace) {
        const fullKey = `${this.defaultNamespace}.${key}`;
        value = this.lookupKey(localeData, fullKey, key);
        if (value !== undefined) {
          logger.debug('Found with default namespace', { key, defaultNamespace: this.defaultNamespace, fullKey });
        }
      }
    } else {
      // useFileNameAsNamespace is disabled, try key as-is first
      value = this.lookupKey(localeData, key, key);
      
      // If not found, try default namespace
      if (value === undefined && this.defaultNamespace) {
        const fullKey = `${this.defaultNamespace}.${key}`;
        value = this.lookupKey(localeData, fullKey, key);
        if (value !== undefined) {
          logger.debug('Found with default namespace', { key, defaultNamespace: this.defaultNamespace, fullKey });
        }
      }
    }

    if (value === undefined) {
      logger.debug('No translation found for key', { key, locale, availableKeys: Object.keys(localeData).slice(0, 10) });
      return undefined;
    }

    if (maxLength && value.length > maxLength) {
      const truncated = value.substring(0, maxLength) + '...';
      logger.debug('Truncated translation value', { key, originalLength: value.length, maxLength });
      return truncated;
    }

    logger.debug('Returning translation value', { key, locale, valueLength: value.length });
    return value;
  }

  /**
   * Lookup a key in locale data, trying exact match and partial matches
   */
  private lookupKey(localeData: Record<string, any>, fullKey: string, originalKey: string): string | undefined {
    let value = localeData[fullKey];
    
    if (value === undefined) {
      // Try to find partial matches (for nested keys)
      const keys = Object.keys(localeData);
      const matchingKey = keys.find(k => k === fullKey || k.endsWith(`.${originalKey}`) || k.endsWith(`.${fullKey}`));
      if (matchingKey) {
        value = localeData[matchingKey];
      }
    }

    if (typeof value !== 'string') {
      return undefined;
    }

    return value;
  }

  /**
   * Get all available namespaces for a locale from loaded files
   */
  private getAvailableNamespaces(locale: string): string[] {
    const namespaces = new Set<string>();
    for (const info of this.fileNamespaces.values()) {
      if (info.locale === locale && info.namespace) {
        namespaces.add(info.namespace);
      }
    }
    return Array.from(namespaces);
  }

  /**
   * Get all available locales
   */
  getLocales(): string[] {
    return Array.from(this.localeFiles.keys());
  }

  /**
   * Reload translations
   */
  async reload(): Promise<void> {
    logger.info('Reloading translations...');
    await this.initialize();
    logger.info('Translations reloaded successfully');
  }
}
