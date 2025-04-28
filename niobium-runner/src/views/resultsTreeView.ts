import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class ResultsItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly filePath?: string,
    public readonly filename?: string,
    public readonly details?: string,
    commandId?: string
  ) {
    super(label, collapsibleState);
    
    this.tooltip = details ? details : label;
    this.description = details;
    
    if (commandId && filename) {
      this.command = {
        command: commandId,
        title: 'Show Details',
        arguments: [filename]
      };
    }

    // Set the icon path to a theme icon by default
    this.iconPath = new vscode.ThemeIcon('document');
  }

  contextValue = 'result';
}

export class ResultsTreeDataProvider implements vscode.TreeDataProvider<ResultsItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<ResultsItem | undefined | null | void> = new vscode.EventEmitter<ResultsItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<ResultsItem | undefined | null | void> = this._onDidChangeTreeData.event;

  constructor() {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ResultsItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ResultsItem): Thenable<ResultsItem[]> {
    if (element) {
      // If we have an element, return its children
      return Promise.resolve(this.getChildrenForItem(element));
    } else {
      // If no element is provided, return root items
      return Promise.resolve(this.getRootItems());
    }
  }

  private getRootItems(): ResultsItem[] {
    // Check if results directory exists
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return [this.createNoResultsItem("No workspace open")];
    }

    const resultsDir = path.join(workspaceFolders[0].uri.fsPath, '.niobium_results');
    
    // If directory doesn't exist or is empty, show placeholder
    if (!fs.existsSync(resultsDir)) {
      return [this.createNoResultsItem("No scan results found")];
    }
    
    try {
      // Get actual result files from the directory
      const files = fs.readdirSync(resultsDir)
        .filter(file => !fs.statSync(path.join(resultsDir, file)).isDirectory())
        .filter(file => file.endsWith('.json'));
      
      if (files.length === 0) {
        return [this.createNoResultsItem("No scan results found")];
      }
      
      // Create items for each file
      return files.map(file => {
        return new ResultsItem(
          file,
          vscode.TreeItemCollapsibleState.Collapsed,
          path.join(resultsDir, file),
          file,
          `Result file: ${file}`
        );
      });
    } catch (error) {
      return [this.createNoResultsItem(`Error reading results: ${error}`)];
    }
  }
  
  private createNoResultsItem(message: string): ResultsItem {
    const item = new ResultsItem(
      message,
      vscode.TreeItemCollapsibleState.None
    );
    item.iconPath = new vscode.ThemeIcon('info');
    return item;
  }

  private getChildrenForItem(item: ResultsItem): ResultsItem[] {
    // If this is a "no results" item, return empty array
    if (!item.filename) {
      return [];
    }
    
    // If we have a file path, try to read and parse the file
    if (item.filePath && fs.existsSync(item.filePath)) {
      try {
        const content = fs.readFileSync(item.filePath, 'utf8');
        const data = JSON.parse(content);
        
        // Create items based on the content of the file
        const results: ResultsItem[] = [];
        
        // Add basic file info
        results.push(new ResultsItem(
          `File: ${item.filename}`,
          vscode.TreeItemCollapsibleState.None
        ));
        
        // Generic handler for any JSON file - get top-level keys
        Object.keys(data).forEach(key => {
          if (typeof data[key] === 'object' && data[key] !== null && Array.isArray(data[key])) {
            results.push(new ResultsItem(
              `${key}: ${data[key].length} items`,
              vscode.TreeItemCollapsibleState.None
            ));
          } else {
            results.push(new ResultsItem(
              `${key}: ${data[key]}`,
              vscode.TreeItemCollapsibleState.None
            ));
          }
        });
        
        // Add action to view the full report
        const viewReportItem = new ResultsItem(
          'View Full Report',
          vscode.TreeItemCollapsibleState.None,
          undefined,
          item.filename,
          'Click to view the full report',
          'niobium-runner.showFullReport'
        );
        viewReportItem.iconPath = new vscode.ThemeIcon('link-external');
        results.push(viewReportItem);
        
        return results;
      } catch (error) {
        return [
          new ResultsItem(
            `Error parsing file: ${error}`,
            vscode.TreeItemCollapsibleState.None
          )
        ];
      }
    }
    
    // Default response if we can't read the file or understand its format
    return [
      new ResultsItem(
        'No details available',
        vscode.TreeItemCollapsibleState.None
      )
    ];
  }
}

export function registerResultsTreeView(context: vscode.ExtensionContext) {
  // Create the tree data provider
  const resultsDataProvider = new ResultsTreeDataProvider();
  
  // Register the tree data provider for a view
  const treeView = vscode.window.createTreeView('niobium-results-view', {
    treeDataProvider: resultsDataProvider,
    showCollapseAll: true
  });
  
  // Register refresh command
  const refreshCommand = vscode.commands.registerCommand('niobium-runner.refreshResultsView', () => {
    resultsDataProvider.refresh();
    vscode.window.showInformationMessage('Niobium results refreshed');
  });
  
  // Register the show details command
  const showDetailsCommand = vscode.commands.registerCommand('niobium-runner.showResultDetails', (filename: string) => {
    vscode.window.showInformationMessage(`Showing details for ${filename}`);
  });
  
  // Register the show full report command
  const showFullReportCommand = vscode.commands.registerCommand('niobium-runner.showFullReport', (filename: string) => {
    // Check if the file exists in the results directory
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      vscode.window.showErrorMessage('No workspace open');
      return;
    }

    const filePath = path.join(workspaceFolders[0].uri.fsPath, '.niobium_results', filename);
    
    if (fs.existsSync(filePath)) {
      // Open the file in the editor
      vscode.workspace.openTextDocument(filePath).then(doc => {
        vscode.window.showTextDocument(doc);
      });
    } else {
      vscode.window.showErrorMessage(`File not found: ${filename}`);
    }
  });
  
  // Add to context
  context.subscriptions.push(treeView, refreshCommand, showDetailsCommand, showFullReportCommand);
  
  return resultsDataProvider;
} 