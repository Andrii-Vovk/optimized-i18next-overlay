import { jest } from 'bun:test';

/**
 * Mock vscode module for testing
 */
export const mockVscode = {
  window: {
    showInformationMessage: jest.fn(),
    showErrorMessage: jest.fn(),
    showWarningMessage: jest.fn(),
    showInputBox: jest.fn(),
    showQuickPick: jest.fn(),
    withProgress: jest.fn((options: any, callback: (progress: any) => Promise<any>) => {
      const mockProgress = {
        report: jest.fn(),
      };
      return callback(mockProgress);
    }),
    activeTextEditor: undefined as any,
    showTextDocument: jest.fn(),
    createOutputChannel: jest.fn(() => ({
      appendLine: jest.fn(),
      append: jest.fn(),
      clear: jest.fn(),
      show: jest.fn(),
      hide: jest.fn(),
      dispose: jest.fn(),
    })),
  },
  workspace: {
    getConfiguration: jest.fn(),
    openTextDocument: jest.fn(),
  },
  Position: jest.fn((line: number, character: number) => ({
    line,
    character,
  })),
  Range: jest.fn((start: any, end: any) => ({
    start,
    end,
  })),
  Selection: jest.fn((start: any, end: any) => ({
    start,
    end,
  })),
  ViewColumn: {
    Beside: 2,
    Active: 1,
    One: 1,
    Two: 2,
    Three: 3,
    Four: 4,
    Five: 5,
    Six: 6,
    Seven: 7,
    Eight: 8,
    Nine: 9,
  },
  ProgressLocation: {
    SourceControl: 1,
    Window: 10,
    Notification: 15,
  },
  TextEditorRevealType: {
    Default: 0,
    InCenter: 1,
    InCenterIfOutsideViewport: 2,
    AtTop: 3,
  },
};

/**
 * Reset all vscode mocks
 */
export function resetVscodeMocks(): void {
  mockVscode.window.showInformationMessage.mockReset();
  mockVscode.window.showErrorMessage.mockReset();
  mockVscode.window.showWarningMessage.mockReset();
  mockVscode.window.showInputBox.mockReset();
  mockVscode.window.showQuickPick.mockReset();
  // Don't reset withProgress implementation, just clear call history
  mockVscode.window.withProgress.mockClear();
  // Restore the implementation
  mockVscode.window.withProgress.mockImplementation((options: any, callback: (progress: any) => Promise<any>) => {
    const mockProgress = {
      report: jest.fn(),
    };
    return callback(mockProgress);
  });
  mockVscode.window.showTextDocument.mockReset();
  mockVscode.window.createOutputChannel.mockReset();
  // Restore createOutputChannel implementation
  mockVscode.window.createOutputChannel.mockImplementation(() => ({
    appendLine: jest.fn(),
    append: jest.fn(),
    clear: jest.fn(),
    show: jest.fn(),
    hide: jest.fn(),
    dispose: jest.fn(),
  }));
  mockVscode.workspace.getConfiguration.mockReset();
  mockVscode.workspace.openTextDocument.mockReset();
  mockVscode.window.activeTextEditor = undefined;
}
