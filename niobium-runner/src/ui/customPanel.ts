import * as vscode from 'vscode';
import * as path from 'path';

export class CustomPanel {
  public static currentPanel: CustomPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    
    // Set the webview's initial html content
    this._update();
    
    // Listen for when the panel is disposed
    // This happens when the user closes the panel or when the panel is closed programmatically
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    
    // Update the content based on view changes
    this._panel.onDidChangeViewState(
      e => {
        if (this._panel.visible) {
          this._update();
        }
      },
      null,
      this._disposables
    );
    
    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      message => {
        switch (message.command) {
          case 'alert':
            vscode.window.showInformationMessage(message.text);
            return;
        }
      },
      null,
      this._disposables
    );
  }
  
  // Create or show panel
  public static createOrShow(extensionUri: vscode.Uri): CustomPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;
    
    // If we already have a panel, show it
    if (CustomPanel.currentPanel) {
      CustomPanel.currentPanel._panel.reveal(column);
      return CustomPanel.currentPanel;
    }
    
    // Otherwise, create a new panel
    const panel = vscode.window.createWebviewPanel(
      'niobiumCustom',
      'My Custom Tab',
      { viewColumn: column || vscode.ViewColumn.One, preserveFocus: true },
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
    if (!this._panel.visible) {
      return;
    }
    
    this._panel.title = 'My Custom Tab';
    this._panel.webview.html = this._getHtmlForWebview();
  }
  
  // Generate the HTML for the webview
  private _getHtmlForWebview(): string {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Custom Tab</title>
        <style>
          body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
          }
          .container {
            max-width: 800px;
            margin: 0 auto;
          }
          h1 {
            color: var(--vscode-textLink-foreground);
          }
          button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 12px;
            cursor: pointer;
            border-radius: 3px;
          }
          button:hover {
            background-color: var(--vscode-button-hoverBackground);
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>My Custom Tab</h1>
          <p>This is a custom tab that appears next to the terminal panel.</p>
          <p>You can add your own functionality here.</p>
          <button id="alert-button">Click Me</button>
        </div>
        <script>
          const vscode = acquireVsCodeApi();
          document.getElementById('alert-button').addEventListener('click', () => {
            vscode.postMessage({
              command: 'alert',
              text: 'Button clicked!'
            });
          });
        </script>
      </body>
      </html>
    `;
  }
} 