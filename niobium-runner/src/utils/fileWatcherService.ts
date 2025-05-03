import * as vscode from 'vscode';
import * as path from 'path';
import { minimatch } from 'minimatch';
import { ConfigProvider, NiobiumConfig, StageConfig } from '../configProvider';
import { CommandRunner } from '../commandRunner';

export interface WatcherConfig {
  stageConfig: StageConfig;
  patterns: string[];
  debounce: number;
  enabled: boolean;
}

/**
 * Service for watching file changes and triggering stage runs
 */
export class FileWatcherService {
  private static instance: FileWatcherService;
  private watchers: Map<string, { watcher: vscode.FileSystemWatcher, config: WatcherConfig }> = new Map();
  private debouncers: Map<string, NodeJS.Timeout> = new Map();
  private statusBarItem: vscode.StatusBarItem;
  private configProvider: ConfigProvider;
  private commandRunner: CommandRunner;
  private workspaceRoot: string | undefined;
  private activeWatchCount: number = 0;
  private disposables: vscode.Disposable[] = [];

  private constructor(private context: vscode.ExtensionContext) {
    this.configProvider = new ConfigProvider();
    this.commandRunner = new CommandRunner(context);
    
    // Initialize status bar item
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    this.statusBarItem.text = "Niobium: Watch Off";
    this.statusBarItem.tooltip = "No file watchers active";
    this.statusBarItem.command = 'niobium-runner.manageFileWatchers';
    this.context.subscriptions.push(this.statusBarItem);

    // Get workspace root
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
      this.workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
    }

    // Set up configuration change listener
    this.context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('niobium-runner.fileWatchers')) {
          this.refreshWatchers();
        }
      })
    );

    // Set up workspace folder change listener
    this.context.subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.updateWorkspaceRoot();
        this.refreshWatchers();
      })
    );
  }

  /**
   * Get the singleton instance of the file watcher service
   */
  public static getInstance(context: vscode.ExtensionContext): FileWatcherService {
    if (!FileWatcherService.instance) {
      FileWatcherService.instance = new FileWatcherService(context);
    }
    return FileWatcherService.instance;
  }

  /**
   * Initialize watchers based on the configuration
   */
  public async initialize(): Promise<void> {
    console.log('Initializing file watchers');
    if (!this.workspaceRoot) {
      console.log('No workspace root available');
      return;
    }

    try {
      const config = await this.configProvider.loadConfig(this.workspaceRoot);
      if (!config || !config.stages) {
        console.log('No stages found in config');
        return;
      }

      // Create watchers for stages with watch patterns
      this.setupWatchers(config);
    } catch (error) {
      console.error('Error initializing file watchers:', error);
    }
  }

  /**
   * Toggle the enabled state of a specific file watcher
   */
  public toggleWatcher(stageName: string): void {
    const watcher = this.watchers.get(stageName);
    if (watcher) {
      watcher.config.enabled = !watcher.config.enabled;
      vscode.window.showInformationMessage(
        `File watcher for stage "${stageName}" ${watcher.config.enabled ? 'enabled' : 'disabled'}`
      );
      this.updateStatusBar();
    }
  }

  /**
   * Toggle all file watchers
   */
  public toggleAllWatchers(): void {
    if (this.activeWatchCount > 0) {
      // Disable all
      for (const [_, watcher] of this.watchers) {
        watcher.config.enabled = false;
      }
      vscode.window.showInformationMessage('All file watchers disabled');
    } else {
      // Enable all
      for (const [_, watcher] of this.watchers) {
        watcher.config.enabled = true;
      }
      vscode.window.showInformationMessage('All file watchers enabled');
    }
    this.updateStatusBar();
  }

  /**
   * Get all watchers and their configurations
   */
  public getWatchers(): { stageName: string, config: WatcherConfig }[] {
    const result: { stageName: string, config: WatcherConfig }[] = [];
    for (const [stageName, watcher] of this.watchers) {
      result.push({
        stageName,
        config: watcher.config
      });
    }
    return result;
  }

  /**
   * Refresh all watchers based on current configuration
   */
  public async refreshWatchers(): Promise<void> {
    // Clear existing watchers
    this.dispose();

    if (!this.workspaceRoot) {
      return;
    }

    try {
      const config = await this.configProvider.loadConfig(this.workspaceRoot);
      if (!config || !config.stages) {
        return;
      }

      // Create new watchers
      this.setupWatchers(config);
    } catch (error) {
      console.error('Error refreshing file watchers:', error);
    }
  }

  /**
   * Update the workspace root when workspace folders change
   */
  private updateWorkspaceRoot(): void {
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
      this.workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
    } else {
      this.workspaceRoot = undefined;
    }
  }

  /**
   * Set up watchers for each stage with watch patterns
   */
  private setupWatchers(config: NiobiumConfig): void {
    if (!config.stages) {
      return;
    }

    // Get default debounce time from settings
    const defaultDebounce = vscode.workspace.getConfiguration('niobium-runner')
      .get<number>('fileWatchers.defaultDebounce', 500);

    // Check if file watchers are enabled
    const fileWatchersEnabled = vscode.workspace.getConfiguration('niobium-runner')
      .get<boolean>('fileWatchers.enabled', true);

    if (!fileWatchersEnabled) {
      console.log('File watchers are disabled in settings');
      this.updateStatusBar();
      return;
    }

    for (const stage of config.stages) {
      if (stage.watch && stage.watch.patterns && stage.watch.patterns.length > 0) {
        const debounce = stage.watch.debounce || defaultDebounce;
        
        console.log(`Setting up watcher for stage: ${stage.name} with patterns:`, stage.watch.patterns);
        
        if (!this.workspaceRoot) {
          console.log(`No workspace root, cannot set up watchers for stage ${stage.name}`);
          continue;
        }

        const watcherConfig: WatcherConfig = {
          stageConfig: stage,
          patterns: stage.watch.patterns,
          debounce,
          enabled: true
        };

        // Create a watcher for each non-negated pattern
        // Negated patterns will be handled in matchesPatterns
        const includePatterns = stage.watch.patterns.filter(p => !p.startsWith('!'));
        
        for (const pattern of includePatterns) {
          console.log(`Creating watcher with pattern: ${pattern}`);
          
          try {
            // Create a file system watcher with the pattern relative to workspace
            const watcher = vscode.workspace.createFileSystemWatcher(
              new vscode.RelativePattern(this.workspaceRoot, pattern)
            );
            
            // Only watch save events
            watcher.onDidChange(uri => {
              console.log(`File changed: ${uri.fsPath}, checking match for stage ${stage.name}`);
              this.handleFileChange(uri, stage, debounce);
            });
            
            const watcherKey = `${stage.name}:${pattern}`;
            this.watchers.set(watcherKey, {
              watcher,
              config: watcherConfig
            });
            
            // Add the watcher to disposables
            this.context.subscriptions.push(watcher);
          } catch (error) {
            console.error(`Error creating watcher for pattern ${pattern}:`, error);
          }
        }
      }
    }

    // Update the status bar
    this.updateStatusBar();
  }

  /**
   * Handle a file change event
   */
  private handleFileChange(uri: vscode.Uri, stage: StageConfig, debounceTime: number): void {
    if (!this.workspaceRoot) {
      console.log('No workspace root, cannot handle file change');
      return;
    }

    // Get all watchers for this stage
    const stageWatchers = Array.from(this.watchers.entries())
      .filter(([key, _]) => key.startsWith(`${stage.name}:`))
      .map(([_, watcher]) => watcher);
    
    if (stageWatchers.length === 0 || !stageWatchers.some(w => w.config.enabled)) {
      console.log(`No enabled watchers found for stage ${stage.name}`);
      return;
    }

    const filePath = uri.fsPath;
    const relativePath = path.relative(this.workspaceRoot, filePath).replace(/\\/g, '/');
    
    console.log(`File changed: ${relativePath} (full path: ${filePath})`);
    
    // Use the first watcher's config as they all share the same patterns for a stage
    const watcherConfig = stageWatchers[0].config;
    
    // Check if the file matches any of the patterns
    const matches = this.matchesPatterns(relativePath, watcherConfig.patterns);
    
    if (matches) {
      console.log(`File ${relativePath} matches patterns for stage ${stage.name}`);
      
      // Get the configuration for notifications
      const showNotifications = vscode.workspace.getConfiguration('niobium-runner')
        .get<boolean>('fileWatchers.showNotifications', true);
      
      // Show a status message
      if (showNotifications) {
        vscode.window.setStatusBarMessage(`Niobium: Detected change in ${path.basename(filePath)}`, 3000);
      }
      
      // Debounce the file change to prevent multiple runs in quick succession
      if (this.debouncers.has(stage.name)) {
        clearTimeout(this.debouncers.get(stage.name));
        console.log(`Cleared existing debouncer for stage ${stage.name}`);
      }
      
      // Set up a new debouncer
      console.log(`Setting up debouncer for stage ${stage.name} with delay ${debounceTime}ms`);
      this.debouncers.set(
        stage.name,
        setTimeout(async () => {
          console.log(`Running stage ${stage.name} due to file change`);
          
          // Notify the user
          if (showNotifications) {
            vscode.window.showInformationMessage(`Running stage "${stage.name}" due to file change in ${path.basename(filePath)}`);
          }
          
          // Run the stage
          if (this.workspaceRoot) {
            const config = await this.configProvider.loadConfig(this.workspaceRoot);
            if (config) {
              console.log(`Starting stage ${stage.name}`);
              const result = await this.commandRunner.runStage(config, stage.name, this.workspaceRoot);
              
              // Refresh dashboard after stage completes
              try {
                const { DashboardPanel } = require('../ui/dashboardPanel');
                // Add an activity entry to show the completion
                if (result && result.success) {
                  DashboardPanel.addActivity({
                    type: 'success',
                    text: `Stage "${stage.name}" completed successfully`,
                    time: new Date()
                  });
                } else {
                  DashboardPanel.addActivity({
                    type: 'error',
                    text: `Stage "${stage.name}" failed: ${result?.error || 'Unknown error'}`,
                    time: new Date()
                  });
                }
                // Force refresh the dashboard panel
                DashboardPanel.refresh();
              } catch (error) {
                console.error('Error refreshing dashboard after stage completion:', error);
              }
            } else {
              console.error(`Could not load config to run stage ${stage.name}`);
            }
          }
          
          // Clear the debouncer
          this.debouncers.delete(stage.name);
        }, debounceTime)
      );
    } else {
      console.log(`File ${relativePath} does not match any patterns for stage ${stage.name}`);
    }
  }

  /**
   * Check if a file path matches any of the provided patterns
   */
  private matchesPatterns(filePath: string, patterns: string[]): boolean {
    console.log(`Checking if '${filePath}' matches any of these patterns:`, patterns);
    
    let matchesAny = false;
    
    for (const pattern of patterns) {
      // Skip empty patterns
      if (!pattern) {
        continue;
      }
      
      // Handle negated patterns (patterns starting with !)
      if (pattern.startsWith('!')) {
        const negatedPattern = pattern.substring(1);
        const matches = minimatch(filePath, negatedPattern);
        console.log(`  Checking against negated pattern '${negatedPattern}': ${matches ? 'matched' : 'not matched'}`);
        
        if (matches) {
          console.log(`  File explicitly excluded by pattern '${pattern}'`);
          return false; // File matches a negated pattern, explicitly excluded
        }
      } else {
        const matches = minimatch(filePath, pattern);
        console.log(`  Checking against pattern '${pattern}': ${matches ? 'matched' : 'not matched'}`);
        
        if (matches) {
          matchesAny = true;
        }
      }
    }
    
    if (matchesAny) {
      console.log(`  File matched at least one include pattern`);
    } else {
      console.log(`  File did not match any include patterns`);
    }
    
    return matchesAny;
  }

  /**
   * Dispose all watchers and cleanup resources
   */
  public dispose(): void {
    console.log('Disposing file watcher service');
    
    // Clean up any pending debouncers
    for (const [stageName, debouncer] of this.debouncers.entries()) {
      clearTimeout(debouncer);
      this.debouncers.delete(stageName);
    }
    
    // Dispose all file watchers
    for (const [watcherKey, watcherInfo] of this.watchers.entries()) {
      console.log(`Disposing watcher for ${watcherKey}`);
      watcherInfo.watcher.dispose();
    }
    
    this.watchers.clear();
    
    // Dispose all disposables
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
  }

  /**
   * Update the status bar item based on the current state
   */
  private updateStatusBar(): void {
    // Count active watchers
    this.activeWatchCount = 0;
    for (const [_, watcher] of this.watchers) {
      if (watcher.config.enabled) {
        this.activeWatchCount++;
      }
    }
    
    if (this.activeWatchCount > 0) {
      this.statusBarItem.text = `Niobium: ${this.activeWatchCount} Watch${this.activeWatchCount > 1 ? 'es' : ''}`;
      this.statusBarItem.tooltip = `${this.activeWatchCount} file watcher${this.activeWatchCount > 1 ? 's' : ''} active`;
      this.statusBarItem.show();
    } else if (this.watchers.size > 0) {
      this.statusBarItem.text = "Niobium: Watch Off";
      this.statusBarItem.tooltip = "File watchers disabled";
      this.statusBarItem.show();
    } else {
      this.statusBarItem.text = "$(circle-slash) Niobium: No Watchers";
      this.statusBarItem.tooltip = "No file watchers configured";
      this.statusBarItem.hide();
    }
  }

  /**
   * Start a specific stage watcher
   */
  public async startWatcher(stageId: string): Promise<void> {
    const stageWatchers = Array.from(this.watchers.entries())
      .filter(([key, _]) => key.startsWith(`${stageId}:`))
      .map(([_, watcher]) => watcher);
    
    if (stageWatchers.length > 0) {
      // Enable the watchers
      for (const watcher of stageWatchers) {
        watcher.config.enabled = true;
      }
      this.updateStatusBar();
      
      // Show notification
      vscode.window.showInformationMessage(`File watcher for stage "${stageId}" enabled`);
    }
  }

  /**
   * Check if files match the specified patterns
   * @param files List of file paths to check
   * @param patterns List of glob patterns to match against
   * @param workspaceRoot The workspace root path
   * @returns List of matched file paths
   */
  public getMatchingFiles(files: string[], patterns: string[], workspaceRoot: string): string[] {
    if (!files.length || !patterns.length) {
      return [];
    }

    const matchedFiles: string[] = [];
    
    for (const file of files) {
      // Make the file path relative to workspace root for consistent matching
      const relativePath = this.makeRelativePath(file, workspaceRoot);
      
      if (this.matchesPatterns(relativePath, patterns)) {
        matchedFiles.push(file);
      }
    }
    
    return matchedFiles;
  }

  /**
   * Make a file path relative to the workspace root
   * @param filePath File path to make relative
   * @param workspaceRoot The workspace root path
   * @returns Relative file path
   */
  private makeRelativePath(filePath: string, workspaceRoot: string): string {
    // Check if the path is already relative
    if (!path.isAbsolute(filePath)) {
      return filePath;
    }
    
    // Make the path relative to the workspace root
    let relativePath = path.relative(workspaceRoot, filePath);
    
    // Convert backslashes to forward slashes for consistency
    relativePath = relativePath.replace(/\\/g, '/');
    
    return relativePath;
  }
} 