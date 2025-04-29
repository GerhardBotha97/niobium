import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { integrationRegistry } from '../integrations';

export class ResultsItem extends vscode.TreeItem {
  public children?: ResultsItem[];
  
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
      // If the element has children defined already, return them
      if (element.children) {
        return Promise.resolve(element.children);
      }
      
      // Otherwise, return its children based on the file
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
        
        // Try to find an integration that can handle this file
        const integration = integrationRegistry.findIntegrationForFile(item.filename, data);
        
        if (integration) {
          // Use the integration to parse the results
          return integration.parseResults(data, item.filePath, item.filename);
        }
        
        // If no integration found, fall back to generic JSON handling
        return this.handleGenericJson(data, item);
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

  private handleGenericJson(data: any, item: ResultsItem): ResultsItem[] {
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
  
  // Register command to open file at specific location
  const openFileAtLocationCommand = vscode.commands.registerCommand('niobium-runner.openFileAtLocation', 
    async (filePath: string, lineNumber?: number, columnNumber?: number) => {
      try {
        // Extract just the filename for display
        const fileName = path.basename(filePath);
        
        // Get workspace folders
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
          throw new Error('No workspace folder is open');
        }
        
        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        
        // Simplified path handling - just handle a few common cases
        
        // If we have a path like '/src/path/to/file.ext'
        let resolvedPath = filePath;
        
        // If path starts with /src/, remove it and make it relative to workspace
        if (filePath.startsWith('/src/')) {
          resolvedPath = path.join(workspaceRoot, filePath.substring(5));
        } 
        // If path starts with / but isn't an absolute path in the system context
        else if (filePath.startsWith('/') && !path.isAbsolute(filePath)) {
          resolvedPath = path.join(workspaceRoot, filePath.substring(1));
        }
        // If path doesn't start with /, make it relative to workspace
        else if (!filePath.startsWith('/') && !path.isAbsolute(filePath)) {
          resolvedPath = path.join(workspaceRoot, filePath);
        }
        
        console.log(`Opening file at path: ${resolvedPath}`);
        
        // Try to open the file
        try {
          const document = await vscode.workspace.openTextDocument(resolvedPath);
          const editor = await vscode.window.showTextDocument(document);
          
          // Position the cursor at the finding location if line number is provided
          if (lineNumber && lineNumber > 0) {
            // Convert 1-based line/column to 0-based for VS Code
            const line = Math.max(0, lineNumber - 1);
            const column = columnNumber ? Math.max(0, columnNumber - 1) : 0;
            
            const position = new vscode.Position(line, column);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(
              new vscode.Range(position, position),
              vscode.TextEditorRevealType.InCenter
            );
          }
        } catch (error) {
          // If file doesn't exist, show error message
          vscode.window.showErrorMessage(`Could not open file: ${fileName} (${error instanceof Error ? error.message : String(error)})`);
          
          // Offer to select an existing file
          const selectOption = 'Select Existing File';
          const selection = await vscode.window.showErrorMessage(
            `File not found: ${fileName}. Would you like to select another file?`,
            selectOption
          );
          
          if (selection === selectOption) {
            // Ask user to select a file
            const fileUris = await vscode.window.showOpenDialog({
              canSelectFiles: true,
              canSelectFolders: false,
              canSelectMany: false,
              openLabel: `Select ${fileName}`
            });
            
            if (fileUris && fileUris.length > 0) {
              // Open the selected file
              const document = await vscode.workspace.openTextDocument(fileUris[0]);
              const editor = await vscode.window.showTextDocument(document);
              
              // Position the cursor at the finding location if line number is provided
              if (lineNumber && lineNumber > 0) {
                const line = Math.max(0, lineNumber - 1);
                const column = columnNumber ? Math.max(0, columnNumber - 1) : 0;
                
                const position = new vscode.Position(line, column);
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(
                  new vscode.Range(position, position),
                  vscode.TextEditorRevealType.InCenter
                );
              }
            }
          }
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to open file: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );
  
  // Register command to create a test GitLeaks report (for development)
  const createTestReportCommand = vscode.commands.registerCommand('niobium-runner.createTestReport', async () => {
    try {
      // Get workspace folders
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder is open');
        return;
      }
      
      // Create .niobium_results directory if it doesn't exist
      const resultsDir = path.join(workspaceFolders[0].uri.fsPath, '.niobium_results');
      if (!fs.existsSync(resultsDir)) {
        fs.mkdirSync(resultsDir, { recursive: true });
      }
      
      // Create a sample GitLeaks report
      const sampleReport = createSampleGitLeaksReport();
      
      // Write the report to a file
      const reportFile = path.join(resultsDir, 'gitleaks-report.json');
      fs.writeFileSync(reportFile, JSON.stringify(sampleReport, null, 2));
      
      // Refresh the results view
      resultsDataProvider.refresh();
      
      vscode.window.showInformationMessage(`Created test GitLeaks report at ${reportFile}`);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to create test report: ${error}`);
    }
  });
  
  // Generate a sample GitLeaks report using workspace files
  function createSampleGitLeaksReport() {
    try {
      // Option to create an exact replica of the example provided by the user
      const useExactExample = true;
      
      if (useExactExample) {
        return [
          {
            "RuleID": "kubernetes-secret-yaml",
            "Description": "Possible Kubernetes Secret detected, posing a risk of leaking credentials/tokens from your deployments",
            "StartLine": 2,
            "EndLine": 8,
            "StartColumn": 2,
            "EndColumn": 40,
            "Match": "kind: Secret\nmetadata:\n  name: mysql-secret\n  namespace: defectdojo\ntype: Opaque\ndata:\n  mysql-root-password: ZGVmZWN0ZG9qbw==",
            "Secret": "mysql-root-password: ZGVmZWN0ZG9qbw==",
            "File": "/src/kubernetes/defectdojo/mysql.yaml",
            "SymlinkFile": "",
            "Commit": "",
            "Entropy": 4.445544,
            "Author": "",
            "Email": "",
            "Date": "",
            "Message": "",
            "Tags": [],
            "Fingerprint": "/src/kubernetes/defectdojo/mysql.yaml:kubernetes-secret-yaml:2"
          },
          {
            "RuleID": "kubernetes-secret-yaml",
            "Description": "Possible Kubernetes Secret detected, posing a risk of leaking credentials/tokens from your deployments",
            "StartLine": 47,
            "EndLine": 47,
            "StartColumn": 2,
            "EndColumn": 0,
            "Match": "kind: Secret\nmetadata:\n  name: defectdojo-secret\n  namespace: defectdojo\ntype: Opaque\ndata:\n  secret-key: c2VjcmV0LWtleS1mb3ItZGVmZWN0ZG9qbw==",
            "Secret": "secret-key: c2VjcmV0LWtleS1mb3ItZGVmZWN0ZG9qbw==",
            "File": "/src/kubernetes/defectdojo/deployment.yaml",
            "SymlinkFile": "",
            "Commit": "",
            "Entropy": 4.7146616,
            "Author": "",
            "Email": "",
            "Date": "",
            "Message": "",
            "Tags": [],
            "Fingerprint": "/src/kubernetes/defectdojo/deployment.yaml:kubernetes-secret-yaml:47"
          },
          {
            "RuleID": "generic-api-key",
            "Description": "Detected a Generic API Key, potentially exposing access to various services and sensitive operations.",
            "StartLine": 53,
            "EndLine": 53,
            "StartColumn": 4,
            "EndColumn": 52,
            "Match": "secret-key: c2VjcmV0LWtleS1mb3ItZGVmZWN0ZG9qbw== ",
            "Secret": "c2VjcmV0LWtleS1mb3ItZGVmZWN0ZG9qbw==",
            "File": "/src/kubernetes/defectdojo/deployment.yaml",
            "SymlinkFile": "",
            "Commit": "",
            "Entropy": 4.3847957,
            "Author": "",
            "Email": "",
            "Date": "",
            "Message": "",
            "Tags": [],
            "Fingerprint": "/src/kubernetes/defectdojo/deployment.yaml:generic-api-key:53"
          }
        ];
      }
      
      // Get all files in the workspace
      const workspacePath = vscode.workspace.workspaceFolders![0].uri.fsPath;
      
      // Find some interesting files to use in the sample report
      const findings: any[] = [];
      
      // Recursively find files from workspace root
      const findFiles = (dir: string, depth = 0): string[] => {
        if (depth > 3) return []; // Limit recursion depth
        
        const files: string[] = [];
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          
          // Skip node_modules and .git directories
          if (entry.isDirectory()) {
            if (entry.name !== 'node_modules' && entry.name !== '.git') {
              files.push(...findFiles(fullPath, depth + 1));
            }
          } else {
            files.push(fullPath);
          }
        }
        
        return files;
      };
      
      // Get all files in the workspace (limited by depth)
      const files = findFiles(workspacePath);
      
      // Select a few files for the sample report
      const selectedFiles = files.filter(file => {
        const ext = path.extname(file);
        return ['.ts', '.js', '.json', '.yaml', '.yml'].includes(ext);
      }).slice(0, 5);
      
      // Create sample findings for the selected files
      selectedFiles.forEach((file, index) => {
        // Get the file path relative to the workspace
        const relativePath = path.relative(workspacePath, file);
        
        // Some sample rules for different file types
        const rules = [
          { id: 'generic-api-key', description: 'Generic API Key' },
          { id: 'aws-access-key', description: 'AWS Access Key' },
          { id: 'password', description: 'Password' },
          { id: 'private-key', description: 'Private Key' },
          { id: 'kubernetes-secret', description: 'Kubernetes Secret' }
        ];
        
        // Create 1-2 findings per file
        const numFindings = 1 + Math.floor(Math.random() * 2);
        for (let i = 0; i < numFindings; i++) {
          // Select a random rule
          const rule = rules[Math.floor(Math.random() * rules.length)];
          
          // Create a finding
          findings.push({
            RuleID: rule.id,
            Description: rule.description,
            StartLine: 10 + Math.floor(Math.random() * 40),
            EndLine: 10 + Math.floor(Math.random() * 40),
            StartColumn: 1 + Math.floor(Math.random() * 30),
            EndColumn: 30 + Math.floor(Math.random() * 50),
            Match: `Sample match for ${rule.id}`,
            Secret: `sample-${rule.id}-${index}`,
            File: `/src/${relativePath}`,  // Include leading /src/ to test path resolution
            SymlinkFile: "",
            Commit: 'sample-commit-' + Math.random().toString(36).substring(2, 10),
            Entropy: 3.5 + Math.random() * 2,
            Author: 'Sample Author',
            Email: 'sample@example.com',
            Date: new Date().toISOString(),
            Message: 'Sample commit message',
            Tags: ['secret', rule.id],
            Fingerprint: 'sample-fingerprint-' + Math.random().toString(36).substring(2, 15)
          });
        }
      });
      
      return findings;
    } catch (error) {
      console.error('Error creating sample report:', error);
      return [];
    }
  }
  
  // Add to context
  context.subscriptions.push(
    treeView, 
    refreshCommand, 
    showDetailsCommand, 
    showFullReportCommand,
    openFileAtLocationCommand,
    createTestReportCommand
  );
  
  return resultsDataProvider;
} 