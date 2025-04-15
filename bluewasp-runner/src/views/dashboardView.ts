import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { ConfigProvider } from '../configProvider';
import { getConfigFilePath, getConfigWatchPattern } from '../utils/configUtils';

// Define the tree item types
export class DashboardItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly command?: vscode.Command,
    public readonly contextValue?: string
  ) {
    super(label, collapsibleState);
  }
}

export class DashboardViewProvider implements vscode.TreeDataProvider<DashboardItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<DashboardItem | undefined | null | void> = new vscode.EventEmitter<DashboardItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<DashboardItem | undefined | null | void> = this._onDidChangeTreeData.event;
  
  private _configProvider: ConfigProvider;
  private _fileWatcher: vscode.FileSystemWatcher | undefined;
  
  constructor(private context: vscode.ExtensionContext) {
    this._configProvider = new ConfigProvider();
    this._setupConfigFileWatcher();
  }

  private _setupConfigFileWatcher() {
    // Dispose any existing file watcher
    if (this._fileWatcher) {
      this._fileWatcher.dispose();
    }

    // Create a file system watcher using the pattern from configUtils
    this._fileWatcher = vscode.workspace.createFileSystemWatcher(getConfigWatchPattern());
    
    this._fileWatcher.onDidChange(() => this.refresh());
    this._fileWatcher.onDidCreate(() => this.refresh());
    this._fileWatcher.onDidDelete(() => this.refresh());
    
    // Dispose the watcher when the extension is deactivated
    this.context.subscriptions.push(this._fileWatcher);
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: DashboardItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: DashboardItem): Promise<DashboardItem[]> {
    if (!vscode.workspace.workspaceFolders) {
      return [new DashboardItem(
        'No workspace folder open',
        vscode.TreeItemCollapsibleState.None
      )];
    }
    
    const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const configPath = getConfigFilePath();
    
    if (!configPath) {
      return [new DashboardItem(
        'No config file found',
        vscode.TreeItemCollapsibleState.None,
        {
          command: 'workbench.action.quickOpen',
          title: 'Create Configuration',
          arguments: ['.bluewasp.yml']
        }
      )];
    }
    
    try {
      if (!element) {
        // Root level items
        const config = await this._configProvider.loadConfig(workspaceRoot);
        
        if (!config) {
          return [new DashboardItem(
            'Error loading configuration',
            vscode.TreeItemCollapsibleState.None
          )];
        }
        
        const items: DashboardItem[] = [];
        
        // Commands section
        if (config.commands && config.commands.length > 0) {
          const commandsItem = new DashboardItem(
            'Commands',
            vscode.TreeItemCollapsibleState.Expanded,
            undefined,
            'commands'
          );
          commandsItem.iconPath = new vscode.ThemeIcon('terminal');
          items.push(commandsItem);
        }
        
        // Stages section
        if (config.stages && config.stages.length > 0) {
          const stagesItem = new DashboardItem(
            'Stages',
            vscode.TreeItemCollapsibleState.Expanded,
            undefined,
            'stages'
          );
          stagesItem.iconPath = new vscode.ThemeIcon('list-tree');
          items.push(stagesItem);
        }
        
        // Sequences section
        if (config.sequences && config.sequences.length > 0) {
          const sequencesItem = new DashboardItem(
            'Sequences',
            vscode.TreeItemCollapsibleState.Expanded,
            undefined,
            'sequences'
          );
          sequencesItem.iconPath = new vscode.ThemeIcon('flow');
          items.push(sequencesItem);
        }
        
        return items;
      } else {
        // Child items for Commands, Stages, or Sequences
        const config = await this._configProvider.loadConfig(workspaceRoot);
        
        if (!config) {
          return [];
        }
        
        switch (element.contextValue) {
          case 'commands':
            return this._getCommandItems(config);
          case 'stages':
            return this._getStageItems(config);
          case 'sequences':
            return this._getSequenceItems(config);
          default:
            return [];
        }
      }
    } catch (error) {
      console.error('Error getting dashboard items:', error);
      return [new DashboardItem(
        `Error: ${error instanceof Error ? error.message : String(error)}`,
        vscode.TreeItemCollapsibleState.None
      )];
    }
  }
  
  private _getCommandItems(config: any): DashboardItem[] {
    return config.commands.map((cmd: any) => {
      const cmdItem = new DashboardItem(
        cmd.name,
        vscode.TreeItemCollapsibleState.None,
        {
          command: 'bluewasp-runner.runSpecificCommand',
          title: 'Run Command',
          arguments: [cmd.name]
        },
        'command'
      );
      
      cmdItem.description = cmd.description || cmd.command;
      cmdItem.tooltip = cmd.description || cmd.command;
      
      // Use different icons for regular vs Docker commands
      if (cmd.image) {
        cmdItem.iconPath = new vscode.ThemeIcon('docker');
      } else {
        cmdItem.iconPath = new vscode.ThemeIcon('terminal');
      }
      
      return cmdItem;
    });
  }
  
  private _getStageItems(config: any): DashboardItem[] {
    return config.stages.map((stage: any) => {
      const stageItem = new DashboardItem(
        stage.name,
        vscode.TreeItemCollapsibleState.None,
        {
          command: 'bluewasp-runner.runSpecificStage',
          title: 'Run Stage',
          arguments: [stage.name]
        },
        'stage'
      );
      
      stageItem.description = stage.description || '';
      stageItem.tooltip = stage.description || stage.name;
      stageItem.iconPath = new vscode.ThemeIcon('list-tree');
      
      return stageItem;
    });
  }
  
  private _getSequenceItems(config: any): DashboardItem[] {
    return config.sequences.map((sequence: any) => {
      const sequenceItem = new DashboardItem(
        sequence.name,
        vscode.TreeItemCollapsibleState.None,
        {
          command: 'bluewasp-runner.runSpecificSequence',
          title: 'Run Sequence',
          arguments: [sequence.name]
        },
        'sequence'
      );
      
      sequenceItem.description = sequence.description || '';
      sequenceItem.tooltip = sequence.description || sequence.name;
      sequenceItem.iconPath = new vscode.ThemeIcon('flow');
      
      return sequenceItem;
    });
  }
} 