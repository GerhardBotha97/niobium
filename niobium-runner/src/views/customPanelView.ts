import * as vscode from 'vscode';
import * as path from 'path';

export class CustomPanelViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'niobium-custom-panel';
  private _view?: vscode.WebviewView;

  constructor(
    private readonly _extensionUri: vscode.Uri,
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      // Enable JavaScript in the webview
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(
      message => {
        switch (message.command) {
          case 'alert':
            vscode.window.showInformationMessage(message.text);
            return;
        }
      }
    );
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Niobium Tab</title>
        <style>
          body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
          }
          .container {
            width: 100%;
          }
          h1 {
            color: var(--vscode-textLink-foreground);
            font-size: 1.2em;
            margin-bottom: 15px;
          }
          .card {
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 5px;
            padding: 12px;
            margin-bottom: 10px;
          }
          .card-title {
            font-weight: bold;
            margin-bottom: 6px;
          }
          .card-content {
            margin-bottom: 10px;
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
          .actions {
            display: flex;
            gap: 8px;
            margin-top: 15px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Niobium Runner</h1>
          
          <div class="card">
            <div class="card-title">Active Tasks</div>
            <div class="card-content">View and manage your running tasks.</div>
          </div>
          
          <div class="card">
            <div class="card-title">Recent Commands</div>
            <div class="card-content">Quick access to your recent commands.</div>
          </div>
          
          <div class="actions">
            <button id="run-button">Run Command</button>
            <button id="alert-button">Show Info</button>
          </div>
        </div>
        <script>
          const vscode = acquireVsCodeApi();
          
          // Handle the show info button
          document.getElementById('alert-button').addEventListener('click', () => {
            vscode.postMessage({
              command: 'alert',
              text: 'Niobium Runner is active!'
            });
          });
          
          // Handle the run command button
          document.getElementById('run-button').addEventListener('click', () => {
            vscode.postMessage({
              command: 'runCommand'
            });
          });
        </script>
      </body>
      </html>
    `;
  }
} 