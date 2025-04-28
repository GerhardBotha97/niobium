import * as vscode from 'vscode';

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
    console.log('Resolving Niobium panel webview');
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    // Set simple HTML content with just a button
    webviewView.webview.html = this._getSimpleHtmlForWebview();

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(
      message => {
        console.log('Received message from webview:', message);
        switch (message.command) {
          case 'buttonClicked':
            vscode.window.showInformationMessage('Button was clicked!');
            return;
        }
      }
    );
  }

  public refresh(): void {
    if (this._view) {
      this._view.webview.html = this._getSimpleHtmlForWebview();
    } else {
      vscode.window.showErrorMessage('Cannot refresh - Niobium panel is not initialized.');
    }
  }

  private _getSimpleHtmlForWebview(): string {
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
            margin: 10px 0;
          }
          .action-button:hover {
            background-color: var(--vscode-button-hoverBackground);
          }
        </style>
      </head>
      <body>
        <h1>Niobium</h1>
        <button class="action-button" id="clickable-button">Click Me</button>
        
        <script>
          const vscode = acquireVsCodeApi();
          
          // Add click event listener to the button
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