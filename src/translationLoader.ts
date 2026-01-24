import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { workspace, Uri } from "vscode";
import { logger } from "./logger";

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
  private defaultNamespace: string = "common";

  /**
   * Initialize and load translation files
   */
  async initialize(): Promise<void> {
    logger.info("Initializing translation loader...");
    const config = workspace.getConfiguration("i18nOverlay");
    const patterns = config.get<string[]>("localeFiles", ["**/locales/**/*.json"]);
    this.useFileNameAsNamespace = config.get<boolean>("useFileNameAsNamespace", true);
    this.defaultNamespace = config.get<string>("defaultNamespace", "common");
    logger.debug("Translation file patterns", {
      patterns,
      useFileNameAsNamespace: this.useFileNameAsNamespace,
      defaultNamespace: this.defaultNamespace,
    });

    await this.loadTranslations(patterns);
    const locales = this.getLocales();
    logger.info(`Translation loader initialized with ${locales.length} locale(s)`, { locales });
  }

  /**
   * Load translations from files matching glob patterns
   */
  private async loadTranslations(patterns: string[]): Promise<void> {
    logger.debug("Loading translations from patterns", { patterns });
    this.translations = {};
    this.localeFiles.clear();
    this.fileNamespaces.clear();

    const workspaceFolders = workspace.workspaceFolders;
    if (!workspaceFolders) {
      logger.warn("No workspace folders found");
      return;
    }

    logger.debug("Searching in workspace folders", {
      count: workspaceFolders.length,
      folders: workspaceFolders.map((f) => f.name),
    });

    let totalFiles = 0;
    for (const folder of workspaceFolders) {
      for (const pattern of patterns) {
        logger.debug("Searching for files", { folder: folder.name, pattern });
        const files = await workspace.findFiles(new vscode.RelativePattern(folder, pattern), null, 100);

        logger.debug(`Found ${files.length} file(s) matching pattern`, {
          pattern,
          count: files.length,
          files: files.map((f) => f.fsPath),
        });
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
    logger.debug("Loading translation file", { filePath });
    try {
      // Extract locale from filename (e.g., en.json, en-US.json, locales/en.json)
      const locale = this.extractLocaleFromPath(filePath);
      if (!locale) {
        logger.debug("Could not extract locale from path, skipping", { filePath });
        return;
      }

      // Extract namespace from file path if enabled
      const namespace = this.useFileNameAsNamespace ? this.extractNamespaceFromPath(filePath, locale) : undefined;

      logger.debug("Extracted locale and namespace from file path", { filePath, locale, namespace });
      const content = fs.readFileSync(filePath, "utf-8");
      const data = JSON.parse(content);

      if (!this.translations[locale]) {
        this.translations[locale] = {};
      }

      const keyCountBefore = Object.keys(this.translations[locale]).length;
      // Flatten nested objects, prefixing with namespace if enabled
      const prefix = namespace ? `${namespace}.` : "";
      this.flattenObject(data, prefix, this.translations[locale]);
      const keyCountAfter = Object.keys(this.translations[locale]).length;

      this.localeFiles.set(locale, filePath);

      // Store namespace info for this file
      this.fileNamespaces.set(filePath, {
        filePath,
        namespace,
        locale,
      });

      logger.info(`Loaded translation file`, {
        filePath,
        locale,
        namespace,
        keysAdded: keyCountAfter - keyCountBefore,
        totalKeys: keyCountAfter,
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
    logger.debug("Extracting locale from path", { filePath, basename });

    // Check if basename looks like a locale (en, en-US, etc.)
    if (/^[a-z]{2}(-[A-Z]{2})?$/i.test(basename)) {
      const locale = basename.toLowerCase();
      logger.debug("Found locale in basename", { filePath, locale });
      return locale;
    }

    // Check parent directory
    const dirname = path.basename(path.dirname(filePath));
    if (/^[a-z]{2}(-[A-Z]{2})?$/i.test(dirname)) {
      const locale = dirname.toLowerCase();
      logger.debug("Found locale in parent directory", { filePath, locale, dirname });
      return locale;
    }

    logger.debug("Could not extract locale from path", { filePath, basename, dirname });
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

    logger.debug("Extracting namespace from path", { filePath, basename, dirname, locale });

    // If basename is the locale, namespace is in parent directory
    if (basename.toLowerCase() === locale.toLowerCase()) {
      // Check if parent directory is not a locale (i.e., it's a namespace)
      if (!/^[a-z]{2}(-[A-Z]{2})?$/i.test(dirname)) {
        const namespace = dirname;
        logger.debug("Found namespace in parent directory", { filePath, namespace, dirname });
        return namespace;
      }
    } else {
      // Basename is not a locale, so it might be a namespace
      // But only if it's not a locale code
      if (!/^[a-z]{2}(-[A-Z]{2})?$/i.test(basename)) {
        const namespace = basename;
        logger.debug("Found namespace in basename", { filePath, namespace, basename });
        return namespace;
      }
    }

    logger.debug("No namespace found in path", { filePath, basename, dirname });
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

        if (typeof value === "object" && value !== null && !Array.isArray(value)) {
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
    logger.debug("Getting translation value", {
      key,
      locale,
      maxLength,
      explicitNamespace,
      useFileNameAsNamespace: this.useFileNameAsNamespace,
    });

    const localeData = this.translations[locale];
    if (!localeData) {
      logger.debug("Locale data not found", { locale, availableLocales: Object.keys(this.translations) });
      return undefined;
    }

    let value: string | undefined;

    if (explicitNamespace) {
      // Explicit namespace from code takes precedence
      const fullKey = `${explicitNamespace}.${key}`;
      value = this.lookupKey(localeData, fullKey, key);
      logger.debug("Lookup with explicit namespace", { key, explicitNamespace, fullKey, found: value !== undefined });
    } else if (this.useFileNameAsNamespace) {
      // Try key as-is first (in case it already includes namespace or file has no namespace)
      value = this.lookupKey(localeData, key, key);

      // If not found and useFileNameAsNamespace is enabled, try with file-based namespaces
      if (value === undefined) {
        const namespaces = this.getAvailableNamespaces(locale);
        logger.debug("Trying file-based namespaces", { key, namespaces });

        for (const ns of namespaces) {
          const fullKey = `${ns}.${key}`;
          value = this.lookupKey(localeData, fullKey, key);
          if (value !== undefined) {
            logger.debug("Found with file-based namespace", { key, namespace: ns, fullKey });
            break;
          }
        }
      }

      // If still not found, try default namespace
      if (value === undefined && this.defaultNamespace) {
        const fullKey = `${this.defaultNamespace}.${key}`;
        value = this.lookupKey(localeData, fullKey, key);
        if (value !== undefined) {
          logger.debug("Found with default namespace", { key, defaultNamespace: this.defaultNamespace, fullKey });
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
          logger.debug("Found with default namespace", { key, defaultNamespace: this.defaultNamespace, fullKey });
        }
      }
    }

    if (value === undefined) {
      logger.debug("No translation found for key", {
        key,
        locale,
        availableKeys: Object.keys(localeData).slice(0, 10),
      });
      return undefined;
    }

    if (maxLength && value.length > maxLength) {
      const truncated = value.substring(0, maxLength) + "...";
      logger.debug("Truncated translation value", { key, originalLength: value.length, maxLength });
      return truncated;
    }

    logger.debug("Returning translation value", { key, locale, valueLength: value.length });
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
      const matchingKey = keys.find((k) => k === fullKey || k.endsWith(`.${originalKey}`) || k.endsWith(`.${fullKey}`));
      if (matchingKey) {
        value = localeData[matchingKey];
      }
    }

    if (typeof value !== "string") {
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
    // Get all unique locales from both localeFiles and fileNamespaces
    const locales = new Set<string>();

    // Add locales from localeFiles map
    for (const locale of this.localeFiles.keys()) {
      locales.add(locale);
    }

    // Also check fileNamespaces to ensure we don't miss any locales
    for (const info of this.fileNamespaces.values()) {
      if (info.locale) {
        locales.add(info.locale);
      }
    }

    // Also check translations object keys as a fallback
    for (const locale of Object.keys(this.translations)) {
      locales.add(locale);
    }

    return Array.from(locales).sort();
  }

  /**
   * Reload translations
   */
  async reload(): Promise<void> {
    logger.info("Reloading translations...");
    await this.initialize();
    logger.info("Translations reloaded successfully");
  }

  /**
   * Get all translation keys for a locale
   */
  getAllKeys(locale: string): string[] {
    const localeData = this.translations[locale];
    if (!localeData) {
      return [];
    }
    return Object.keys(localeData);
  }

  /**
   * Get namespace for a translation key
   * Returns the namespace if it's different from the default namespace, otherwise undefined
   * Keys are stored with namespace prefix when useFileNameAsNamespace is enabled
   */
  getNamespaceForKey(key: string, locale: string): string | undefined {
    const localeData = this.translations[locale];
    if (!localeData) {
      return undefined;
    }

    // Check if key exists as-is (might already include namespace)
    if (localeData[key] !== undefined) {
      // Key exists, check if it starts with a namespace prefix
      const parts = key.split(".");
      if (parts.length > 1) {
        const possibleNamespace = parts[0];
        const namespaces = this.getAvailableNamespaces(locale);

        // Check if first part is a known namespace (not the default)
        if (namespaces.includes(possibleNamespace) && possibleNamespace !== this.defaultNamespace) {
          return possibleNamespace;
        }
      }
      // Key exists but doesn't have a non-default namespace prefix
      return undefined;
    }

    // Key doesn't exist, might need to check with namespaces
    const namespaces = this.getAvailableNamespaces(locale);
    for (const ns of namespaces) {
      if (ns !== this.defaultNamespace) {
        // Check if key exists with this namespace prefix
        if (localeData[`${ns}.${key}`] !== undefined) {
          return ns;
        }
      }
    }

    return undefined;
  }

  /**
   * Extract key without namespace prefix
   * If key is "namespace.labels.title" and namespace is "namespace", returns "labels.title"
   */
  getKeyWithoutNamespace(key: string, namespace?: string): string {
    if (!namespace) {
      return key;
    }

    const prefix = `${namespace}.`;
    if (key.startsWith(prefix)) {
      return key.substring(prefix.length);
    }

    return key;
  }

  /**
   * Extract interpolated variables from a translation value
   * Detects patterns like {{variable}} or {variable}
   */
  extractInterpolations(value: string): string[] {
    if (typeof value !== "string") {
      return [];
    }

    // Match {{variable}} or {variable} patterns
    const interpolationPattern = /\{\{?(\w+)\}?\}/g;
    const variables = new Set<string>();
    let match;

    while ((match = interpolationPattern.exec(value)) !== null) {
      variables.add(match[1]);
    }

    return Array.from(variables);
  }

  /**
   * Get translation info including namespace and interpolations
   */
  getTranslationInfo(
    key: string,
    locale: string
  ): {
    value: string | undefined;
    namespace: string | undefined;
    interpolations: string[];
    keyWithoutNamespace: string;
  } {
    const localeData = this.translations[locale];
    if (!localeData) {
      return {
        value: undefined,
        namespace: undefined,
        interpolations: [],
        keyWithoutNamespace: key,
      };
    }

    // First, check if key exists as-is (might include namespace)
    let value = localeData[key];
    let namespace: string | undefined;
    let keyWithoutNamespace = key;

    if (value !== undefined) {
      // Key exists, check if it has a namespace prefix
      const parts = key.split(".").filter((p) => p.length > 0); // Filter out empty parts
      if (parts.length > 1) {
        const possibleNamespace = parts[0];
        const namespaces = this.getAvailableNamespaces(locale);

        if (namespaces.includes(possibleNamespace) && possibleNamespace !== this.defaultNamespace) {
          namespace = possibleNamespace;
          const remainingParts = parts.slice(1);
          keyWithoutNamespace = remainingParts.length > 0 ? remainingParts.join(".") : key;
        }
      }
    } else {
      // Key doesn't exist, try to find it with namespaces
      const namespaces = this.getAvailableNamespaces(locale);
      for (const ns of namespaces) {
        if (ns !== this.defaultNamespace) {
          const fullKey = `${ns}.${key}`;
          if (localeData[fullKey] !== undefined) {
            value = localeData[fullKey];
            namespace = ns;
            keyWithoutNamespace = key;
            break;
          }
        }
      }

      // If still not found, try default namespace
      if (value === undefined && this.defaultNamespace) {
        const fullKey = `${this.defaultNamespace}.${key}`;
        if (localeData[fullKey] !== undefined) {
          value = localeData[fullKey];
          // Don't set namespace for default namespace
          keyWithoutNamespace = key;
        }
      }
    }

    const interpolations = typeof value === "string" ? this.extractInterpolations(value) : [];

    return {
      value: typeof value === "string" ? value : undefined,
      namespace,
      interpolations,
      keyWithoutNamespace,
    };
  }

  /**
   * Get all file paths for a locale
   */
  getLocaleFiles(locale: string): string[] {
    const files: string[] = [];
    for (const info of this.fileNamespaces.values()) {
      if (info.locale === locale) {
        files.push(info.filePath);
      }
    }
    return files;
  }

  /**
   * Get the default file path for a locale (prefer defaultNamespace file, or first file found, or create path)
   */
  getDefaultLocaleFile(locale: string): string | null {
    const files = this.getLocaleFiles(locale);
    if (files.length > 0) {
      // If useFileNameAsNamespace is enabled and defaultNamespace is set, prefer that file
      if (this.useFileNameAsNamespace && this.defaultNamespace) {
        const defaultNamespaceFile = files.find((f) => {
          const info = this.fileNamespaces.get(f);
          return info?.namespace === this.defaultNamespace;
        });
        if (defaultNamespaceFile) {
          return defaultNamespaceFile;
        }
      }
      // Otherwise, return first file found
      return files[0];
    }

    // Try to construct a default path
    const workspaceFolders = workspace.workspaceFolders;
    if (!workspaceFolders) {
      return null;
    }

    const config = workspace.getConfiguration("i18nOverlay");
    const patterns = config.get<string[]>("localeFiles", ["**/locales/**/*.json"]);

    // Use first pattern to guess directory structure
    const firstPattern = patterns[0];
    if (firstPattern.includes("locales")) {
      // If useFileNameAsNamespace is enabled and defaultNamespace is set, use that as filename
      if (this.useFileNameAsNamespace && this.defaultNamespace) {
        return path.join(workspaceFolders[0].uri.fsPath, "locales", `${this.defaultNamespace}.json`);
      }
      return path.join(workspaceFolders[0].uri.fsPath, "locales", `${locale}.json`);
    }

    return null;
  }

  /**
   * Convert a flat key (e.g., "labels.title") to nested object structure
   */
  private unflattenKey(key: string, value: string): any {
    const parts = key.split(".");
    let result: any = value;

    // Build nested structure from right to left
    for (let i = parts.length - 1; i >= 0; i--) {
      result = { [parts[i]]: result };
    }

    return result;
  }

  /**
   * Deep merge two objects
   */
  private deepMerge(target: any, source: any): any {
    const output = { ...target };

    if (this.isObject(target) && this.isObject(source)) {
      Object.keys(source).forEach((key) => {
        if (this.isObject(source[key])) {
          if (!(key in target)) {
            Object.assign(output, { [key]: source[key] });
          } else {
            output[key] = this.deepMerge(target[key], source[key]);
          }
        } else {
          Object.assign(output, { [key]: source[key] });
        }
      });
    }

    return output;
  }

  /**
   * Check if value is a plain object
   */
  private isObject(item: any): boolean {
    return item && typeof item === "object" && !Array.isArray(item);
  }

  /**
   * Add a translation key to a locale file
   * @param locale The locale to add the translation to
   * @param key The translation key (e.g., "labels.title")
   * @param value The translation value
   * @param namespace Optional namespace (if null, uses file's namespace or default)
   * @param targetFile Optional specific file path (if null, uses default file for locale)
   */
  async addTranslation(
    locale: string,
    key: string,
    value: string,
    namespace?: string | null,
    targetFile?: string
  ): Promise<void> {
    logger.info("Adding translation", { locale, key, value, namespace, targetFile });

    let filePath = targetFile;

    // If no target file specified, find or create one
    if (!filePath) {
      const files = this.getLocaleFiles(locale);

      // If namespace is specified and useFileNameAsNamespace is enabled, try to find matching file
      if (namespace && this.useFileNameAsNamespace) {
        const matchingFile = files.find((f) => {
          const info = this.fileNamespaces.get(f);
          return info?.namespace === namespace;
        });
        if (matchingFile) {
          filePath = matchingFile;
        }
      }

      // If no namespace specified and useFileNameAsNamespace is enabled, look for defaultNamespace file
      if (!filePath && !namespace && this.useFileNameAsNamespace && this.defaultNamespace) {
        const defaultNamespaceFile = files.find((f) => {
          const info = this.fileNamespaces.get(f);
          return info?.namespace === this.defaultNamespace;
        });
        if (defaultNamespaceFile) {
          filePath = defaultNamespaceFile;
        } else {
          // Default namespace file doesn't exist, create it
          // Try to determine the file structure from existing files
          const workspaceFolders = workspace.workspaceFolders;
          if (workspaceFolders && files.length > 0) {
            // Use the structure of the first existing file as a template
            const firstFile = files[0];
            const firstFileDir = path.dirname(firstFile);
            const firstFileBasename = path.basename(firstFile, path.extname(firstFile));
            const firstFileInfo = this.fileNamespaces.get(firstFile);

            // Determine the structure: namespace in directory or filename?
            if (firstFileInfo?.namespace) {
              if (firstFileBasename === locale) {
                // Structure: locales/namespace/locale.json -> use locales/defaultNamespace/locale.json
                const parentDir = path.dirname(firstFileDir);
                filePath = path.join(parentDir, this.defaultNamespace, `${locale}.json`);
              } else if (firstFileBasename === firstFileInfo.namespace) {
                // Structure: locales/locale/namespace.json -> use locales/locale/defaultNamespace.json
                filePath = path.join(firstFileDir, `${this.defaultNamespace}.json`);
              } else {
                // Unknown structure, try same directory with defaultNamespace as filename
                filePath = path.join(firstFileDir, `${this.defaultNamespace}.json`);
              }
            } else {
              // No namespace in first file, try to create in same directory
              filePath = path.join(firstFileDir, `${this.defaultNamespace}.json`);
            }
          } else {
            // No existing files, use default path construction
            filePath = this.getDefaultLocaleFile(locale) || undefined;
          }
        }
      }

      // If still no file, use default (first file found, or create new)
      if (!filePath) {
        filePath = this.getDefaultLocaleFile(locale) || undefined;
        if (!filePath) {
          throw new Error(`Could not determine file path for locale: ${locale}`);
        }
      }
    }

    // Read existing file or create new structure
    let data: any = {};
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        data = JSON.parse(content);
      } catch (error) {
        logger.warn("Failed to parse existing file, starting fresh", { filePath, error });
        data = {};
      }
    }

    // Determine the key to use in the file
    let fileKey = key;

    // If namespace is specified and matches file's namespace, remove it from key
    const fileInfo = this.fileNamespaces.get(filePath);
    if (namespace && fileInfo?.namespace === namespace) {
      // Key should not include namespace prefix
      fileKey = key;
    } else if (namespace && this.useFileNameAsNamespace) {
      // Namespace doesn't match file, we might need to add it
      // But if file has no namespace, we might add it to the structure
      if (!fileInfo?.namespace) {
        // File has no namespace, add namespace to structure
        fileKey = `${namespace}.${key}`;
      } else {
        // File has different namespace, just use key as-is
        fileKey = key;
      }
    } else if (!namespace && this.defaultNamespace && !fileInfo?.namespace) {
      // No namespace specified, but default namespace exists and file has no namespace
      // Add to default namespace structure
      fileKey = `${this.defaultNamespace}.${key}`;
    }

    // Convert flat key to nested structure and merge
    const nested = this.unflattenKey(fileKey, value);
    data = this.deepMerge(data, nested);

    // Write file back
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Format JSON with 2-space indentation
    const jsonContent = JSON.stringify(data, null, 2) + "\n";
    fs.writeFileSync(filePath, jsonContent, "utf-8");

    logger.info("Translation added successfully", { locale, key, value, filePath });

    // Reload translations to reflect changes
    await this.reload();
  }
}
