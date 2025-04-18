import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Class to handle .bluewaspignore file parsing and pattern matching
 */
export class IgnoreProvider {
  private static instance: IgnoreProvider;
  private patterns: string[] = [];
  private ignorePath: string | undefined;
  private fileWatcher: vscode.FileSystemWatcher | undefined;

  /**
   * Get the singleton instance of the IgnoreProvider
   */
  public static getInstance(): IgnoreProvider {
    if (!IgnoreProvider.instance) {
      IgnoreProvider.instance = new IgnoreProvider();
    }
    return IgnoreProvider.instance;
  }

  /**
   * Initialize the ignore provider with the workspace root
   */
  public initialize(context: vscode.ExtensionContext): void {
    this.loadIgnoreFile();
    this.setupFileWatcher(context);
  }

  /**
   * Check if a file path should be ignored
   * @param filePath File path to check (relative to workspace root)
   * @returns True if the file should be ignored, false otherwise
   */
  public isIgnored(filePath: string): boolean {
    if (this.patterns.length === 0) {
      return false;
    }

    // Normalize path for consistent matching
    const normalizedPath = filePath.replace(/\\/g, '/');
    
    // Check if any pattern matches
    for (const pattern of this.patterns) {
      // Handle negation patterns (patterns starting with !)
      if (pattern.startsWith('!')) {
        const negatedPattern = pattern.substring(1);
        if (this.matchPattern(normalizedPath, negatedPattern)) {
          return false; // This file is explicitly included
        }
      } else if (this.matchPattern(normalizedPath, pattern)) {
        return true; // This file should be ignored
      }
    }

    return false;
  }

  /**
   * Simple pattern matching implementation to avoid dependency issues
   */
  private matchPattern(filePath: string, pattern: string): boolean {
    // Convert glob pattern to regex
    let regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '###GLOBSTAR###')
      .replace(/\*/g, '[^/]*')
      .replace(/###GLOBSTAR###/g, '.*')
      .replace(/\?/g, '[^/]');
    
    // Handle when pattern starts with /
    if (regexPattern.startsWith('/')) {
      regexPattern = '^' + regexPattern.substring(1);
    } else {
      // If pattern doesn't start with /, it can match anywhere in the path
      regexPattern = '(^|/)' + regexPattern;
    }
    
    // If pattern doesn't end with /, it should match exactly
    if (!regexPattern.endsWith('/')) {
      regexPattern += '$';
    }
    
    const regex = new RegExp(regexPattern);
    return regex.test(filePath);
  }

  /**
   * Load patterns from the .bluewaspignore file
   */
  public loadIgnoreFile(): void {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        return;
      }

      const rootPath = workspaceFolders[0].uri.fsPath;
      const ignorePath = path.join(rootPath, '.bluewaspignore');
      this.ignorePath = ignorePath;

      if (!fs.existsSync(ignorePath)) {
        this.patterns = [];
        return;
      }

      const content = fs.readFileSync(ignorePath, 'utf8');
      const lines = content.split(/\r?\n/);
      
      // Parse ignore patterns
      this.patterns = lines
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('#')) // Skip comments and empty lines
        .map(pattern => {
          // If pattern doesn't contain a slash and doesn't start with !, 
          // it's a file pattern that should match in any directory
          if (!pattern.includes('/') && !pattern.startsWith('!')) {
            return `**/${pattern}`;
          }
          // If pattern starts with /, remove the leading / to make it relative to workspace root
          if (pattern.startsWith('/') && !pattern.startsWith('!/')) {
            return pattern.substring(1);
          }
          // If negation pattern starts with /, remove the leading / to make it relative to workspace root
          if (pattern.startsWith('!/')) {
            return `!${pattern.substring(2)}`;
          }
          return pattern;
        });

      console.log(`Loaded ${this.patterns.length} ignore patterns from .bluewaspignore`);
    } catch (error) {
      console.error('Error loading .bluewaspignore file:', error);
      this.patterns = [];
    }
  }

  /**
   * Set up a file watcher to reload patterns when the ignore file changes
   */
  private setupFileWatcher(context: vscode.ExtensionContext): void {
    // Remove existing watcher if any
    if (this.fileWatcher) {
      this.fileWatcher.dispose();
    }

    // Create a file system watcher for the .bluewaspignore file
    this.fileWatcher = vscode.workspace.createFileSystemWatcher('**/.bluewaspignore');
    
    // Reload patterns when the file changes
    this.fileWatcher.onDidChange(() => this.loadIgnoreFile());
    this.fileWatcher.onDidCreate(() => this.loadIgnoreFile());
    this.fileWatcher.onDidDelete(() => {
      console.log('.bluewaspignore file deleted');
      this.patterns = [];
    });
    
    // Dispose the watcher when the extension is deactivated
    context.subscriptions.push(this.fileWatcher);
  }
} 