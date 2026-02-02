import { TextDocument } from 'vscode';
import { logger } from './logger';

export interface DetectedKey {
  key: string;
  namespace?: string;
  start: number;
  end: number;
  fullMatch: string;
  openingParenPos?: number; // Position of the opening parenthesis after function name (e.g., t(...))
  arrowFunctionEndPos?: number; // Position where the arrow function ends (before comma or closing paren)
  arrowPos?: number; // Position of the => arrow
  isMultiline?: boolean; // Whether the lambda spans multiple lines
}

/**
 * Detects translation keys in various formats:
 * - t($ => $.labels.title)
 * - t(($) => $.labels.title)
 * - t(($) => $.key, { ns: 'namespace' })
 * - pluralizeKey(($) => $.key, count: 3)
 * - pluralizeKey(($) => $.key, count: 3, { ns: 'namespace' })
 */
export class KeyDetector {
  /**
   * Regex to find arrow functions: ($) => $.path or $ => $.path or $ => $[...]
   * This is the anchor point - we'll work backwards/forwards from here
   * Matches both dot notation and bracket notation
   * For bracket notation, we'll extract the content separately to handle nested brackets
   */
  private static readonly ARROW_FUNCTION_PATTERN = /\(?\$\s*\)?\s*=>\s*\$(\.[^,)]+|\[)/g;
  
  /**
   * Regex to extract namespace from options object: { ns: 'namespace' } or {ns:'namespace'}
   * Used on the options object string only (not full args), so nested objects are not an issue.
   */
  private static readonly NAMESPACE_PATTERN = /\bns\s*[:=]\s*['"`]([^'"`]+)['"`]/;
  
  /**
   * Regex to extract key from function calls in bracket notation
   * Matches: pluralKey('key', ...), pluralKey("key", ...), etc.
   */
  private static readonly FUNCTION_KEY_PATTERN = /(\w+)\s*\(\s*['"]([^'"]+)['"]/;

  /**
   * Extract keys from a document
   */
  static getKeys(document: TextDocument): DetectedKey[] {
    logger.debug('Detecting keys in document', { 
      fileName: document.fileName,
      languageId: document.languageId,
      lineCount: document.lineCount 
    });

    const text = document.getText();
    const keys: DetectedKey[] = [];
    let match: RegExpExecArray | null;

    // Reset regex lastIndex
    this.ARROW_FUNCTION_PATTERN.lastIndex = 0;

    // Find all arrow functions first
    while ((match = this.ARROW_FUNCTION_PATTERN.exec(text)) !== null) {
      const arrowStart = match.index;
      const accessorStart = match.index + match[0].length - match[1].length;
      const accessorPrefix = match[1]; // Could be .path or [
      
      logger.debug('Found arrow function', { 
        accessorPrefix,
        position: arrowStart,
        match: match[0]
      });
      
      // Extract the full accessor chain: $['a'].b, $['a']['b'], $.a['b'], etc.
      // accessorStart is the position of the first char of the accessor ('.' or '[')
      if (accessorStart >= text.length) continue;

      const parsed = this.parseAccessorChain(text, accessorStart);
      if (!parsed) {
        logger.debug('Could not parse accessor chain', { position: accessorStart });
        continue;
      }
      const { key: accessorKey, endPos: arrowFunctionEndPos } = parsed;
      
      // Find the function call start (work backwards to find opening paren)
      const callInfo = this.findFunctionCallBounds(text, arrowStart);
      if (!callInfo) {
        logger.debug('Could not find function call bounds', { position: arrowStart });
        continue;
      }
      
      const { start, end, argsText, openingParenPos } = callInfo;
      
      // Find the position of => in the arrow function
      // Look for => after the opening paren
      const arrowMatch = argsText.match(/=>/);
      const arrowPos = arrowMatch 
        ? openingParenPos + 1 + argsText.indexOf('=>') + 2 // +2 to get position after '=>'
        : undefined;
      
      // Check if lambda (arrow function) spans multiple lines
      // Lambda starts at arrowStart and ends at arrowFunctionEndPos
      const lambdaStartLine = document.positionAt(arrowStart).line;
      const lambdaEndLine = arrowFunctionEndPos !== undefined
        ? document.positionAt(arrowFunctionEndPos).line
        : document.positionAt(arrowStart).line;
      const isMultiline = lambdaStartLine !== lambdaEndLine;
      
      // Extract namespace from the options object (first top-level object after the arrow function)
      const optionsStr = this.getOptionsObjectFromArgs(argsText);
      const namespace = optionsStr ? (optionsStr.match(this.NAMESPACE_PATTERN)?.[1]) : undefined;
      
      logger.debug('Found function call', { 
        start,
        end,
        openingParenPos,
        namespace,
        argsText: argsText.substring(0, 100)
      });
      
      // accessorKey is the full key path from parseAccessorChain (e.g. minimum-image-requirements.title)
      const key = accessorKey;
      
      if (key) {
        const fullMatch = text.substring(start, end + 1);
        const detectedKey: DetectedKey = {
          key,
          namespace,
          start,
          end: end + 1,
          fullMatch,
          openingParenPos,
          arrowFunctionEndPos,
          arrowPos,
          isMultiline,
        };
        keys.push(detectedKey);
        logger.debug('Detected key', detectedKey);
      } else {
        logger.warn('Failed to extract key from accessor', { position: accessorStart });
      }
    }

    logger.info(`Detected ${keys.length} translation key(s)`, { 
      fileName: document.fileName,
      keys: keys.map(k => ({ key: k.key, namespace: k.namespace })) 
    });

    return keys;
  }

  /**
   * Get the options object string from t(arrowFn, { ns: '...', ... }) args.
   * Returns the first top-level object after the comma so nested t() options are not mixed in.
   */
  private static getOptionsObjectFromArgs(argsText: string): string | undefined {
    let depth = 0;
    let commaAt = -1;
    for (let i = 0; i < argsText.length; i++) {
      const c = argsText[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      else if (depth === 0 && c === ',') {
        commaAt = i;
        break;
      }
    }
    if (commaAt === -1) return undefined;
    const afterComma = argsText.slice(commaAt + 1).trim();
    if (afterComma[0] !== '{') return undefined;
    let braceDepth = 0;
    let end = -1;
    for (let i = 0; i < afterComma.length; i++) {
      const c = afterComma[i];
      if (c === '{') {
        braceDepth++;
      } else if (c === '}') {
        braceDepth--;
        if (braceDepth === 0) {
          end = i + 1;
          break;
        }
      } else if ((c === '"' || c === "'" || c === '`') && braceDepth > 0) {
        const q = c;
        i++;
        while (i < afterComma.length && afterComma[i] !== q) {
          if (afterComma[i] === '\\') i++;
          i++;
        }
      }
    }
    if (end === -1) return undefined;
    return afterComma.slice(0, end);
  }

  /**
   * Find the function call boundaries starting from an arrow function position
   * Returns the start and end positions of the function call, plus the arguments text and opening paren position
   */
  private static findFunctionCallBounds(text: string, arrowPos: number): { start: number; end: number; argsText: string; openingParenPos: number } | null {
    // Work backwards to find the opening parenthesis
    let pos = arrowPos - 1;
    let parenDepth = 0;
    let callStart = -1;
    
    // Skip whitespace and arrow function parts
    while (pos >= 0) {
      const char = text[pos];
      
      if (char === ')') {
        parenDepth++;
      } else if (char === '(') {
        if (parenDepth === 0) {
          callStart = pos;
          break;
        }
        parenDepth--;
      } else if (char === '"' || char === "'" || char === '`') {
        // Skip string literals
        const quote = char;
        pos--;
        while (pos >= 0 && text[pos] !== quote) {
          if (text[pos] === '\\') {
            pos--; // Skip escaped character
          }
          pos--;
        }
      }
      
      pos--;
    }
    
    if (callStart === -1) {
      return null;
    }
    
    // Work backwards from opening paren to find function name start
    let funcStart = callStart - 1;
    while (funcStart >= 0 && /[\w$]/.test(text[funcStart])) {
      funcStart--;
    }
    funcStart++; // Adjust to actual start
    
    // Now find the matching closing parenthesis starting from callStart
    const callEnd = this.findMatchingClosingParen(text, callStart);
    if (callEnd === -1) {
      return null;
    }
    
    // Extract arguments text (between the parentheses)
    const argsText = text.substring(callStart + 1, callEnd);
    
    return {
      start: funcStart,
      end: callEnd,
      argsText,
      openingParenPos: callStart
    };
  }

  /**
   * Parse the full accessor chain after $ (e.g. ['a'].b, ['a']['b'], .a['b'])
   * Returns the key path as dot-notation and the end position.
   */
  private static parseAccessorChain(
    text: string,
    startPos: number
  ): { key: string; endPos: number } | null {
    const parts: string[] = [];
    let pos = startPos;

    while (pos < text.length) {
      const char = text[pos];
      if (char === ',' || char === ')') break;
      if (char === ' ' || char === '\n' || char === '\r' || char === '\t') {
        pos++;
        continue;
      }

      if (char === '.') {
        pos++;
        if (pos >= text.length) return null;
        const next = text[pos];
        if (next === '[') {
          const bracketEnd = this.findMatchingBracket(text, pos);
          if (bracketEnd === -1) return null;
          const inner = text.substring(pos + 1, bracketEnd);
          const strMatch = inner.match(/^['"]([^'"]*)['"]$/);
          if (strMatch) parts.push(strMatch[1]);
          else parts.push(inner.trim());
          pos = bracketEnd + 1;
        } else {
          let end = pos;
          while (end < text.length && /[\w$]/.test(text[end])) end++;
          const ident = text.substring(pos, end);
          if (ident) parts.push(ident);
          pos = end;
        }
        continue;
      }

      if (char === '[') {
        const bracketEnd = this.findMatchingBracket(text, pos);
        if (bracketEnd === -1) return null;
        const inner = text.substring(pos + 1, bracketEnd);
        const funcMatch = inner.match(this.FUNCTION_KEY_PATTERN);
        if (funcMatch) {
          parts.push(funcMatch[2]);
        } else {
          const strMatch = inner.match(/^['"]([^'"]*)['"]$/);
          if (strMatch) parts.push(strMatch[1]);
          else parts.push(inner.trim());
        }
        pos = bracketEnd + 1;
        continue;
      }

      pos++;
    }

    if (parts.length === 0) return null;
    return { key: parts.join('.'), endPos: pos };
  }

  /**
   * Find the matching closing bracket for bracket notation
   */
  private static findMatchingBracket(text: string, startPos: number): number {
    if (startPos >= text.length || text[startPos] !== '[') {
      return -1;
    }
    
    let depth = 1;
    let pos = startPos + 1;
    
    while (pos < text.length && depth > 0) {
      const char = text[pos];
      
      if (char === '[') {
        depth++;
      } else if (char === ']') {
        depth--;
        if (depth === 0) {
          return pos;
        }
      } else if (char === '"' || char === "'" || char === '`') {
        // Skip string literals
        const quote = char;
        pos++;
        while (pos < text.length && text[pos] !== quote) {
          if (text[pos] === '\\') {
            pos++; // Skip escaped character
          }
          pos++;
        }
      }
      
      pos++;
    }
    
    return -1;
  }

  /**
   * Find the matching closing parenthesis for a function call
   */
  private static findMatchingClosingParen(text: string, startPos: number): number {
    let depth = 0;
    let pos = startPos;
    
    // Skip to the opening paren
    while (pos < text.length && text[pos] !== '(') {
      pos++;
    }
    
    if (pos >= text.length || text[pos] !== '(') {
      return -1;
    }
    
    depth = 1;
    pos++;
    
    while (pos < text.length && depth > 0) {
      const char = text[pos];
      
      if (char === '(') {
        depth++;
      } else if (char === ')') {
        depth--;
        if (depth === 0) {
          return pos;
        }
      } else if (char === '"' || char === "'" || char === '`') {
        // Skip string and template literals so ) inside them don't break nesting
        const quote = char;
        pos++;
        while (pos < text.length && text[pos] !== quote) {
          if (text[pos] === '\\') {
            pos++; // Skip escaped character
          }
          pos++;
        }
      }
      
      pos++;
    }
    
    return -1;
  }

  /**
   * Parse property path like: labels.['max-payment'].title
   * Converts to: labels.max-payment.title
   */
  private static parsePropertyPath(path: string): string {
    logger.debug('Parsing property path', { path });
    
    // Split by dots, handling bracket notation
    const parts: string[] = [];
    let current = '';
    let inBrackets = false;
    let bracketContent = '';

    for (let i = 0; i < path.length; i++) {
      const char = path[i];
      
      if (char === '[') {
        if (current.trim()) {
          parts.push(current.trim());
          current = '';
        }
        inBrackets = true;
        bracketContent = '';
      } else if (char === ']') {
        inBrackets = false;
        // Extract content from ['key'] or ["key"] or [key]
        const content = bracketContent.trim();
        let extracted: string;
        if (content.startsWith("'") && content.endsWith("'")) {
          extracted = content.slice(1, -1);
        } else if (content.startsWith('"') && content.endsWith('"')) {
          extracted = content.slice(1, -1);
        } else {
          extracted = content;
        }
        parts.push(extracted);
        logger.debug('Extracted bracket content', { content, extracted });
        bracketContent = '';
      } else if (inBrackets) {
        bracketContent += char;
      } else if (char === '.') {
        if (current.trim()) {
          parts.push(current.trim());
          current = '';
        }
      } else {
        current += char;
      }
    }

    if (current.trim()) {
      parts.push(current.trim());
    }

    const result = parts.filter(p => p.length > 0).join('.');
    logger.debug('Parsed property path result', { path, result, parts });
    return result;
  }

  /**
   * Get key at a specific position.
   * When nested t() calls overlap, returns the innermost key (smallest range containing the offset).
   */
  static getKeyAtPosition(document: TextDocument, offset: number): DetectedKey | undefined {
    logger.debug('Getting key at position', { fileName: document.fileName, offset });
    const keys = this.getKeys(document);
    const containing = keys.filter(k => k.start <= offset && k.end >= offset);
    if (containing.length === 0) {
      logger.debug('No key found at position', { offset });
      return undefined;
    }
    // Prefer the innermost key (smallest range)
    const key = containing.reduce((best, k) => {
      const bestLen = best.end - best.start;
      const kLen = k.end - k.start;
      return kLen < bestLen ? k : best;
    });
    logger.debug('Found key at position', { offset, key });
    return key;
  }
}
