/**
 * Utility functions for formatting and key conversion
 */

/**
 * Convert a translation key to property access format
 * e.g., "labels.tooltip-label" -> "$.labels.['tooltip-label']"
 */
export function keyToPropertyAccess(key: string): string {
  const parts = key.split('.');
  const accessParts = parts.map((part, index) => {
    // Check if part needs bracket notation (contains special chars or starts with number)
    if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(part)) {
      // Valid identifier, use dot notation
      return index === 0 ? `$.${part}` : `.${part}`;
    } else {
      // Needs bracket notation - use dot before bracket to match example format
      return index === 0 ? `$.['${part}']` : `.['${part}']`;
    }
  });
  return accessParts.join('');
}

/**
 * Format t function call with options
 */
export function formatTFunction(key: string, namespace?: string, interpolations: string[] = []): string {
  const propertyAccess = keyToPropertyAccess(key);
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
