import * as vscode from 'vscode';
import { FileWatcherService } from '../utils/fileWatcherService';

/**
 * TreeItem for file watchers
 */
export class FileWatcherItem extends vscode.TreeItem {
  constructor(
    public readonly stageName: string,
    public readonly description: string,
    public readonly enabled: boolean,
    public readonly patterns: string[],
    public readonly debounceTime: number,
    public readonly isPreCommit: boolean = false
  ) {
    super(
      stageName,
      vscode.TreeItemCollapsibleState.Collapsed
    );

    this.tooltip = `${description || stageName}\nEnabled: ${enabled ? 'Yes' : 'No'}\nDebounce: ${debounceTime}ms\nPre-Commit: ${isPreCommit ? 'Yes' : 'No'}`;
    this.contextValue = enabled ? 
      (isPreCommit ? 'enabledPreCommitWatcher' : 'enabledWatcher') : 
      (isPreCommit ? 'disabledPreCommitWatcher' : 'disabledWatcher');
    
    // Use a git icon for pre-commit watchers, regular eye icon for normal watchers
    const iconName = isPreCommit ? 
      (enabled ? 'git-commit' : 'circle-slash') : 
      (enabled ? 'eye' : 'eye-closed');
    this.iconPath = new vscode.ThemeIcon(iconName);

    // Add metadata
    this.description = description || (enabled ? 
      (isPreCommit ? 'Pre-Commit' : 'Enabled') : 
      (isPreCommit ? 'Pre-Commit (Disabled)' : 'Disabled'));
  }
}

/**
 * TreeItem for watch patterns
 */
export class WatchPatternItem extends vscode.TreeItem {
  constructor(
    public readonly pattern: string
  ) {
    super(
      pattern,
      vscode.TreeItemCollapsibleState.None
    );

    // Set the icon based on if it's an include or exclude pattern
    this.iconPath = new vscode.ThemeIcon(
      pattern.startsWith('!') ? 'exclude' : 'include'
    );

    // Set a description for exclude patterns
    if (pattern.startsWith('!')) {
      this.description = 'Exclude';
    } else {
      this.description = 'Include';
    }
  }
}

/**
 * Tree data provider for file watchers
 */
export class FileWatcherViewProvider implements vscode.TreeDataProvider<FileWatcherItem | WatchPatternItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<FileWatcherItem | WatchPatternItem | undefined | null | void> = new vscode.EventEmitter<FileWatcherItem | WatchPatternItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<FileWatcherItem | WatchPatternItem | undefined | null | void> = this._onDidChangeTreeData.event;
  
  private fileWatcherService: FileWatcherService;
  private watcherItems: Map<string, { item: FileWatcherItem, patterns: WatchPatternItem[] }> = new Map();
  
  constructor(private context: vscode.ExtensionContext) {
    this.fileWatcherService = FileWatcherService.getInstance(context);
    
    // Register refresh command
    this.context.subscriptions.push(
      vscode.commands.registerCommand('niobium-runner.refreshFileWatchers', () => {
        this.refresh();
      })
    );
    
    // Register toggle command
    this.context.subscriptions.push(
      vscode.commands.registerCommand('niobium-runner.toggleFileWatcher', (item: FileWatcherItem) => {
        this.fileWatcherService.toggleWatcher(item.stageName);
        this.refresh();
      })
    );
    
    // Initialize file watchers
    this.fileWatcherService.initialize();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: FileWatcherItem | WatchPatternItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: FileWatcherItem | WatchPatternItem): Promise<(FileWatcherItem | WatchPatternItem)[]> {
    if (!element) {
      // Root level - Get all watchers
      this.watcherItems.clear();
      
      const watchers = this.fileWatcherService.getWatchers();
      
      if (watchers.length === 0) {
        // No watchers configured
        return [];
      }
      
      // Create TreeItems for each watcher
      for (const watcher of watchers) {
        const item = new FileWatcherItem(
          watcher.stageName,
          watcher.config.stageConfig.description || '',
          watcher.config.enabled,
          watcher.config.patterns,
          watcher.config.debounce,
          watcher.config.stageConfig.watch?.pre_commit || false
        );
        
        // Create pattern items
        const patternItems = watcher.config.patterns.map(
          pattern => new WatchPatternItem(pattern)
        );
        
        this.watcherItems.set(watcher.stageName, {
          item,
          patterns: patternItems
        });
      }
      
      // Return the watcher items
      return Array.from(this.watcherItems.values()).map(w => w.item);
    } else if (element instanceof FileWatcherItem) {
      // Child level - Get patterns for this watcher
      const watcher = this.watcherItems.get(element.stageName);
      if (watcher) {
        return watcher.patterns;
      }
    }
    
    return [];
  }
}

/**
 * Initialize the file watcher view
 */
export function registerFileWatcherView(context: vscode.ExtensionContext): void {
  // Register the tree data provider
  const fileWatcherViewProvider = new FileWatcherViewProvider(context);
  
  vscode.window.registerTreeDataProvider(
    'niobium-file-watchers',
    fileWatcherViewProvider
  );
  
  // Register command to show the view
  context.subscriptions.push(
    vscode.commands.registerCommand('niobium-runner.showFileWatcherView', () => {
      vscode.commands.executeCommand('workbench.view.extension.niobium-sidebar');
      vscode.commands.executeCommand('niobium-file-watchers.focus');
    })
  );
} 