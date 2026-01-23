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
   * Also handles multiline objects
   */
  private static readonly NAMESPACE_PATTERN = /\{\s*[^}]*\bns\s*[:=]\s*['"`]([^'"`]+)['"`][^}]*\}/s;
  
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
      
      // Extract the full accessor (handle bracket notation with nested brackets)
      let accessor: string;
      let arrowFunctionEndPos: number | undefined;
      if (accessorPrefix.startsWith('.')) {
        // Dot notation: extract until comma or closing paren
        const dotStart = accessorStart + 1;
        let dotEnd = dotStart;
        while (dotEnd < text.length && text[dotEnd] !== ',' && text[dotEnd] !== ')') {
          dotEnd++;
        }
        accessor = '.' + text.substring(dotStart, dotEnd);
        arrowFunctionEndPos = dotEnd; // End of the property access
      } else if (accessorPrefix === '[') {
        // Bracket notation: find matching closing bracket
        const bracketStart = accessorStart + 1;
        const bracketEnd = this.findMatchingBracket(text, bracketStart - 1);
        if (bracketEnd === -1) {
          logger.debug('Could not find matching closing bracket', { position: bracketStart });
          continue;
        }
        accessor = text.substring(accessorStart, bracketEnd + 1);
        arrowFunctionEndPos = bracketEnd + 1; // After the closing bracket
      } else {
        continue;
      }
      
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
      
      // Extract namespace from the full arguments text
      const namespaceMatch = argsText.match(this.NAMESPACE_PATTERN);
      const namespace = namespaceMatch ? namespaceMatch[1] : undefined;
      
      logger.debug('Found function call', { 
        start,
        end,
        openingParenPos,
        namespace,
        argsText: argsText.substring(0, 100)
      });
      
      // Extract key from accessor
      let key: string | null = null;
      
      if (accessor.startsWith('.')) {
        // Dot notation: $.path.to.key
        const propertyPath = accessor.substring(1); // Remove leading dot
        key = this.parsePropertyPath(propertyPath);
      } else if (accessor.startsWith('[') && accessor.endsWith(']')) {
        // Bracket notation: $[expression]
        const bracketContent = accessor.substring(1, accessor.length - 1); // Remove [ and ]
        
        // Check if it's a function call like pluralKey('key', ...)
        const funcMatch = bracketContent.match(this.FUNCTION_KEY_PATTERN);
        if (funcMatch) {
          // Extract key from function call argument
          key = funcMatch[2]; // The key string from the function call
          logger.debug('Extracted key from function call in bracket', { 
            bracketContent, 
            functionName: funcMatch[1], 
            key 
          });
        } else {
          // Try to parse as a string literal or property access
          // Handle cases like $['key'] or $["key"]
          const stringMatch = bracketContent.match(/^['"]([^'"]+)['"]$/);
          if (stringMatch) {
            key = stringMatch[1];
          } else {
            // Try parsing as property path (might be a variable or expression)
            key = this.parsePropertyPath(bracketContent);
          }
          logger.debug('Extracted key from bracket notation', { bracketContent, key });
        }
      }
      
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
        logger.warn('Failed to extract key from accessor', { accessor });
      }
    }

    logger.info(`Detected ${keys.length} translation key(s)`, { 
      fileName: document.fileName,
      keys: keys.map(k => ({ key: k.key, namespace: k.namespace })) 
    });

    return keys;
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
      } else if (char === '"' || char === "'") {
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
   * Get key at a specific position
   */
  static getKeyAtPosition(document: TextDocument, offset: number): DetectedKey | undefined {
    logger.debug('Getting key at position', { fileName: document.fileName, offset });
    const keys = this.getKeys(document);
    const key = keys.find(k => k.start <= offset && k.end >= offset);
    if (key) {
      logger.debug('Found key at position', { offset, key });
    } else {
      logger.debug('No key found at position', { offset });
    }
    return key;
  }
}
