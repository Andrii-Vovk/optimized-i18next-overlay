import type { TextDocument, TextLine, Uri } from 'vscode';
import { Position, Range } from 'vscode';

/**
 * Mock TextLine implementation for testing
 */
class MockTextLine implements TextLine {
  constructor(
    public readonly lineNumber: number,
    public readonly text: string,
    public readonly range: Range,
    public readonly rangeIncludingLineBreak: Range,
    public readonly firstNonWhitespaceCharacterIndex: number,
    public readonly isEmptyOrWhitespace: boolean
  ) {}
}

/**
 * Mock TextDocument implementation for testing
 */
export class MockTextDocument implements TextDocument {
  private _content: string;
  private _uri: Uri;
  private _languageId: string;
  private _version: number;
  private _isDirty: boolean;
  private _isUntitled: boolean;
  private _eol: number;
  private _lineCount: number;
  private _fileName: string;
  private _encoding: string;
  private _isClosed: boolean;

  constructor(content: string, fileName: string = 'test.ts', languageId: string = 'typescript') {
    this._content = content;
    this._fileName = fileName;
    this._languageId = languageId;
    this._version = 1;
    this._isDirty = false;
    this._isUntitled = false;
    this._eol = 1; // EOL.LF
    this._lineCount = content.split('\n').length;
    this._uri = { fsPath: fileName } as Uri;
    this._encoding = 'utf8';
    this._isClosed = false;
  }

  getText(): string {
    return this._content;
  }

  positionAt(offset: number): Position {
    let line = 0;
    let character = 0;
    for (let i = 0; i < offset && i < this._content.length; i++) {
      if (this._content[i] === '\n') {
        line++;
        character = 0;
      } else {
        character++;
      }
    }
    return new Position(line, character);
  }

  offsetAt(position: Position): number {
    const lines = this._content.split('\n');
    let offset = 0;
    for (let i = 0; i < position.line && i < lines.length; i++) {
      offset += lines[i].length + 1; // +1 for newline
    }
    offset += position.character;
    return Math.min(offset, this._content.length);
  }

  lineAt(lineOrPosition: number | Position): TextLine {
    const lineNumber = typeof lineOrPosition === 'number' ? lineOrPosition : lineOrPosition.line;
    const lines = this._content.split('\n');
    const line = lines[lineNumber] || '';
    const startPos = new Position(lineNumber, 0);
    const endPos = new Position(lineNumber, line.length);
    const range = new Range(startPos, endPos);
    const rangeIncludingLineBreak = new Range(startPos, new Position(lineNumber, line.length + 1));
    
    const firstNonWhitespace = line.match(/^\s*/)?.[0].length ?? line.length;
    const isEmptyOrWhitespace = line.trim().length === 0;

    return new MockTextLine(
      lineNumber,
      line,
      range,
      rangeIncludingLineBreak,
      firstNonWhitespace,
      isEmptyOrWhitespace
    );
  }

  getWordRangeAtPosition(position: Position, regex?: RegExp): Range | undefined {
    throw new Error('Not implemented');
  }

  validateRange(range: Range): Range {
    return range;
  }

  validatePosition(position: Position): Position {
    return position;
  }

  save(): Thenable<boolean> {
    throw new Error('Not implemented');
  }

  // Required properties
  get uri(): Uri {
    return this._uri;
  }

  get fileName(): string {
    return this._fileName;
  }

  get isUntitled(): boolean {
    return this._isUntitled;
  }

  get languageId(): string {
    return this._languageId;
  }

  get version(): number {
    return this._version;
  }

  get isDirty(): boolean {
    return this._isDirty;
  }

  get eol(): number {
    return this._eol;
  }

  get lineCount(): number {
    return this._lineCount;
  }

  get encoding(): string {
    return this._encoding;
  }

  get isClosed(): boolean {
    return this._isClosed;
  }
}
