/**
 * Utility functions for formatting and key conversion
 */

/**
 * Convert a translation key to property access format
 * e.g., "labels.tooltip-label" -> "$.labels['tooltip-label']"
 */
export function keyToPropertyAccess(key: string): string {
  // Filter out empty parts (handles keys with leading/trailing dots or double dots)
  const parts = key.split('.').filter(part => part.length > 0);
  
  if (parts.length === 0) {
    // Fallback for empty key
    return '$';
  }
  
  const accessParts: string[] = [];
  
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const isFirst = i === 0;
    const isValidIdentifier = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(part);
    
    if (isValidIdentifier) {
      // Valid identifier, use dot notation
      accessParts.push(isFirst ? `$.${part}` : `.${part}`);
    } else {
      // Needs bracket notation - no dot before bracket
      accessParts.push(isFirst ? `$['${part}']` : `['${part}']`);
    }
  }
  
  return accessParts.join('');
}

/**
 * Format t function call with options
 */
export function formatTFunction(key: string, namespace?: string, interpolations: string[] = []): string {
  // Ensure key is not empty and trim it
  const trimmedKey = key.trim();
  if (!trimmedKey) {
    throw new Error('Translation key cannot be empty');
  }
  
  const propertyAccess = keyToPropertyAccess(trimmedKey);
  const options: string[] = [];
  
  if (namespace && namespace !== 'common') {
    options.push(`ns: '${namespace}'`);
  }
  
  // Add interpolations with empty string defaults
  for (const interp of interpolations) {
    options.push(`${interp}: ''`);
  }
  
  if (options.length > 0) {
    return `t($ => ${propertyAccess}, {${options.join(', ')}})`;
  } else {
    return `t($ => ${propertyAccess})`;
  }
}
