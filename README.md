# i18n Overlay Extension

A VSCode extension that overlays translations over type-safe i18n keys in the format `t($ => $.labels.['max-payment'].title)`.

## Features

- **Translation Overlay**: Automatically displays translations next to i18n keys in your code
- **Type-Safe Format Support**: Detects keys in the format `t($ => $.path.to.key)`
- **Real-time Updates**: Updates overlays as you type or switch files
- **Missing Translation Indicators**: Shows `[missing]` for keys without translations

## Usage

### Supported Format

The extension detects translation keys in this format:

```typescript
// Simple property access
t($ => $.labels.title)

// With bracket notation
t($ => $.labels.['max-payment'].title)

// Nested properties
t($ => $.common.labels.maxPayment.title)
```

### Configuration

Configure the extension in your VSCode settings:

```json
{
  "i18nOverlay.enabled": true,
  "i18nOverlay.localeFiles": ["**/locales/**/*.json"],
  "i18nOverlay.defaultLocale": "en",
  "i18nOverlay.annotationDelimiter": " → "
}
```

### Translation Files

Place your translation files in JSON format. The extension will automatically detect locales from filenames or directory names:

```
locales/
  en.json
  es.json
  fr.json
```

Or:

```
locales/
  en/
    common.json
  es/
    common.json
```

### Commands

- `i18nOverlay.reload`: Reload translation files manually
- `i18nOverlay.showLogs`: Show debug logs in output channel

### Debug Logging

The extension includes comprehensive debug logging. To view logs:

1. Open the Command Palette (Ctrl+Shift+P / Cmd+Shift+P)
2. Run `i18nOverlay.showLogs` to open the output channel
3. Or manually open the "i18n Overlay" output channel from the Output panel

Logs include:
- Key detection details
- Translation file loading
- Translation lookups
- Decoration updates
- Configuration changes
- Error messages

## Development

1. Install dependencies:
   ```bash
   bun install
   ```

2. Compile TypeScript:
   ```bash
   bun run compile
   ```

3. Press F5 in VSCode to launch the extension in a new window

4. Make changes and press Ctrl+R (Cmd+R on Mac) in the extension window to reload

## How It Works

1. **Key Detection**: Uses regex to find `t($ => $.path.to.key)` patterns in your code
2. **Translation Loading**: Scans workspace for JSON translation files and loads them
3. **Overlay Rendering**: Uses VSCode's Text Editor Decoration API to overlay translations after detected keys
4. **Real-time Updates**: Listens to document changes and updates overlays accordingly

## Example

Given this code:
```typescript
const title = t($ => $.labels.['max-payment'].title);
```

And a translation file `locales/en.json`:
```json
{
  "labels": {
    "max-payment": {
      "title": "Maximum Payment"
    }
  }
}
```

The extension will display:
```
t($ => $.labels.['max-payment'].title) → Maximum Payment
```
