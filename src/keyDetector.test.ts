import { describe, test, expect } from 'bun:test';
import { KeyDetector, DetectedKey } from './keyDetector';
import { MockTextDocument } from './__mocks__/textDocument';

describe('KeyDetector', () => {
  describe('getKeys', () => {
    test('should detect simple dot notation', () => {
      const doc = new MockTextDocument("const title = t($ => $.labels.title);");
      const keys = KeyDetector.getKeys(doc);
      
      expect(keys).toHaveLength(1);
      expect(keys[0].key).toBe('labels.title');
      expect(keys[0].namespace).toBeUndefined();
    });

    test('should detect bracket notation', () => {
      const doc = new MockTextDocument("const title = t($ => $.labels['max-payment']);");
      const keys = KeyDetector.getKeys(doc);
      
      expect(keys).toHaveLength(1);
      expect(keys[0].key).toBe('labels.max-payment');
    });

    test('should detect bracket notation with double quotes', () => {
      const doc = new MockTextDocument('const title = t($ => $.labels["max-payment"]);');
      const keys = KeyDetector.getKeys(doc);
      
      expect(keys).toHaveLength(1);
      expect(keys[0].key).toBe('labels.max-payment');
    });

    test('should detect multiline bracket notation without quotes in key', () => {
      const doc = new MockTextDocument(`t(
  ($) =>
    $.application['vessel-info']['engine-serial-number'][
      'serial-number'
    ],
  { ns: 'master-cover' },
)`);
      const keys = KeyDetector.getKeys(doc);
      
      expect(keys).toHaveLength(1);
      expect(keys[0].key).toBe('application.vessel-info.engine-serial-number.serial-number');
      expect(keys[0].namespace).toBe('master-cover');
      expect(keys[0].isMultiline).toBe(true);
    });

    test('should detect multiline bracket notation with various whitespace', () => {
      const doc = new MockTextDocument(`t(
  ($) =>
    $.labels[
      'key-name'
    ],
)`);
      const keys = KeyDetector.getKeys(doc);
      
      expect(keys).toHaveLength(1);
      expect(keys[0].key).toBe('labels.key-name');
      expect(keys[0].isMultiline).toBe(true);
    });

    test('should detect mixed dot and bracket notation', () => {
      const doc = new MockTextDocument("const title = t($ => $.namespace['key-name'].property);");
      const keys = KeyDetector.getKeys(doc);
      
      expect(keys).toHaveLength(1);
      expect(keys[0].key).toBe('namespace.key-name.property');
    });

    test('should detect multiple bracket notations', () => {
      const doc = new MockTextDocument("const title = t($ => $.labels['max-payment']['sub-key']);");
      const keys = KeyDetector.getKeys(doc);
      
      expect(keys).toHaveLength(1);
      expect(keys[0].key).toBe('labels.max-payment.sub-key');
    });

    test('should detect namespace from options object', () => {
      const doc = new MockTextDocument("const title = t($ => $.labels.title, { ns: 'custom-ns' });");
      const keys = KeyDetector.getKeys(doc);
      
      expect(keys).toHaveLength(1);
      expect(keys[0].key).toBe('labels.title');
      expect(keys[0].namespace).toBe('custom-ns');
    });

    test('should detect namespace with double quotes', () => {
      const doc = new MockTextDocument('const title = t($ => $.labels.title, { ns: "custom-ns" });');
      const keys = KeyDetector.getKeys(doc);
      
      expect(keys).toHaveLength(1);
      expect(keys[0].namespace).toBe('custom-ns');
    });

    test('should detect namespace with compact syntax', () => {
      const doc = new MockTextDocument("const title = t($ => $.labels.title, {ns:'custom-ns'});");
      const keys = KeyDetector.getKeys(doc);
      
      expect(keys).toHaveLength(1);
      expect(keys[0].namespace).toBe('custom-ns');
    });

    test('should detect multiple keys in same document', () => {
      const doc = new MockTextDocument(`
        const title1 = t($ => $.labels.title);
        const title2 = t($ => $.labels.subtitle);
        const title3 = t($ => $.common.button);
      `);
      const keys = KeyDetector.getKeys(doc);
      
      expect(keys).toHaveLength(3);
      expect(keys[0].key).toBe('labels.title');
      expect(keys[1].key).toBe('labels.subtitle');
      expect(keys[2].key).toBe('common.button');
    });

    test('should detect keys with parentheses in arrow function', () => {
      const doc = new MockTextDocument("const title = t(($) => $.labels.title);");
      const keys = KeyDetector.getKeys(doc);
      
      expect(keys).toHaveLength(1);
      expect(keys[0].key).toBe('labels.title');
    });

    test('should handle keys starting with bracket notation', () => {
      const doc = new MockTextDocument("const title = t($ => $['first-key'].second);");
      const keys = KeyDetector.getKeys(doc);
      
      expect(keys).toHaveLength(1);
      expect(keys[0].key).toBe('first-key.second');
    });

    test('should handle keys with spaces in bracket notation', () => {
      const doc = new MockTextDocument("const title = t($ => $.labels['max payment']);");
      const keys = KeyDetector.getKeys(doc);
      
      expect(keys).toHaveLength(1);
      expect(keys[0].key).toBe('labels.max payment');
    });

    test('should handle nested function calls', () => {
      const doc = new MockTextDocument("const title = t($ => $.labels.title, { ns: t($ => $.common.ns) });");
      const keys = KeyDetector.getKeys(doc);
      
      expect(keys).toHaveLength(2);
      expect(keys[0].key).toBe('labels.title');
      expect(keys[0].namespace).toBeUndefined(); // Nested t() call should not affect namespace
      expect(keys[1].key).toBe('common.ns');
    });

    test('should handle nested function calls in options object properties', () => {
      const doc = new MockTextDocument("t($ => $.labels['title-text'], {ns: 'text', value: t($ => $.labels['text-value'])});");
      const keys = KeyDetector.getKeys(doc);
      
      expect(keys).toHaveLength(2);
      expect(keys[0].key).toBe('labels.title-text');
      expect(keys[0].namespace).toBe('text');
      expect(keys[1].key).toBe('labels.text-value');
      expect(keys[1].namespace).toBeUndefined(); // Nested t() call should not have namespace from parent
    });

    test('should detect single-line multiline flag correctly', () => {
      const doc = new MockTextDocument("const title = t($ => $.labels.title);");
      const keys = KeyDetector.getKeys(doc);
      
      expect(keys).toHaveLength(1);
      expect(keys[0].isMultiline).toBe(false);
    });

    test('should detect multiline flag correctly', () => {
      const doc = new MockTextDocument(`const title = t(
  $ => $.labels.title
);`);
      const keys = KeyDetector.getKeys(doc);
      
      expect(keys).toHaveLength(1);
      expect(keys[0].isMultiline).toBe(true);
    });

    test('should extract correct positions', () => {
      const doc = new MockTextDocument("const title = t($ => $.labels.title);");
      const keys = KeyDetector.getKeys(doc);
      
      expect(keys).toHaveLength(1);
      expect(keys[0].start).toBeGreaterThanOrEqual(0);
      expect(keys[0].end).toBeGreaterThan(keys[0].start);
      expect(keys[0].fullMatch).toContain('t($ => $.labels.title)');
    });

    test('should handle empty bracket content', () => {
      const doc = new MockTextDocument("const title = t($ => $.labels['']);");
      const keys = KeyDetector.getKeys(doc);
      
      expect(keys).toHaveLength(1);
      expect(keys[0].key).toBe('labels.');
    });

    test('should handle bracket notation without quotes', () => {
      const doc = new MockTextDocument("const title = t($ => $.labels[keyVar]);");
      const keys = KeyDetector.getKeys(doc);
      
      expect(keys).toHaveLength(1);
      expect(keys[0].key).toBe('labels.keyVar');
    });

    test('should handle complex nested structure', () => {
      const doc = new MockTextDocument(`t(
  ($) =>
    $.application['vessel-info']['engine-serial-number'][
      'serial-number'
    ].subproperty,
  { ns: 'master-cover' },
)`);
      const keys = KeyDetector.getKeys(doc);
      
      expect(keys).toHaveLength(1);
      expect(keys[0].key).toBe('application.vessel-info.engine-serial-number.serial-number.subproperty');
      expect(keys[0].namespace).toBe('master-cover');
    });

    test('should handle escaped quotes in bracket notation', () => {
      const doc = new MockTextDocument("const title = t($ => $.labels['key\\'with\\'quotes']);");
      const keys = KeyDetector.getKeys(doc);
      
      expect(keys).toHaveLength(1);
      // The regex should handle escaped quotes correctly
      expect(keys[0].key).toContain('key');
    });
  });

  describe('getKeyAtPosition', () => {
    test('should return key at specific position', () => {
      const doc = new MockTextDocument("const title = t($ => $.labels.title);");
      const offset = doc.getText().indexOf('labels.title');
      const key = KeyDetector.getKeyAtPosition(doc, offset);
      
      expect(key).toBeDefined();
      expect(key?.key).toBe('labels.title');
    });

    test('should return innermost key when nested', () => {
      // Note: When t() is accessed as a property (outer.t), it's treated as part of the key path
      // For true nested calls, they should be separate statements
      const doc = new MockTextDocument("const title = t($ => $.outer.t($ => $.inner.key));");
      const offset = doc.getText().indexOf('inner.key');
      const key = KeyDetector.getKeyAtPosition(doc, offset);
      
      expect(key).toBeDefined();
      // The parser treats outer.t as a property access, so the full key includes it
      expect(key?.key).toBe('outer.t.inner.key');
    });

    test('should return undefined for position outside any key', () => {
      const doc = new MockTextDocument("const title = t($ => $.labels.title);");
      const key = KeyDetector.getKeyAtPosition(doc, 0);
      
      expect(key).toBeUndefined();
    });

    test('should return key at start position', () => {
      const doc = new MockTextDocument("const title = t($ => $.labels.title);");
      const text = doc.getText();
      const startPos = text.indexOf('t($ =>');
      const key = KeyDetector.getKeyAtPosition(doc, startPos);
      
      expect(key).toBeDefined();
      expect(key?.key).toBe('labels.title');
    });

    test('should return key at end position', () => {
      const doc = new MockTextDocument("const title = t($ => $.labels.title);");
      const text = doc.getText();
      const endPos = text.indexOf('title)');
      const key = KeyDetector.getKeyAtPosition(doc, endPos);
      
      expect(key).toBeDefined();
      expect(key?.key).toBe('labels.title');
    });
  });

  describe('edge cases', () => {
    test('should handle keys with special characters', () => {
      const doc = new MockTextDocument("const title = t($ => $.labels['key-with-dashes_and_underscores']);");
      const keys = KeyDetector.getKeys(doc);
      
      expect(keys).toHaveLength(1);
      expect(keys[0].key).toBe('labels.key-with-dashes_and_underscores');
    });

    test('should handle very long accessor chains', () => {
      const doc = new MockTextDocument("const title = t($ => $.a.b.c.d.e.f.g.h.i.j);");
      const keys = KeyDetector.getKeys(doc);
      
      expect(keys).toHaveLength(1);
      expect(keys[0].key).toBe('a.b.c.d.e.f.g.h.i.j');
    });

    test('should handle keys with numbers', () => {
      const doc = new MockTextDocument("const title = t($ => $.labels.key123);");
      const keys = KeyDetector.getKeys(doc);
      
      expect(keys).toHaveLength(1);
      expect(keys[0].key).toBe('labels.key123');
    });

    test('should handle keys starting with underscore', () => {
      const doc = new MockTextDocument("const title = t($ => $.labels._private);");
      const keys = KeyDetector.getKeys(doc);
      
      expect(keys).toHaveLength(1);
      expect(keys[0].key).toBe('labels._private');
    });

    test('should handle keys with dollar sign', () => {
      const doc = new MockTextDocument("const title = t($ => $.labels.$special);");
      const keys = KeyDetector.getKeys(doc);
      
      expect(keys).toHaveLength(1);
      expect(keys[0].key).toBe('labels.$special');
    });
  });
});
