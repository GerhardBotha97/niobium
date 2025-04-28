import * as vscode from 'vscode';

export class CustomPanel {
  public static currentPanel: CustomPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    
    // Set the webview's initial html content with a simple button
    this._update();
    
    // Listen for when the panel is disposed
    // This happens when the user closes the panel or when the panel is closed programmatically
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    
    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      message => {
        switch (message.command) {
          case 'buttonClicked':
            vscode.window.showInformationMessage('Button was clicked!');
            return;
        }
      },
      null,
      this._disposables
    );
  }
  
  // Create or show panel
  public static createOrShow(extensionUri: vscode.Uri): CustomPanel {
    // If we already have a panel, show it
    if (CustomPanel.currentPanel) {
      CustomPanel.currentPanel._panel.reveal();
      return CustomPanel.currentPanel;
    }
    
    // Otherwise, create a new panel
    const panel = vscode.window.createWebviewPanel(
      'niobium',
      'Niobium',
      vscode.ViewColumn.Active,
      {
        // Enable JavaScript in the webview
        enableScripts: true,
        
        // Restrict the webview to only load resources from the extension's directory
        localResourceRoots: [extensionUri],
        
        // Retain the webview when it's not visible
        retainContextWhenHidden: true
      }
    );
    
    CustomPanel.currentPanel = new CustomPanel(panel, extensionUri);
    return CustomPanel.currentPanel;
  }
  
  // Register a command to show the Niobium panel
  public static registerCommand(context: vscode.ExtensionContext): void {
    const command = vscode.commands.registerCommand('niobium.showResultsPanel', () => {
      CustomPanel.createOrShow(context.extensionUri);
    });
    
    context.subscriptions.push(command);
  }
  
  // Public method to reveal the panel
  public reveal(): void {
    this._panel.reveal();
  }
  
  // Dispose all resources
  public dispose(): void {
    CustomPanel.currentPanel = undefined;
    
    // Clean up resources
    this._panel.dispose();
    
    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
  
  // Update the webview content
  private _update(): void {
    this._panel.title = 'Niobium';
    this._panel.webview.html = this._getSimpleHtmlWithButton();
  }
  
  // Generate simple HTML with just a button
  private _getSimpleHtmlWithButton(): string {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Niobium</title>
        <style>
          body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
          }
          h1 {
            color: var(--vscode-textLink-foreground);
            font-size: 20px;
            margin-bottom: 20px;
          }
          .action-button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 10px 16px;
            cursor: pointer;
            border-radius: 4px;
            font-size: 14px;
            font-weight: 500;
          }
          .action-button:hover {
            background-color: var(--vscode-button-hoverBackground);
          }
        </style>
      </head>
      <body>
        <h1>Niobium Panel</h1>
        <button class="action-button" id="clickable-button">Click Me</button>
        
        <script>
          const vscode = acquireVsCodeApi();
          
          document.getElementById('clickable-button').addEventListener('click', () => {
            vscode.postMessage({
              command: 'buttonClicked'
            });
          });
        </script>
      </body>
      </html>
    `;
  }
} 