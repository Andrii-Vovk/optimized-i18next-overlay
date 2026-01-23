import * as vscode from 'vscode';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

class Logger {
  private outputChannel: vscode.OutputChannel | null = null;
  private logLevel: LogLevel = LogLevel.DEBUG;

  constructor() {
    // Create output channel for VSCode
    try {
      this.outputChannel = vscode.window.createOutputChannel('i18n Overlay');
    } catch (e) {
      // Fallback to console if output channel not available
      console.warn('Failed to create output channel, using console:', e);
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.logLevel;
  }

  private formatMessage(level: string, message: string, ...args: any[]): string {
    const timestamp = new Date().toISOString();
    const formattedArgs = args.length > 0 ? ` ${JSON.stringify(args)}` : '';
    return `[${timestamp}] [${level}] ${message}${formattedArgs}`;
  }

  private write(level: LogLevel, levelName: string, message: string, ...args: any[]): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const formatted = this.formatMessage(levelName, message, ...args);

    if (this.outputChannel) {
      this.outputChannel.appendLine(formatted);
    } else {
      console.log(formatted);
    }
  }

  debug(message: string, ...args: any[]): void {
    this.write(LogLevel.DEBUG, 'DEBUG', message, ...args);
  }

  info(message: string, ...args: any[]): void {
    this.write(LogLevel.INFO, 'INFO', message, ...args);
  }

  warn(message: string, ...args: any[]): void {
    this.write(LogLevel.WARN, 'WARN', message, ...args);
  }

  error(message: string, ...args: any[]): void {
    this.write(LogLevel.ERROR, 'ERROR', message, ...args);
  }

  showOutputChannel(): void {
    if (this.outputChannel) {
      this.outputChannel.show();
    }
  }
}

export const logger = new Logger();
