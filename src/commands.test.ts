import { describe, test, expect, beforeEach, jest, mock } from 'bun:test';
import {
  handleReload,
  handleShowLogs,
  handleEditTranslation,
  handleAddTranslationToLocale,
  handleTranslateAllLocales,
  initializeCommands,
} from './commands';
import { TranslationLoader } from './translationLoader';
import { DecorationManager } from './decoration';
import { mockVscode, resetVscodeMocks } from './__mocks__/vscode';

// Mock vscode module
mock.module('vscode', () => ({
  default: mockVscode,
  window: mockVscode.window,
  workspace: mockVscode.workspace,
  Position: mockVscode.Position,
  Range: mockVscode.Range,
  ViewColumn: mockVscode.ViewColumn,
  ProgressLocation: mockVscode.ProgressLocation,
  TextEditorRevealType: mockVscode.TextEditorRevealType,
}));

// Mock translateApi
const mockTranslateText = jest.fn();
const mockGetGoogleTranslateLangCode = jest.fn((locale: string) => locale.split('-')[0]);

mock.module('./translateApi', () => ({
  translateText: mockTranslateText,
  getGoogleTranslateLangCode: mockGetGoogleTranslateLangCode,
}));

// Mock logger
const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  showOutputChannel: jest.fn(),
};

mock.module('./logger', () => ({
  logger: mockLogger,
}));

describe('Commands', () => {
  let mockLoader: TranslationLoader;
  let mockDecorationManager: DecorationManager;

  beforeEach(() => {
    resetVscodeMocks();
    jest.clearAllMocks();

    // Create mock loader
    const mockReload = jest.fn().mockResolvedValue(undefined);
    const mockGetLocales = jest.fn().mockReturnValue(['en', 'es', 'fr']);
    const mockGetValue = jest.fn();
    const mockAddTranslation = jest.fn().mockResolvedValue(undefined);
    
    mockLoader = {
      reload: mockReload,
      getLocales: mockGetLocales,
      getValue: mockGetValue,
      addTranslation: mockAddTranslation,
      getAllKeys: jest.fn().mockReturnValue(['labels.title', 'labels.subtitle']),
      getTranslationInfo: jest.fn().mockReturnValue({
        value: 'Test Title',
        namespace: undefined,
        interpolations: [],
        keyWithoutNamespace: 'labels.title',
      }),
      getLocaleFiles: jest.fn().mockReturnValue(['/path/to/en.json']),
      getDefaultLocaleFile: jest.fn().mockReturnValue('/path/to/en.json'),
    } as any;

    // Create mock decoration manager
    mockDecorationManager = {
      updateDecorations: jest.fn(),
    } as any;

    // Initialize commands with mocks
    initializeCommands(mockLoader, mockDecorationManager);

    // Setup default config mock
    mockVscode.workspace.getConfiguration.mockReturnValue({
      get: jest.fn((key: string, defaultValue?: any) => {
        const config: Record<string, any> = {
          defaultLocale: 'en',
          defaultNamespace: 'common',
          useFileNameAsNamespace: true,
        };
        return config[key] ?? defaultValue;
      }),
    });
  });

  describe('handleReload', () => {
    test('should reload translations and update decorations', async () => {
      await handleReload();

      expect(mockLoader.reload).toHaveBeenCalledTimes(1);
      expect(mockDecorationManager.updateDecorations).toHaveBeenCalledTimes(1);
      expect(mockVscode.window.showInformationMessage).toHaveBeenCalledWith(
        'i18n translations reloaded'
      );
    });

    test('should show error message on reload failure', async () => {
      const error = new Error('Reload failed');
      (mockLoader.reload as jest.Mock).mockRejectedValueOnce(error);

      await handleReload();

      expect(mockVscode.window.showErrorMessage).toHaveBeenCalledWith(
        'Failed to reload translations. Check output for details.'
      );
    });
  });

  describe('handleShowLogs', () => {
    test('should show output channel', () => {
      handleShowLogs();

      expect(mockLogger.showOutputChannel).toHaveBeenCalledTimes(1);
      expect(mockLogger.info).toHaveBeenCalledWith('Output channel opened');
    });
  });

  describe('handleEditTranslation', () => {
    test('should edit existing translation', async () => {
      const args = {
        key: 'labels.title',
        locale: 'en',
        namespace: undefined,
        currentValue: 'Old Title',
      };

      mockVscode.window.showInputBox.mockResolvedValueOnce('New Title');
      (mockLoader.getValue as jest.Mock).mockReturnValueOnce('Old Title');

      await handleEditTranslation(args);

      expect(mockVscode.window.showInputBox).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'Enter translation value for key: labels.title (en)',
          value: 'Old Title',
        })
      );
      expect(mockLoader.addTranslation).toHaveBeenCalledWith(
        'en',
        'labels.title',
        'New Title',
        'common'
      );
      expect(mockVscode.window.showInformationMessage).toHaveBeenCalledWith(
        'Translation updated in en: labels.title'
      );
    });

    test('should create new translation if it does not exist', async () => {
      const args = {
        key: 'labels.new',
        locale: 'en',
        namespace: undefined,
      };

      mockVscode.window.showInputBox.mockResolvedValueOnce('New Translation');
      (mockLoader.getValue as jest.Mock).mockReturnValueOnce(undefined);

      await handleEditTranslation(args);

      expect(mockVscode.window.showInputBox).toHaveBeenCalledWith(
        expect.objectContaining({
          value: '',
        })
      );
      expect(mockLoader.addTranslation).toHaveBeenCalledWith(
        'en',
        'labels.new',
        'New Translation',
        'common'
      );
      expect(mockVscode.window.showInformationMessage).toHaveBeenCalledWith(
        'Translation added in en: labels.new'
      );
    });

    test('should use provided namespace', async () => {
      const args = {
        key: 'labels.title',
        locale: 'en',
        namespace: 'custom-ns',
      };

      mockVscode.window.showInputBox.mockResolvedValueOnce('New Title');
      (mockLoader.getValue as jest.Mock).mockReturnValueOnce(undefined);

      await handleEditTranslation(args);

      expect(mockLoader.addTranslation).toHaveBeenCalledWith(
        'en',
        'labels.title',
        'New Title',
        'custom-ns'
      );
    });

    test('should handle cancellation', async () => {
      const args = {
        key: 'labels.title',
        locale: 'en',
      };

      mockVscode.window.showInputBox.mockResolvedValueOnce(undefined);

      await handleEditTranslation(args);

      expect(mockLoader.addTranslation).not.toHaveBeenCalled();
    });

    test('should show error on missing parameters', async () => {
      await handleEditTranslation({ key: 'labels.title' } as any);

      expect(mockVscode.window.showErrorMessage).toHaveBeenCalledWith(
        'Missing required parameters: key and locale'
      );
    });

    test('should show error when loader not initialized', async () => {
      initializeCommands(undefined as any, mockDecorationManager);

      await handleEditTranslation({
        key: 'labels.title',
        locale: 'en',
      });

      expect(mockVscode.window.showErrorMessage).toHaveBeenCalledWith(
        'Translation loader not initialized'
      );
    });
  });

  describe('handleAddTranslationToLocale', () => {
    test('should translate and add to locale', async () => {
      const args = {
        key: 'labels.title',
        locale: 'es',
        namespace: undefined,
        sourceText: 'Hello',
      };

      mockTranslateText.mockResolvedValueOnce('Hola');
      (mockLoader.getValue as jest.Mock).mockReturnValueOnce('Hello');

      await handleAddTranslationToLocale(args);

      expect(mockTranslateText).toHaveBeenCalledWith('Hello', 'es', 'en');
      expect(mockLoader.addTranslation).toHaveBeenCalledWith(
        'es',
        'labels.title',
        'Hola',
        'common'
      );
      expect(mockVscode.window.showInformationMessage).toHaveBeenCalledWith(
        'Translation added to es: labels.title'
      );
    });

    test('should get source text from default locale if not provided', async () => {
      const args = {
        key: 'labels.title',
        locale: 'es',
      };

      (mockLoader.getValue as jest.Mock).mockReturnValueOnce('Hello');
      mockTranslateText.mockResolvedValueOnce('Hola');

      await handleAddTranslationToLocale(args);

      expect(mockLoader.getValue).toHaveBeenCalledWith('labels.title', 'en', undefined, 'common');
      expect(mockTranslateText).toHaveBeenCalledWith('Hello', 'es', 'en');
    });

    test('should show error if no source translation found', async () => {
      const args = {
        key: 'labels.title',
        locale: 'es',
      };

      (mockLoader.getValue as jest.Mock).mockReturnValueOnce(undefined);
      (mockLoader.getLocales as jest.Mock).mockReturnValueOnce(['en', 'es']);

      await handleAddTranslationToLocale(args);

      expect(mockVscode.window.showErrorMessage).toHaveBeenCalledWith(
        'No source translation found to translate from'
      );
      expect(mockLoader.addTranslation).not.toHaveBeenCalled();
    });

    test('should handle translation API errors', async () => {
      const args = {
        key: 'labels.title',
        locale: 'es',
        sourceText: 'Hello',
      };

      const error = new Error('Translation API failed');
      mockTranslateText.mockRejectedValueOnce(error);

      await handleAddTranslationToLocale(args);

      expect(mockVscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Failed to translate')
      );
    });
  });

  describe('handleTranslateAllLocales', () => {
    test('should translate to all locales except default', async () => {
      const args = {
        key: 'labels.title',
        namespace: undefined,
        sourceText: 'Hello',
      };

      (mockLoader.getLocales as jest.Mock).mockReturnValue(['en', 'es', 'fr']);
      mockTranslateText
        .mockResolvedValueOnce('Hola')
        .mockResolvedValueOnce('Bonjour');

      await handleTranslateAllLocales(args);

      expect(mockTranslateText).toHaveBeenCalledTimes(2);
      expect(mockTranslateText).toHaveBeenCalledWith('Hello', 'es', 'en');
      expect(mockTranslateText).toHaveBeenCalledWith('Hello', 'fr', 'en');
      expect(mockLoader.addTranslation).toHaveBeenCalledTimes(2);
      expect(mockLoader.addTranslation).toHaveBeenCalledWith('es', 'labels.title', 'Hola', 'common');
      expect(mockLoader.addTranslation).toHaveBeenCalledWith('fr', 'labels.title', 'Bonjour', 'common');
      expect(mockVscode.window.showInformationMessage).toHaveBeenCalledWith(
        'Successfully translated to 2 locale(s)'
      );
    });

    test('should get source text from default locale if not provided', async () => {
      const args = {
        key: 'labels.title',
      };

      (mockLoader.getLocales as jest.Mock).mockReturnValue(['en', 'es']);
      (mockLoader.getValue as jest.Mock).mockReturnValueOnce('Hello');
      mockTranslateText.mockResolvedValueOnce('Hola');

      await handleTranslateAllLocales(args);

      expect(mockLoader.getValue).toHaveBeenCalledWith('labels.title', 'en', undefined, 'common');
      expect(mockTranslateText).toHaveBeenCalledWith('Hello', 'es', 'en');
    });

    test('should show error if no source translation found', async () => {
      const args = {
        key: 'labels.title',
      };

      (mockLoader.getLocales as jest.Mock).mockReturnValue(['en', 'es']);
      (mockLoader.getValue as jest.Mock).mockReturnValueOnce(undefined);

      await handleTranslateAllLocales(args);

      expect(mockVscode.window.showErrorMessage).toHaveBeenCalledWith(
        'No source translation found in default locale (en) to translate from'
      );
      expect(mockLoader.addTranslation).not.toHaveBeenCalled();
    });

    test('should handle partial failures', async () => {
      const args = {
        key: 'labels.title',
        sourceText: 'Hello',
      };

      (mockLoader.getLocales as jest.Mock).mockReturnValue(['en', 'es', 'fr']);
      mockTranslateText
        .mockResolvedValueOnce('Hola')
        .mockRejectedValueOnce(new Error('Translation failed'));

      await handleTranslateAllLocales(args);

      expect(mockLoader.addTranslation).toHaveBeenCalledTimes(1);
      expect(mockVscode.window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('Translated to 1 locale(s), failed for 1')
      );
    });

    test('should show info message if no other locales found', async () => {
      const args = {
        key: 'labels.title',
        sourceText: 'Hello',
      };

      (mockLoader.getLocales as jest.Mock).mockReturnValue(['en']);

      await handleTranslateAllLocales(args);

      expect(mockVscode.window.showInformationMessage).toHaveBeenCalledWith(
        'No other locales found to translate to'
      );
      expect(mockLoader.addTranslation).not.toHaveBeenCalled();
    });

    test('should show error on missing key parameter', async () => {
      await handleTranslateAllLocales({ locale: 'es' } as any);

      expect(mockVscode.window.showErrorMessage).toHaveBeenCalledWith(
        'Missing required parameter: key'
      );
    });
  });
});
