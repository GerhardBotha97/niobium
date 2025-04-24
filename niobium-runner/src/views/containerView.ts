import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { ConfigProvider } from '../configProvider';
import { getConfigFilePath, getConfigWatchPattern } from '../utils/configUtils';

export class ContainerItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly containerId?: string,
    public readonly containerStatus?: string,
    public readonly command?: vscode.Command,
    public readonly contextValue?: string
  ) {
    super(label, collapsibleState);
    
    // Set status description and icons
    this.description = containerStatus || '';
    
    // Set different icons based on status
    if (containerStatus === 'running') {
      this.iconPath = new vscode.ThemeIcon('vm-running');
    } else if (containerStatus === 'stopped') {
      this.iconPath = new vscode.ThemeIcon('vm-stopped');
    } else {
      this.iconPath = new vscode.ThemeIcon('vm');
    }
  }
}

export class ContainerViewProvider implements vscode.TreeDataProvider<ContainerItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<ContainerItem | undefined | null | void> = new vscode.EventEmitter<ContainerItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<ContainerItem | undefined | null | void> = this._onDidChangeTreeData.event;
  
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

  getTreeItem(element: ContainerItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ContainerItem): Promise<ContainerItem[]> {
    if (!vscode.workspace.workspaceFolders) {
      return [new ContainerItem(
        'No workspace folder open',
        vscode.TreeItemCollapsibleState.None
      )];
    }
    
    const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const configPath = getConfigFilePath();
    
    if (!configPath) {
      return [new ContainerItem(
        'No config file found',
        vscode.TreeItemCollapsibleState.None,
        undefined,
        undefined,
        {
          command: 'workbench.action.quickOpen',
          title: 'Create Configuration',
          arguments: ['.niobium.yml']
        }
      )];
    }
    
    try {
      // We only support a flat list of containers (no nesting)
      const config = await this._configProvider.loadConfig(workspaceRoot);
      
      if (!config || !config.containers || config.containers.length === 0) {
        return [new ContainerItem(
          'No containers defined in configuration',
          vscode.TreeItemCollapsibleState.None
        )];
      }
      
      return config.containers.map((container: any) => {
        const containerItem = new ContainerItem(
          container.name,
          vscode.TreeItemCollapsibleState.None,
          container.id || 'unknown', // Container ID
          container.status || 'unknown', // Container status
          {
            command: 'niobium-runner.startContainer',
            title: 'Start Container',
            arguments: [container.name]
          },
          'container'
        );
        
        // Additional properties
        containerItem.tooltip = `${container.name} (${container.image})`;
        
        return containerItem;
      });
    } catch (error) {
      console.error('Error getting container items:', error);
      return [new ContainerItem(
        `Error: ${error instanceof Error ? error.message : String(error)}`,
        vscode.TreeItemCollapsibleState.None
      )];
    }
  }
} 